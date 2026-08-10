import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendLedger, loadChain, verifyLedger } from '../src/ledger.ts';
import { HAS_DB, setupSchema, teardown, withClient } from './helpers.ts';

/**
 * Appends `payloads` to `eventId`, one transaction each.
 * Mirrors how the engine appends: every entry is committed before the next is built.
 */
async function append(eventId: string, payloads: readonly Record<string, unknown>[]): Promise<void> {
  await withClient(async (client) => {
    for (const payload of payloads) {
      await client.query('BEGIN');
      await appendLedger(client, {
        eventId,
        phase: 1,
        actor: 'materials.metallurgy.principal',
        kind: 'persona_output',
        payload,
      });
      await client.query('COMMIT');
    }
  });
}

describe.skipIf(!HAS_DB)('ledger (database)', () => {
  beforeAll(setupSchema);
  afterAll(teardown);

  it('chains appends and verifies clean', async () => {
    const eventId = randomUUID();
    await append(eventId, [0, 1, 2, 3, 4].map((index) => ({ index })));

    await withClient(async (client) => {
      expect(await loadChain(client, eventId)).toHaveLength(5);
      expect(await verifyLedger(client, eventId)).toEqual({ ok: true });
    });
  });

  it('does not collide when two events open identically', async () => {
    // Every chain roots at the same genesis prev_hash, so without event_id in the preimage
    // these two first entries would hash alike and collide on ledger_hash_uq. See
    // hashPreimage: binding the entry to its event is what makes this safe.
    const a = randomUUID();
    const b = randomUUID();
    await append(a, [{ statement: 'identical opening finding' }]);
    await append(b, [{ statement: 'identical opening finding' }]);

    await withClient(async (client) => {
      const [chainA, chainB] = [await loadChain(client, a), await loadChain(client, b)];
      expect(chainA[0]!.hash).not.toBe(chainB[0]!.hash);
      expect(await verifyLedger(client, a)).toEqual({ ok: true });
      expect(await verifyLedger(client, b)).toEqual({ ok: true });
    });
  });

  it('keeps events independent, so interleaved appends still verify', async () => {
    // seq is allocated globally. Two events interleaving take alternating seq values, and
    // each chain must still verify on its own.
    const a = randomUUID();
    const b = randomUUID();

    await withClient(async (client) => {
      for (let i = 0; i < 4; i++) {
        for (const [eventId, actor] of [
          [a, 'structures.principal'],
          [b, 'legal.export_control.principal'],
        ] as const) {
          await client.query('BEGIN');
          await appendLedger(client, {
            eventId,
            phase: 1,
            actor,
            kind: 'persona_output',
            payload: { i },
          });
          await client.query('COMMIT');
        }
      }

      const chainA = await loadChain(client, a);
      expect(chainA).toHaveLength(4);
      // Non-contiguous by construction: b's rows sit between a's.
      expect(chainA[1]!.seq - chainA[0]!.seq).toBeGreaterThan(1);

      expect(await verifyLedger(client, a)).toEqual({ ok: true });
      expect(await verifyLedger(client, b)).toEqual({ ok: true });
    });
  });

  it('rejects UPDATE and DELETE at the database, not just by convention', async () => {
    // REVOKE alone does not constrain the table owner, which is the role we connect as.
    // The trigger is what actually makes this table append-only.
    const eventId = randomUUID();
    await append(eventId, [{ statement: 'recorded' }]);

    await withClient(async (client) => {
      await expect(
        client.query('UPDATE ledger SET actor = $1 WHERE event_id = $2', ['tampered', eventId]),
      ).rejects.toThrow(/append-only/);
    });

    await withClient(async (client) => {
      await expect(
        client.query('DELETE FROM ledger WHERE event_id = $1', [eventId]),
      ).rejects.toThrow(/append-only/);
    });
  });

  it('detects tampering that bypasses the trigger', async () => {
    // The trigger stops the application. It does not stop someone with direct database
    // access from disabling it, which is exactly why the hash chain exists underneath.
    const eventId = randomUUID();
    await append(eventId, [0, 1, 2, 3].map((i) => ({ statement: `original ${i}` })));

    await withClient(async (client) => {
      const target = (await loadChain(client, eventId))[2]!;

      await client.query('ALTER TABLE ledger DISABLE TRIGGER ledger_no_update');
      try {
        await client.query('UPDATE ledger SET payload = $1 WHERE seq = $2', [
          JSON.stringify({ statement: 'rewritten after the fact' }),
          target.seq,
        ]);
      } finally {
        await client.query('ALTER TABLE ledger ENABLE TRIGGER ledger_no_update');
      }

      expect(await verifyLedger(client, eventId)).toMatchObject({
        ok: false,
        firstDivergence: { seq: target.seq, reason: 'hash_mismatch' },
      });
    });
  });

  it('survives a payload whose JSONB key order Postgres reorders', async () => {
    // Postgres normalizes JSONB key order on storage. The hash is computed from the
    // canonical form before the insert, so a round-trip must still verify.
    const eventId = randomUUID();
    await append(eventId, [{ zulu: 1, alpha: 2, mike: { yankee: 3, bravo: 4 } }]);

    await withClient(async (client) => {
      expect(await verifyLedger(client, eventId)).toEqual({ ok: true });
    });
  });

  it('rejects a kind outside the Scribe instrumentation list', async () => {
    await withClient(async (client) => {
      await expect(
        client.query(
          `INSERT INTO ledger (event_id, phase, actor, kind, payload, prev_hash, hash)
           VALUES ($1, 1, 'system', 'invented_kind', '{}'::jsonb, $2, $3)`,
          [randomUUID(), '0'.repeat(64), randomUUID()],
        ),
      ).rejects.toThrow(/ledger_kind_check/);
    });
  });
});
