import type { Archetype, Domain } from '@mae/core';
import type { PoolClient } from 'pg';

export class SpineRiskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpineRiskError';
  }
}

export interface SeedResult {
  readonly domains: number;
  readonly predicates: number;
  readonly archetypes: readonly Archetype[];
}

/**
 * Writes registry domains and their relevance predicates to Postgres.
 *
 * Refuses a single-archetype registry. Appendix C §C.8 stage 1: "a first stage drawn
 * entirely from one archetype builds a spine that later stages must fight." This is the
 * cheapest possible enforcement point for the architecture's central claim, and refusing
 * here costs an operator one flag while accepting it costs every later stage.
 */
export async function seedRegistry(
  client: PoolClient,
  domains: readonly Domain[],
): Promise<SeedResult> {
  const archetypes = [...new Set(domains.map((d) => d.archetype))].sort();

  if (archetypes.length < 2) {
    throw new SpineRiskError(
      `Refusing to seed from ${archetypes.length} archetype(s). Appendix C §C.8 stage 1 ` +
        `requires at least two: a registry seeded from one builds the spine the architecture ` +
        `exists to prevent, and the golden scenario tests will not catch it.`,
    );
  }

  let predicates = 0;

  await client.query('BEGIN');
  try {
    // Insertion order is irrelevant: parent_domain is a grouping namespace rather than a
    // reference to another row (migration 0007), so no parent has to exist first.
    for (const domain of domains) {
      await client.query(
        `INSERT INTO domains (id, display_name, archetype, parent_domain, scope_inclusions, scope_exclusions, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          domain.id,
          domain.displayName,
          domain.archetype,
          domain.parentDomain ?? null,
          domain.scopeInclusions,
          JSON.stringify(domain.scopeExclusions),
          domain.status,
        ],
      );

      for (const predicate of domain.predicates) {
        const { rowCount } = await client.query(
          `INSERT INTO relevance_predicates (domain_id, kind, value, weight)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (domain_id, kind, value) DO NOTHING`,
          [domain.id, predicate.kind, predicate.value, predicate.weight],
        );
        predicates += rowCount ?? 0;
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return { domains: domains.length, predicates, archetypes };
}
