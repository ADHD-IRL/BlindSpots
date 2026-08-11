import {
  type Candidate,
  type ContentClass,
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

/**
 * How many candidates each arm contributes before ranking.
 *
 * Bounded per arm rather than over their union, because the whole point of two arms is that
 * each is allowed to nominate its own best regardless of what the other found.
 */
const ARM_LIMIT = 100;

interface ChunkRow {
  id: string;
  source_id: string;
  field_id: string;
  text: string;
  credibility: number;
  situation_tags: string[];
  reliability: string;
  content_class: string;
  embedding: string | null;
}

const CHUNK_COLUMNS = `c.id, c.source_id, c.field_id, c.text, c.credibility, c.situation_tags,
                       s.reliability, s.content_class, c.embedding::text AS embedding`;

/**
 * Situational retrieval (Appendix A §A.12 step four).
 *
 * Two arms, unioned then ranked by the pure scorer in `@mae/core`:
 *  - **tag overlap** via the GIN index, which is the curator's assertion about what kind of
 *    situation a chunk describes;
 *  - **vector neighbours** via HNSW, which catches chunks whose tagging is incomplete.
 *
 * Each arm is bounded and ordered on its own terms. An earlier version issued one query
 * whose predicate matched the whole field whenever an embedder was supplied, then took an
 * arbitrary `LIMIT` of it — so on a field of any real size the best matches were discarded
 * before scoring ever happened, and the HNSW index was never used for the one thing it
 * exists to do. Ordering inside each arm is what makes the bound meaningful rather than
 * arbitrary.
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
  const queryEmbedding =
    embedder === undefined ? undefined : (await embedder.embed([describe(query)]))[0];

  // Tag arm: ordered by how many of the query's tags a chunk carries, so the bound keeps the
  // most situationally specific chunks rather than whichever the planner returned first.
  const tagArm = await client.query<ChunkRow>(
    `SELECT ${CHUNK_COLUMNS}
       FROM field_chunks c
       JOIN field_sources s ON s.id = c.source_id
      WHERE c.field_id = $1 AND c.situation_tags && $2::text[]
      ORDER BY cardinality(ARRAY(SELECT unnest(c.situation_tags) INTERSECT SELECT unnest($2::text[]))) DESC,
               c.id
      LIMIT $3`,
    [fieldId, tags, ARM_LIMIT],
  );

  // Vector arm: true KNN against the HNSW index. Only runs when an embedding exists to
  // compare against, and skips chunks that were never embedded.
  const vectorArm =
    queryEmbedding === undefined
      ? { rows: [] as ChunkRow[] }
      : await client.query<ChunkRow>(
          `SELECT ${CHUNK_COLUMNS}
             FROM field_chunks c
             JOIN field_sources s ON s.id = c.source_id
            WHERE c.field_id = $1 AND c.embedding IS NOT NULL
            ORDER BY c.embedding <=> $2::vector
            LIMIT $3`,
          [fieldId, toVectorLiteral(queryEmbedding), ARM_LIMIT],
        );

  // Deduplicate across arms; a chunk found by both is one candidate, scored on both signals.
  const byId = new Map<string, ChunkRow>();
  for (const row of [...tagArm.rows, ...vectorArm.rows]) byId.set(row.id, row);

  const candidates: Candidate[] = [...byId.values()].map((row) => ({
    chunk: toGradedChunk(row),
    ...(row.embedding === null ? {} : { embedding: parseVector(row.embedding) }),
  }));

  return rankCandidates(query, candidates, k, queryEmbedding);
}

function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

function toGradedChunk(row: ChunkRow): GradedChunk {
  return {
    id: row.id,
    sourceId: row.source_id,
    fieldId: row.field_id,
    text: row.text,
    reliability: row.reliability as Reliability,
    credibility: row.credibility as Credibility,
    situationTags: row.situation_tags,
    // Carried all the way to the persona. Charter rule CH012 caps any finding whose
    // retrieval set includes synthetic material, so losing it here would silently remove
    // the cap.
    contentClass: row.content_class as ContentClass,
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
