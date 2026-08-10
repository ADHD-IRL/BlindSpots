import {
  type Candidate,
  type Credibility,
  type GradedChunk,
  type RankedChunk,
  type Reliability,
  type SituationQuery,
  queryTags,
  rankCandidates,
} from '@mae/core';
import type { PoolClient } from 'pg';
import type { Embedder } from './embedder.ts';

/** How many candidates to pull from each arm before ranking. */
const CANDIDATE_LIMIT = 200;

/**
 * Situational retrieval (Appendix A §A.12 step four).
 *
 * Two arms, unioned then ranked by the pure scorer in `@mae/core`:
 *  - tag overlap via the GIN index, which is the curator's assertion about what kind of
 *    situation a chunk describes;
 *  - vector neighbours via HNSW, which catches chunks whose tagging is incomplete.
 *
 * Both grades ride along on every result and are never collapsed (§E.2.2).
 */
export async function retrieve(
  client: PoolClient,
  fieldId: string,
  query: SituationQuery,
  k: number,
  embedder?: Embedder,
): Promise<RankedChunk[]> {
  const tags = queryTags(query);
  const queryEmbedding = embedder === undefined ? undefined : (await embedder.embed([describe(query)]))[0];

  const { rows } = await client.query<{
    id: string;
    source_id: string;
    field_id: string;
    text: string;
    credibility: number;
    situation_tags: string[];
    reliability: string;
    embedding: string | null;
  }>(
    `SELECT c.id, c.source_id, c.field_id, c.text, c.credibility, c.situation_tags,
            s.reliability, c.embedding::text AS embedding
       FROM field_chunks c
       JOIN field_sources s ON s.id = c.source_id
      WHERE c.field_id = $1
        AND (c.situation_tags && $2::text[] OR $3::boolean)
      LIMIT $4`,
    [fieldId, tags, queryEmbedding !== undefined, CANDIDATE_LIMIT],
  );

  const candidates: Candidate[] = rows.map((row) => ({
    chunk: toGradedChunk(row),
    ...(row.embedding === null ? {} : { embedding: parseVector(row.embedding) }),
  }));

  return rankCandidates(query, candidates, k, queryEmbedding);
}

function toGradedChunk(row: {
  id: string;
  source_id: string;
  field_id: string;
  text: string;
  credibility: number;
  situation_tags: string[];
  reliability: string;
}): GradedChunk {
  return {
    id: row.id,
    sourceId: row.source_id,
    fieldId: row.field_id,
    text: row.text,
    reliability: row.reliability as Reliability,
    credibility: row.credibility as Credibility,
    situationTags: row.situation_tags,
  };
}

/**
 * Renders a situation query as text for embedding.
 *
 * Deliberately not a keyword string handed back to the caller — it exists only to give the
 * vector arm something to encode. The query's structure remains the interface.
 */
function describe(query: SituationQuery): string {
  return queryTags(query).join(' ');
}

function parseVector(literal: string): number[] {
  return literal.slice(1, -1).split(',').map(Number);
}
