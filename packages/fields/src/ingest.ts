import { randomUUID } from 'node:crypto';
import {
  CONTENT_CLASSES,
  CREDIBILITY_GRADES,
  type ContentClass,
  type Credibility,
  RELIABILITY_GRADES,
  type Reliability,
} from '@mae/core';
import type { PoolClient } from 'pg';
import type { Embedder } from './embedder.ts';

/**
 * Thrown when a source or chunk arrives without a human-assigned grade.
 *
 * Grading is a required input, not something to infer. Appendix E §E.2.1: "Grade the field
 * at ingest. Every document carries a source reliability grade assigned at curation time."
 * A model-assigned grade would be the system scoring its own veracity, which §E.9 names as
 * producing a number that inherits every problem the confidence had.
 */
export class UngradedSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UngradedSourceError';
  }
}

export interface SourceGrading {
  readonly reliability: Reliability;
  /**
   * Curated expertise, or content invented to exercise the engine.
   *
   * Required with no default. A source that does not say which it is, is the one case that
   * must not be guessed: guessing `curated` launders an invention into evidence, and
   * guessing `synthetic` silently discards real curation effort.
   */
  readonly contentClass: ContentClass;
  /** Who assigned the grade. Provenance for the grade itself, per §E.10. */
  readonly gradedBy: string;
  readonly gradedAt?: Date;
  readonly corpusCutoff?: string;
}

export interface ChunkInput {
  readonly text: string;
  readonly credibility: Credibility;
  /** Situational index terms, per §A.12 step four. A chunk with none is unretrievable. */
  readonly situationTags: readonly string[];
}

export interface SourceInput {
  readonly fieldId: string;
  readonly uri: string;
  readonly title?: string;
  readonly grading: SourceGrading;
  readonly chunks: readonly ChunkInput[];
}

export interface IngestResult {
  readonly sourceId: string;
  readonly chunkIds: readonly string[];
}

/** Validates grading up front so nothing partial is ever written. */
export function assertGraded(source: SourceInput): void {
  const { grading, fieldId, uri } = source;

  if (grading === undefined || (grading.reliability as string | undefined) === undefined) {
    throw new UngradedSourceError(
      `Source ${uri} has no reliability grade. Assign one of ${RELIABILITY_GRADES.join('/')} at curation time.`,
    );
  }
  if (!RELIABILITY_GRADES.includes(grading.reliability)) {
    throw new UngradedSourceError(
      `Source ${uri} has reliability "${grading.reliability}", which is not an Admiralty grade (${RELIABILITY_GRADES.join('/')}).`,
    );
  }
  if (!CONTENT_CLASSES.includes(grading.contentClass)) {
    throw new UngradedSourceError(
      `Source ${uri} does not declare a content class (${CONTENT_CLASSES.join('/')}). ` +
        `Synthetic content is legitimate for exercising the engine, but only while it stays ` +
        `impossible to mistake for curated expertise.`,
    );
  }
  // Synthetic material has no source to be reliable and nothing independent to corroborate
  // it. F and 6 are the Admiralty codes for exactly that, and claiming better would launder
  // an invention into evidence.
  if (grading.contentClass === 'synthetic' && grading.reliability !== 'F') {
    throw new UngradedSourceError(
      `Synthetic source ${uri} claims reliability ${grading.reliability}. Synthetic content ` +
        `must carry F ("cannot be judged"): it is not weak evidence, it is not evidence.`,
    );
  }
  if (typeof grading.gradedBy !== 'string' || grading.gradedBy.trim() === '') {
    throw new UngradedSourceError(
      `Source ${uri} does not record who assigned its grade. A grade without provenance is not auditable.`,
    );
  }
  if (fieldId.trim() === '') {
    throw new UngradedSourceError('A source must be bound to a field.');
  }
  if (source.chunks.length === 0) {
    throw new UngradedSourceError(`Source ${uri} produced no chunks.`);
  }

  source.chunks.forEach((chunk, i) => {
    if (!CREDIBILITY_GRADES.includes(chunk.credibility)) {
      throw new UngradedSourceError(
        `Chunk ${i} of ${uri} has credibility "${chunk.credibility}", which is not 1-6.`,
      );
    }
    if (chunk.situationTags.length === 0) {
      throw new UngradedSourceError(
        `Chunk ${i} of ${uri} has no situation tags. Retrieval is situational, not ` +
          `document-based, so an untagged chunk can never be retrieved.`,
      );
    }
    if (chunk.text.trim() === '') {
      throw new UngradedSourceError(`Chunk ${i} of ${uri} is empty.`);
    }
    if (grading.contentClass === 'synthetic' && chunk.credibility !== 6) {
      throw new UngradedSourceError(
        `Chunk ${i} of synthetic source ${uri} claims credibility ${chunk.credibility}. ` +
          `Synthetic content carries 6 ("cannot be judged") on both axes.`,
      );
    }
  });
}

/**
 * Ingests one graded source and its chunks.
 *
 * Ingest is a week of work; curating a defensible field is months of expert time. The
 * pipeline is not the capability, and this function's job is to make sure the expensive
 * part — the human judgment in the grades and tags — is never silently skipped.
 */
export async function ingestSource(
  client: PoolClient,
  source: SourceInput,
  embedder: Embedder,
): Promise<IngestResult> {
  assertGraded(source);

  const sourceId = randomUUID();
  const embeddings = await embedder.embed(source.chunks.map((c) => c.text));

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO field_sources (id, field_id, uri, title, reliability, graded_by, graded_at, corpus_cutoff, content_class)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        sourceId,
        source.fieldId,
        source.uri,
        source.title ?? null,
        source.grading.reliability,
        source.grading.gradedBy,
        source.grading.gradedAt ?? new Date(),
        source.grading.corpusCutoff ?? null,
        source.grading.contentClass,
      ],
    );

    const chunkIds: string[] = [];
    for (const [i, chunk] of source.chunks.entries()) {
      const chunkId = randomUUID();
      await client.query(
        `INSERT INTO field_chunks (id, source_id, field_id, text, credibility, situation_tags, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          chunkId,
          sourceId,
          source.fieldId,
          chunk.text,
          chunk.credibility,
          chunk.situationTags,
          toVectorLiteral(embeddings[i]),
        ],
      );
      chunkIds.push(chunkId);
    }

    await client.query('COMMIT');
    return { sourceId, chunkIds };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function toVectorLiteral(embedding: number[] | undefined): string | null {
  return embedding === undefined ? null : `[${embedding.join(',')}]`;
}
