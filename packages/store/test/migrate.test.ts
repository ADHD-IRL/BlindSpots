import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadMigrations, migrate } from '../src/migrate.ts';
import { HAS_DB, teardown, withClient } from './helpers.ts';

describe('loadMigrations', () => {
  it('loads the shipped migrations in order', () => {
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(6);
    expect(migrations.map((m) => m.id)).toEqual([...migrations.map((m) => m.id)].sort());
  });

  it('rejects a file that is not <digits>_<description>.sql', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mae-mig-'));
    writeFileSync(join(dir, 'oops.sql'), 'SELECT 1;');
    expect(() => loadMigrations(dir)).toThrow(/must be named/);
  });
});

describe.skipIf(!HAS_DB)('migrate (database)', () => {
  afterAll(teardown);

  it('is idempotent', async () => {
    await withClient(async (client) => {
      await migrate(client);
      const second = await migrate(client);
      expect(second.applied).toEqual([]);
      expect(second.skipped.length).toBeGreaterThanOrEqual(6);
    });
  });

  it('refuses to proceed when an applied migration was edited', async () => {
    // Editing an applied migration means the database no longer matches the file that
    // claims to describe it. For a schema whose integrity guarantee is the product, that
    // is a hard failure rather than a warning.
    const dir = mkdtempSync(join(tmpdir(), 'mae-mig-'));
    writeFileSync(join(dir, '9001_probe.sql'), 'CREATE TABLE mig_probe (id INT);');

    await withClient(async (client) => {
      try {
        await migrate(client, dir);
        writeFileSync(join(dir, '9001_probe.sql'), 'CREATE TABLE mig_probe (id BIGINT);');
        await expect(migrate(client, dir)).rejects.toThrow(/was modified after being applied/);
      } finally {
        await client.query('DROP TABLE IF EXISTS mig_probe');
        await client.query("DELETE FROM _migrations WHERE id = '9001'");
      }
    });
  });
});
