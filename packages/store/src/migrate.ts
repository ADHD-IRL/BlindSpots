import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/** Postgres advisory lock key, so two runners cannot apply the same migration twice. */
const LOCK_KEY = 0x6d61_6531; // 'mae1'

export interface Migration {
  readonly id: string; // '0001'
  readonly name: string; // '0001_registry.sql'
  readonly sql: string;
  readonly checksum: string;
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8');
      const id = name.split('_')[0];
      if (id === undefined || !/^\d+$/.test(id)) {
        throw new Error(`Migration ${name} must be named <digits>_<description>.sql`);
      }
      return { id, name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

export interface MigrateResult {
  readonly applied: string[];
  readonly skipped: string[];
}

/**
 * Applies pending migrations, forward only.
 *
 * A checksum mismatch on an already-applied migration is a hard failure rather than a
 * warning. Editing an applied migration means the database no longer matches the file that
 * claims to describe it, and for a schema whose integrity guarantees are the product this
 * is not a difference worth tolerating.
 */
export async function migrate(client: PoolClient, dir?: string): Promise<MigrateResult> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    const { rows } = await client.query<{ id: string; name: string; checksum: string }>(
      'SELECT id, name, checksum FROM _migrations',
    );
    const applied = new Map(rows.map((r) => [r.id, r]));

    const result: MigrateResult = { applied: [], skipped: [] };

    for (const migration of loadMigrations(dir)) {
      const previous = applied.get(migration.id);
      if (previous !== undefined) {
        if (previous.checksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.name} was modified after being applied ` +
              `(recorded ${previous.checksum.slice(0, 12)}, file ${migration.checksum.slice(0, 12)}). ` +
              `Migrations are forward-only: add a new one instead.`,
          );
        }
        result.skipped.push(migration.name);
        continue;
      }

      // One transaction per file, so a failure leaves no half-applied schema behind.
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO _migrations (id, name, checksum) VALUES ($1, $2, $3)', [
          migration.id,
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.name} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
      result.applied.push(migration.name);
    }

    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}
