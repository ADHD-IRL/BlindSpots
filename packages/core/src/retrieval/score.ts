import { type GradedChunk, type SituationQuery, queryTags } from './types.ts';

export interface HybridScoreConfig {
  /** Weight on situational tag overlap. */
  readonly tagWeight: number;
  /** Weight on embedding cosine similarity. */
  readonly vectorWeight: number;
}

/**
 * Tags carry more weight than vectors by default.
 *
 * Vector similarity finds text that reads like the query. Situation tags are a curator's
 * assertion that this chunk is about this kind of situation, which is the retrieval
 * structure §A.12 step four actually asks for. The embedding is there to catch chunks whose
 * tagging is incomplete, not to lead.
 */
export const DEFAULT_HYBRID_CONFIG: HybridScoreConfig = { tagWeight: 0.7, vectorWeight: 0.3 };

/** Jaccard overlap between a query's tags and a chunk's, in [0, 1]. */
export function tagOverlap(
  queryTagList: readonly string[],
  chunkTags: readonly string[],
): number {
  if (queryTagList.length === 0 && chunkTags.length === 0) return 0;
  const q = new Set(queryTagList);
  const c = new Set(chunkTags);
  let intersection = 0;
  for (const tag of q) if (c.has(tag)) intersection++;
  const union = q.size + c.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Cosine similarity, clamped to [0, 1]. Returns 0 when either vector is absent or zero. */
export function cosine(a: readonly number[] | undefined, b: readonly number[] | undefined): number {
  if (a === undefined || b === undefined || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.min(1, Math.max(0, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}

export function hybridScore(
  overlap: number,
  similarity: number,
  config: HybridScoreConfig = DEFAULT_HYBRID_CONFIG,
): number {
  return config.tagWeight * overlap + config.vectorWeight * similarity;
}

export interface Candidate {
  readonly chunk: GradedChunk;
  readonly embedding?: readonly number[];
}

export interface RankedChunk {
  readonly chunk: GradedChunk;
  readonly score: number;
  readonly tagOverlap: number;
  readonly similarity: number;
}

/**
 * Ranks candidate chunks against a situation.
 *
 * Pure, so it is unit-testable without a database, a network, or an embedding provider —
 * `packages/fields` supplies the candidates and this decides the order.
 *
 * Note what this does NOT do: reorder by grade. A high-reliability chunk is not more
 * relevant, it is more trustworthy, and conflating the two would quietly reintroduce the
 * scalar collapse §E.2.2 warns against. Grades travel with the chunk for the persona and
 * the validator to reason about; they do not bias what gets retrieved.
 */
export function rankCandidates(
  query: SituationQuery,
  candidates: readonly Candidate[],
  k: number,
  queryEmbedding?: readonly number[],
  config: HybridScoreConfig = DEFAULT_HYBRID_CONFIG,
): RankedChunk[] {
  const tags = queryTags(query);

  return candidates
    .map((candidate): RankedChunk => {
      const overlap = tagOverlap(tags, candidate.chunk.situationTags);
      const similarity = cosine(queryEmbedding, candidate.embedding);
      return {
        chunk: candidate.chunk,
        score: hybridScore(overlap, similarity, config),
        tagOverlap: overlap,
        similarity,
      };
    })
    .filter((r) => r.score > 0)
    // Ties break on chunk id so retrieval is byte-stable, which keeps a persona's context
    // reproducible for the same query and field version.
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, k);
}
