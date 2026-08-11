import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HYBRID_CONFIG,
  cosine,
  hybridScore,
  rankCandidates,
  tagOverlap,
} from '../src/retrieval/score.ts';
import {
  CREDIBILITY_MEANING,
  type GradedChunk,
  RELIABILITY_MEANING,
  type SituationQuery,
  queryTags,
} from '../src/retrieval/types.ts';

const chunk = (id: string, tags: string[], overrides: Partial<GradedChunk> = {}): GradedChunk => ({
  id,
  sourceId: `src-${id}`,
  fieldId: 'materials.metallurgy',
  text: `chunk ${id}`,
  reliability: 'B',
  credibility: 2,
  situationTags: tags,
  contentClass: 'curated',
  ...overrides,
});

const QUERY: SituationQuery = {
  situationType: 'unexpected_lot_variation',
  cuePatterns: ['trace_constituent_shift'],
  failureModes: ['long_term_aging'],
};

describe('Admiralty grading', () => {
  it('keeps the two axes separate', () => {
    // §E.2.2: "Do not convert the letter-number pair into a single scalar for convenience.
    // The two-axis structure is the information content." There is deliberately no
    // combining function to test here — its absence is the design.
    expect(Object.keys(RELIABILITY_MEANING)).toHaveLength(6);
    expect(Object.keys(CREDIBILITY_MEANING)).toHaveLength(6);
    expect(RELIABILITY_MEANING.A).toBe('completely reliable');
    expect(CREDIBILITY_MEANING[1]).toBe('confirmed by independent sources');
  });
});

describe('queryTags', () => {
  it('flattens every situational axis, deduplicated and ordered', () => {
    expect(
      queryTags({
        situationType: 's',
        cuePatterns: ['c', 's'],
        adversaryTechniques: ['a'],
        systemCharacteristics: ['y'],
        failureModes: ['f'],
      }),
    ).toEqual(['a', 'c', 'f', 's', 'y']);
  });

  it('handles a query with only a situation type', () => {
    expect(queryTags({ situationType: 'lot_acceptance' })).toEqual(['lot_acceptance']);
  });
});

describe('tagOverlap', () => {
  it('is 1 for identical tag sets', () => {
    expect(tagOverlap(['a', 'b'], ['b', 'a'])).toBe(1);
  });

  it('is 0 for disjoint sets', () => {
    expect(tagOverlap(['a'], ['b'])).toBe(0);
  });

  it('is Jaccard, so a broadly-tagged chunk does not win by breadth alone', () => {
    // One shared tag out of four distinct: a chunk tagged with everything should not
    // outrank a precisely tagged one.
    expect(tagOverlap(['a', 'b'], ['b', 'c', 'd'])).toBeCloseTo(1 / 4);
  });

  it('is 0 for empty inputs', () => {
    expect(tagOverlap([], [])).toBe(0);
    expect(tagOverlap(['a'], [])).toBe(0);
  });
});

describe('cosine', () => {
  it('is 1 for identical vectors', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('clamps opposing vectors to 0 rather than returning a negative score', () => {
    expect(cosine([1, 0], [-1, 0])).toBe(0);
  });

  it.each([
    ['a missing vector', undefined, [1, 2]],
    ['mismatched lengths', [1, 2], [1, 2, 3]],
    ['an empty vector', [], []],
    ['a zero vector', [0, 0], [1, 1]],
  ])('is 0 for %s', (_label, a, b) => {
    expect(cosine(a, b)).toBe(0);
  });
});

describe('hybridScore', () => {
  it('weights tags above vectors by default', () => {
    // Situation tags are a curator's assertion about what a chunk is about. The embedding
    // is there to catch incomplete tagging, not to lead.
    expect(DEFAULT_HYBRID_CONFIG.tagWeight).toBeGreaterThan(DEFAULT_HYBRID_CONFIG.vectorWeight);
    expect(hybridScore(1, 0)).toBeGreaterThan(hybridScore(0, 1));
  });

  it('sums to 1 when both signals are perfect', () => {
    expect(hybridScore(1, 1)).toBeCloseTo(1);
  });
});

describe('rankCandidates', () => {
  it('orders by combined score and truncates to k', () => {
    const ranked = rankCandidates(
      QUERY,
      [
        { chunk: chunk('low', ['long_term_aging']) },
        { chunk: chunk('high', ['unexpected_lot_variation', 'trace_constituent_shift', 'long_term_aging']) },
        { chunk: chunk('mid', ['unexpected_lot_variation', 'long_term_aging']) },
      ],
      2,
    );

    expect(ranked.map((r) => r.chunk.id)).toEqual(['high', 'mid']);
  });

  it('drops candidates with no signal at all', () => {
    const ranked = rankCandidates(QUERY, [{ chunk: chunk('unrelated', ['bath_chemistry']) }], 10);
    expect(ranked).toEqual([]);
  });

  it('carries both grades through to the result', () => {
    // §E.2.1: a finding derived from B2 material and one derived from D4 material must not
    // arrive looking alike. The grades cannot be dropped anywhere on the path to a persona.
    const ranked = rankCandidates(
      QUERY,
      [{ chunk: chunk('graded', ['long_term_aging'], { reliability: 'D', credibility: 4 }) }],
      10,
    );

    expect(ranked[0]!.chunk).toMatchObject({ reliability: 'D', credibility: 4 });
  });

  it('does not let grade influence rank', () => {
    // A high-reliability chunk is more trustworthy, not more relevant. Reordering by grade
    // would reintroduce the scalar collapse §E.2.2 warns against.
    const ranked = rankCandidates(
      QUERY,
      [
        { chunk: chunk('weak-but-relevant', queryTags(QUERY), { reliability: 'E', credibility: 5 }) },
        { chunk: chunk('strong-but-tangential', ['long_term_aging'], { reliability: 'A', credibility: 1 }) },
      ],
      10,
    );

    expect(ranked.map((r) => r.chunk.id)).toEqual(['weak-but-relevant', 'strong-but-tangential']);
  });

  it('uses the vector arm when tags miss entirely', () => {
    const ranked = rankCandidates(
      QUERY,
      [{ chunk: chunk('untagged-match', ['some_other_situation']), embedding: [1, 0, 0] }],
      10,
      [1, 0, 0],
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ tagOverlap: 0, similarity: 1 });
  });

  it('is byte-stable, breaking ties on chunk id', () => {
    const candidates = [
      { chunk: chunk('b', ['long_term_aging']) },
      { chunk: chunk('a', ['long_term_aging']) },
    ];
    const forward = rankCandidates(QUERY, candidates, 10).map((r) => r.chunk.id);
    const reversed = rankCandidates(QUERY, [...candidates].reverse(), 10).map((r) => r.chunk.id);

    expect(forward).toEqual(['a', 'b']);
    expect(reversed).toEqual(forward);
  });
});
