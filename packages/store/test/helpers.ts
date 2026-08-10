import { migrate } from '../src/migrate.ts';
import { closePool, getPool, withClient } from '../src/pool.ts';

/**
 * Database-backed tests skip cleanly when no DATABASE_URL is configured. Not every
 * environment has a Docker daemon, and `core` — where the constraint logic lives — is pure
 * precisely so that the always-run test suite covers the parts that carry correctness.
 * CI supplies a pgvector service container so these do execute there.
 */
export const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';

export async function setupSchema(): Promise<void> {
  await withClient((client) => migrate(client));
}

export async function teardown(): Promise<void> {
  await closePool();
}

export { getPool, withClient };
