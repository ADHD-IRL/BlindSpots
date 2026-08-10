import { readFileSync } from 'node:fs';
import type { ContentClass, Credibility } from '@mae/core';
import type { PoolClient } from 'pg';
import type { Embedder } from './embedder.ts';
import { type SourceInput, ingestSource } from './ingest.ts';

/**
 * A field fixture file: several sources sharing one content class and grader.
 *
 * The class is declared once at the top of the file rather than per source, so a file cannot
 * quietly contain a mix — and so the declaration is impossible to miss when reading it.
 */
export interface FieldFixture {
  readonly contentClass: ContentClass;
  readonly gradedBy: string;
  readonly sources: readonly {
    readonly fieldId: string;
    readonly uri: string;
    readonly title?: string;
    readonly chunks: readonly {
      readonly text: string;
      readonly situationTags: readonly string[];
      /** Required for curated fixtures; ignored for synthetic, which is pinned to 6. */
      readonly credibility?: number;
    }[];
  }[];
}

/**
 * Grades a fixture's chunks.
 *
 * Synthetic content is pinned to 6 — "cannot be judged" — which is the only honest coding
 * for a passage that was invented. Curated fixtures have to state credibility per chunk,
 * because that is a human judgment the fixture loader has no standing to make.
 */
function credibilityFor(contentClass: ContentClass, declared: number | undefined): Credibility {
  if (contentClass === 'synthetic') return 6;
  if (declared === undefined) {
    throw new Error(
      'Curated fixture chunks must state a credibility grade. Only synthetic content has a ' +
        'grade the loader may assign, and only because 6 means "cannot be judged".',
    );
  }
  return declared as Credibility;
}

export function readFieldFixture(path: string): FieldFixture {
  return JSON.parse(readFileSync(path, 'utf8')) as FieldFixture;
}

export interface LoadFixtureResult {
  readonly contentClass: ContentClass;
  readonly fieldIds: readonly string[];
  readonly sources: number;
  readonly chunks: number;
}

/**
 * Ingests every source in a field fixture.
 *
 * Reliability is forced to F for synthetic content here rather than read from the file, so a
 * fixture cannot claim a grade by editing a string. `assertGraded` would reject it anyway —
 * this just means the fixture format has no place to write the lie.
 */
export async function loadFieldFixture(
  client: PoolClient,
  fixture: FieldFixture,
  embedder: Embedder,
): Promise<LoadFixtureResult> {
  let chunks = 0;

  for (const source of fixture.sources) {
    const input: SourceInput = {
      fieldId: source.fieldId,
      uri: source.uri,
      ...(source.title === undefined ? {} : { title: source.title }),
      grading: {
        reliability: fixture.contentClass === 'synthetic' ? 'F' : 'C',
        contentClass: fixture.contentClass,
        gradedBy: fixture.gradedBy,
      },
      chunks: source.chunks.map((chunk) => ({
        text: chunk.text,
        credibility: credibilityFor(fixture.contentClass, chunk.credibility),
        situationTags: chunk.situationTags,
      })),
    };

    await ingestSource(client, input, embedder);
    chunks += source.chunks.length;
  }

  return {
    contentClass: fixture.contentClass,
    fieldIds: [...new Set(fixture.sources.map((s) => s.fieldId))],
    sources: fixture.sources.length,
    chunks,
  };
}
