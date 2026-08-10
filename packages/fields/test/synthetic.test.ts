import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate, closePool, withClient } from '@mae/store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS, DeterministicEmbedder } from '../src/embedder.ts';
import { loadFieldFixture, readFieldFixture } from '../src/fixtures.ts';
import { type SourceInput, assertGraded } from '../src/ingest.ts';
import { retrieve } from '../src/retrieve.ts';

const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';
const embedder = new DeterministicEmbedder(EMBEDDING_DIMENSIONS);

const FIXTURE_PATH = fileURLToPath(
  new URL('../../../fixtures/fields/composite-qualification.synthetic.json', import.meta.url),
);

describe('synthetic content cannot claim grades it has not earned', () => {
  const base: SourceInput = {
    fieldId: 'materials.polymers_adhesives.synthetic',
    uri: 'synthetic://test',
    grading: { reliability: 'F', contentClass: 'synthetic', gradedBy: 'system:test' },
    chunks: [{ text: 'invented passage', credibility: 6, situationTags: ['surface_preparation'] }],
  };

  it('accepts synthetic content graded F/6', () => {
    expect(() => assertGraded(base)).not.toThrow();
  });

  it('rejects a source that declares no content class', () => {
    // The one case that must not be guessed: guessing curated launders an invention into
    // evidence, guessing synthetic silently discards real curation effort.
    const undeclared = {
      ...base,
      grading: { reliability: 'F', gradedBy: 'system:test' },
    } as unknown as SourceInput;
    expect(() => assertGraded(undeclared)).toThrow(/does not declare a content class/);
  });

  it('rejects synthetic content claiming a real reliability grade', () => {
    const inflated: SourceInput = { ...base, grading: { ...base.grading, reliability: 'B' } };
    expect(() => assertGraded(inflated)).toThrow(/it is not weak evidence, it is not evidence/);
  });

  it('rejects synthetic chunks claiming a real credibility grade', () => {
    const inflated: SourceInput = {
      ...base,
      chunks: [{ ...base.chunks[0]!, credibility: 2 }],
    };
    expect(() => assertGraded(inflated)).toThrow(/cannot be judged.*on both axes/);
  });
});

describe('the shipped synthetic fixture', () => {
  const fixture = readFieldFixture(FIXTURE_PATH);

  it('declares itself synthetic', () => {
    expect(fixture.contentClass).toBe('synthetic');
  });

  it('keeps synthetic content in its own field ids', () => {
    // CH012 tests the retrieval set, not the cited chunks, so a field mixing classes would
    // cap every finding drawn from it. Separate field ids are what keep that from happening
    // by accident.
    for (const source of fixture.sources) {
      expect(source.fieldId.endsWith('.synthetic'), source.fieldId).toBe(true);
    }
  });

  it('covers the domains the composite scenario convenes', () => {
    const fields = new Set(fixture.sources.map((s) => s.fieldId.replace(/\.synthetic$/, '')));
    for (const domain of [
      'materials.polymers_adhesives',
      'analytical_detection_design',
      'supply_chain.provenance',
      'logistics_storage',
      'structures',
    ]) {
      expect(fields.has(domain), `no synthetic content for ${domain}`).toBe(true);
    }
  });

  it('gives every chunk situation tags, or it could never be retrieved', () => {
    for (const source of fixture.sources) {
      for (const chunk of source.chunks) {
        expect(chunk.situationTags.length, source.uri).toBeGreaterThan(0);
      }
    }
  });
});

describe.skipIf(!HAS_DB)('synthetic content in the database', () => {
  beforeAll(async () => {
    await withClient((client) => migrate(client));
  });
  afterAll(closePool);

  it('loads the fixture and marks every retrieved chunk synthetic', async () => {
    const fixture = readFieldFixture(FIXTURE_PATH);
    // Namespaced per run so repeated runs do not accumulate.
    const suffix = randomUUID().slice(0, 8);
    const namespaced = {
      ...fixture,
      sources: fixture.sources.map((s) => ({ ...s, fieldId: `${s.fieldId}.${suffix}` })),
    };

    const result = await withClient((client) => loadFieldFixture(client, namespaced, embedder));
    expect(result.contentClass).toBe('synthetic');
    expect(result.chunks).toBeGreaterThan(0);

    const retrieved = await withClient((client) =>
      retrieve(
        client,
        `analytical_detection_design.synthetic.${suffix}`,
        { situationType: 'sampling_plan_limits', failureModes: ['low_rate_insertion'] },
        10,
      ),
    );

    expect(retrieved.length).toBeGreaterThan(0);
    for (const r of retrieved) {
      // The marking has to survive the whole path to the persona; CH012 reads it there.
      expect(r.chunk.contentClass).toBe('synthetic');
      // F and 6 — cannot be judged on either axis.
      expect(r.chunk.reliability).toBe('F');
      expect(r.chunk.credibility).toBe(6);
    }
  });

  it('refuses at the database even if the ingest checks were bypassed', async () => {
    // Defence in depth, same shape as the ledger's trigger: the application check stops the
    // application, and the constraint stops everything else.
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO field_sources (id, field_id, uri, reliability, graded_by, graded_at, content_class)
           VALUES ($1, 'f', 'synthetic://bypass', 'B', 'system:test', now(), 'synthetic')`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/field_sources_synthetic_cannot_be_judged/);
    });
  });

  it('refuses a synthetic chunk graded better than 6 at the database', async () => {
    const sourceId = randomUUID();
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO field_sources (id, field_id, uri, reliability, graded_by, graded_at, content_class)
         VALUES ($1, 'f', $2, 'F', 'system:test', now(), 'synthetic')`,
        [sourceId, `synthetic://chunk-bypass/${sourceId}`],
      );

      await expect(
        client.query(
          `INSERT INTO field_chunks (id, source_id, field_id, text, credibility, situation_tags)
           VALUES ($1, $2, 'f', 'invented', 2, ARRAY['t'])`,
          [randomUUID(), sourceId],
        ),
      ).rejects.toThrow(/must carry credibility 6/);
    });
  });

  it('requires a content class on every new source', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO field_sources (id, field_id, uri, reliability, graded_by, graded_at)
           VALUES ($1, 'f', 'synthetic://no-class', 'B', 'system:test', now())`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/content_class/);
    });
  });
});
