import { createHash } from 'node:crypto';

export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Embedding stays behind an interface so the provider is a deployment decision rather than
 * an architectural one. It also keeps `rankCandidates` testable without a network.
 */
export interface Embedder {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}

/**
 * Deterministic, offline embedder.
 *
 * Not a semantic model — it hashes text into a stable unit vector. It exists so retrieval
 * tests run in CI with no API key and no network, and so a fixture's retrieval ordering is
 * reproducible. Never use it in a real field: it has no notion of meaning, and a field
 * indexed with it degrades to tag-only retrieval.
 */
export class DeterministicEmbedder implements Embedder {
  readonly id = 'deterministic-sha256';
  readonly dimensions: number;

  constructor(dimensions: number = EMBEDDING_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    // Token-level hashing, so texts sharing vocabulary land near each other. Crude, but it
    // gives the ranking tests something meaningful to distinguish.
    for (const token of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      const digest = createHash('sha256').update(token).digest();
      for (let i = 0; i < 8; i++) {
        const index = digest.readUInt16BE(i * 2) % this.dimensions;
        vector[index] = vector[index]! + (digest[16 + i]! % 2 === 0 ? 1 : -1);
      }
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return norm === 0 ? vector : vector.map((v) => v / norm);
  }
}
