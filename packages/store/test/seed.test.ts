import { SEED_DOMAINS } from '@mae/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SpineRiskError, seedRegistry } from '../src/seed.ts';
import { HAS_DB, setupSchema, teardown, withClient } from './helpers.ts';

describe('seedRegistry', () => {
  it('refuses a single-archetype registry without touching the database', async () => {
    // §C.8 stage 1. Checked before any client work, so this holds with no DATABASE_URL.
    const oneArchetype = SEED_DOMAINS.filter((d) => d.archetype === 'latent_physical');
    const client = { query: () => Promise.reject(new Error('must not reach the database')) };

    await expect(seedRegistry(client as never, oneArchetype)).rejects.toThrow(SpineRiskError);
  });
});

describe.skipIf(!HAS_DB)('seedRegistry (database)', () => {
  beforeAll(async () => {
    await setupSchema();
    await withClient(async (client) => {
      await client.query('DELETE FROM relevance_predicates');
      await client.query('DELETE FROM domains');
    });
  });
  afterAll(teardown);

  it('writes every domain and predicate', async () => {
    const result = await withClient((client) => seedRegistry(client, SEED_DOMAINS));

    expect(result.domains).toBe(SEED_DOMAINS.length);
    expect(result.predicates).toBe(SEED_DOMAINS.reduce((n, d) => n + d.predicates.length, 0));
    expect(result.archetypes).toHaveLength(6);
  });

  it('is idempotent', async () => {
    const before = await withClient((client) => client.query('SELECT count(*) FROM domains'));
    await withClient((client) => seedRegistry(client, SEED_DOMAINS));
    const after = await withClient((client) => client.query('SELECT count(*) FROM domains'));

    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('persists the archetype-plural grouping (§B.3.1)', async () => {
    // The whole point of the split: three rows sharing a namespace and holding three
    // different archetypes. An earlier seeder dropped parent_domain silently, so this
    // grouping existed in TypeScript and not in the database.
    const { rows } = await withClient((client) =>
      client.query<{ id: string; parent_domain: string; archetype: string }>(
        `SELECT id, parent_domain, archetype FROM domains
          WHERE parent_domain = 'supply_chain' ORDER BY id`,
      ),
    );

    expect(rows.map((r) => `${r.id}:${r.archetype}`)).toEqual([
      'supply_chain.authenticity:latent_physical',
      'supply_chain.provenance:procedural_interpretive',
      'supply_chain.vendor_intent:attributive_contested',
    ]);
    expect(new Set(rows.map((r) => r.archetype)).size).toBe(3);
  });

  it('groups materials and legal too', async () => {
    const { rows } = await withClient((client) =>
      client.query<{ parent_domain: string; n: string }>(
        `SELECT parent_domain, count(*) AS n FROM domains
          WHERE parent_domain IS NOT NULL GROUP BY parent_domain ORDER BY parent_domain`,
      ),
    );

    expect(rows.map((r) => `${r.parent_domain}=${r.n}`)).toEqual([
      'legal=3',
      'materials=3',
      'supply_chain=3',
    ]);
  });

  it('rejects a parent that is not a namespace prefix of the id', async () => {
    // The FK is gone (migration 0007), so this CHECK is what keeps parent_domain from
    // becoming an arbitrary label.
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO domains (id, display_name, archetype, parent_domain, scope_inclusions, scope_exclusions, status)
           VALUES ('alpha.one', 'Alpha One', 'latent_physical', 'beta', '{}', '[]'::jsonb, 'registered')`,
        ),
      ).rejects.toThrow(/domains_parent_is_namespace/);
    });
  });

  it('rejects a domain that is its own parent', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO domains (id, display_name, archetype, parent_domain, scope_inclusions, scope_exclusions, status)
           VALUES ('loop', 'Loop', 'latent_physical', 'loop', '{}', '[]'::jsonb, 'registered')`,
        ),
      ).rejects.toThrow(/domains_parent_is_namespace/);
    });
  });
});
