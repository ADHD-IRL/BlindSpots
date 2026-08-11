import { randomUUID } from 'node:crypto';
import { migrate, closePool, withClient } from '@mae/store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS, DeterministicEmbedder } from '../src/embedder.ts';
import { type SourceInput, ingestSource } from '../src/ingest.ts';
import { retrieve } from '../src/retrieve.ts';

const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';
// Must match the field_chunks.embedding column width.
const embedder = new DeterministicEmbedder(EMBEDDING_DIMENSIONS);

describe.skipIf(!HAS_DB)('retrieve (database)', () => {
  const fieldId = `materials.metallurgy.test.${randomUUID()}`;

  beforeAll(async () => {
    await withClient((client) => migrate(client));

    const source: SourceInput = {
      fieldId,
      uri: 'https://example.invalid/lot-acceptance.pdf',
      grading: { reliability: 'B', contentClass: 'curated', gradedBy: 'human:curator' },
      chunks: [
        {
          text: 'Trace constituent shift below specification limits still altered long term aging behaviour.',
          credibility: 2,
          situationTags: ['unexpected_lot_variation', 'trace_constituent_shift', 'long_term_aging'],
        },
        {
          text: 'Acceptance sampling is poorly matched to deliberate low rate insertion.',
          credibility: 3,
          situationTags: ['sampling_plan_limits', 'low_rate_insertion'],
        },
      ],
    };

    const lowGrade: SourceInput = {
      fieldId,
      uri: 'https://example.invalid/practitioner-blog',
      grading: { reliability: 'E', contentClass: 'curated', gradedBy: 'human:curator' },
      chunks: [
        {
          text: 'Anecdotal account of a lot variation with no analysis.',
          credibility: 5,
          situationTags: ['unexpected_lot_variation'],
        },
      ],
    };

    await withClient(async (client) => {
      await ingestSource(client, source, embedder);
      await ingestSource(client, lowGrade, embedder);
    });
  });

  afterAll(closePool);

  it('retrieves by situation and returns both grades on every chunk', async () => {
    const results = await withClient((client) =>
      retrieve(
        client,
        fieldId,
        { situationType: 'unexpected_lot_variation', failureModes: ['long_term_aging'] },
        10,
      ),
    );

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      // §E.2.1: both grades travel to the finding. Neither may be dropped in transit, and
      // neither may be collapsed into the other.
      expect(result.chunk.reliability).toMatch(/^[A-F]$/);
      expect(result.chunk.credibility).toBeGreaterThanOrEqual(1);
      expect(result.chunk.credibility).toBeLessThanOrEqual(6);
    }
  });

  it('ranks the closely-tagged chunk above the loosely-tagged one', async () => {
    const results = await withClient((client) =>
      retrieve(
        client,
        fieldId,
        {
          situationType: 'unexpected_lot_variation',
          cuePatterns: ['trace_constituent_shift'],
          failureModes: ['long_term_aging'],
        },
        10,
      ),
    );

    // The E5 blog chunk shares one tag; the B2 analysis chunk shares three. Relevance
    // decides the order — the grades are reported, not used to rank.
    expect(results[0]!.chunk.reliability).toBe('B');
    expect(results.at(-1)!.chunk.reliability).toBe('E');
  });

  it('returns nothing for a situation the field does not cover', async () => {
    const results = await withClient((client) =>
      retrieve(client, fieldId, { situationType: 'orbital_debris_conjunction' }, 10),
    );
    expect(results).toEqual([]);
  });

  it('does not lose the best match in a field larger than the candidate bound', async () => {
    // The regression this guards: an earlier query matched the whole field whenever an
    // embedder was supplied, then took an arbitrary LIMIT of it, so on a field of any real
    // size the best-tagged chunk could be discarded before scoring ever ran. Each arm is
    // now bounded AND ordered, which is what makes the bound meaningful.
    const bigField = `materials.metallurgy.bulk.${randomUUID()}`;
    const FILLER = 250; // comfortably above the per-arm limit

    await withClient(async (client) => {
      await ingestSource(
        client,
        {
          fieldId: bigField,
          uri: 'https://example.invalid/bulk-filler',
          grading: { reliability: 'C', contentClass: 'curated', gradedBy: 'human:curator' },
          chunks: Array.from({ length: FILLER }, (_, i) => ({
            text: `Unrelated background note ${i}.`,
            credibility: 4 as const,
            situationTags: ['background_note'],
          })),
        },
        embedder,
      );

      // Ingested last, so any "first N rows the planner returned" strategy misses it.
      await ingestSource(
        client,
        {
          fieldId: bigField,
          uri: 'https://example.invalid/the-one-that-matters',
          grading: { reliability: 'A', contentClass: 'curated', gradedBy: 'human:curator' },
          chunks: [
            {
              text: 'Trace constituent shift altered long term aging in an unexpected lot variation.',
              credibility: 1,
              situationTags: [
                'unexpected_lot_variation',
                'trace_constituent_shift',
                'long_term_aging',
              ],
            },
          ],
        },
        embedder,
      );
    });

    const results = await withClient((client) =>
      retrieve(
        client,
        bigField,
        {
          situationType: 'unexpected_lot_variation',
          cuePatterns: ['trace_constituent_shift'],
          failureModes: ['long_term_aging'],
        },
        5,
        embedder,
      ),
    );

    expect(results[0]!.chunk.text).toContain('Trace constituent shift');
    expect(results[0]!.tagOverlap).toBe(1);
  });

  it('retrieves via the vector arm when tags miss entirely', async () => {
    // The arm exists to catch chunks whose tagging is incomplete. Without a separate KNN
    // query it never contributes anything the tag arm did not already find.
    const results = await withClient((client) =>
      retrieve(client, fieldId, { situationType: 'a_tag_no_chunk_carries' }, 5, embedder),
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.tagOverlap === 0)).toBe(true);
    expect(results.every((r) => r.similarity > 0)).toBe(true);
  });

  it('rolls back entirely when a chunk fails mid-ingest', async () => {
    // Partial ingest would leave a source claiming coverage it does not have.
    const bad: SourceInput = {
      fieldId,
      uri: 'https://example.invalid/broken',
      grading: { reliability: 'C', contentClass: 'curated', gradedBy: 'human:curator' },
      chunks: [
        { text: 'fine', credibility: 3, situationTags: ['ok'] },
        { text: 'bad', credibility: 99 as never, situationTags: ['ok'] },
      ],
    };

    await withClient(async (client) => {
      await expect(ingestSource(client, bad, embedder)).rejects.toThrow();
      const { rows } = await client.query('SELECT 1 FROM field_sources WHERE uri = $1', [bad.uri]);
      expect(rows).toEqual([]);
    });
  });
});
