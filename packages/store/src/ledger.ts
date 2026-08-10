import {
  GENESIS_PREV_HASH,
  type LedgerEntry,
  type StoredLedgerEntry,
  type VerifyResult,
  computeHash,
  verifyChain,
} from '@mae/core';
import type { PoolClient } from 'pg';

/**
 * Advisory lock namespace for per-event ledger appends. Two concurrent appends to the same
 * event would otherwise both read the same tail and produce a forked chain, which
 * `verifyChain` would correctly report as corruption after the fact — too late to be
 * useful. The lock makes the fork impossible rather than detectable.
 */
const APPEND_LOCK_NAMESPACE = 0x6d61_6532; // 'mae2'

function eventLockKey(eventId: string): number {
  // A 32-bit signed key derived from the event UUID. Collisions between distinct events
  // only cost serialization, never correctness.
  let h = 0;
  for (let i = 0; i < eventId.length; i++) {
    h = (Math.imul(h, 31) + eventId.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Appends one entry to an event's chain and returns it with its assigned chain fields.
 *
 * Must be called inside a transaction: the advisory lock is transaction-scoped, so it
 * releases exactly when the insert commits or rolls back.
 */
export async function appendLedger(
  client: PoolClient,
  entry: LedgerEntry,
): Promise<StoredLedgerEntry> {
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
    APPEND_LOCK_NAMESPACE,
    eventLockKey(entry.eventId),
  ]);

  const { rows } = await client.query<{ hash: string }>(
    'SELECT hash FROM ledger WHERE event_id = $1 ORDER BY seq DESC LIMIT 1',
    [entry.eventId],
  );
  const prevHash = rows[0]?.hash ?? GENESIS_PREV_HASH;

  // Hashed from the canonical form (see @mae/core), stored as JSONB. Postgres normalizes
  // JSONB key order on its own, which is exactly why the hash is computed here rather than
  // recomputed from a database round-trip.
  const hash = computeHash(entry, prevHash);

  const inserted = await client.query<{ seq: string }>(
    `INSERT INTO ledger (event_id, phase, actor, kind, payload, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING seq`,
    [
      entry.eventId,
      entry.phase,
      entry.actor,
      entry.kind,
      JSON.stringify(entry.payload),
      prevHash,
      hash,
    ],
  );

  return { ...entry, seq: Number(inserted.rows[0]!.seq), prevHash, hash };
}

export async function loadChain(
  client: PoolClient,
  eventId: string,
): Promise<StoredLedgerEntry[]> {
  const { rows } = await client.query<{
    seq: string;
    event_id: string;
    phase: number;
    actor: string;
    kind: string;
    payload: unknown;
    prev_hash: string;
    hash: string;
  }>(
    `SELECT seq, event_id, phase, actor, kind, payload, prev_hash, hash
       FROM ledger WHERE event_id = $1 ORDER BY seq ASC`,
    [eventId],
  );

  return rows.map((r) => ({
    seq: Number(r.seq),
    eventId: r.event_id,
    phase: r.phase,
    actor: r.actor,
    kind: r.kind as StoredLedgerEntry['kind'],
    payload: r.payload as StoredLedgerEntry['payload'],
    prevHash: r.prev_hash,
    hash: r.hash,
  }));
}

/**
 * Verifies an event's chain end to end.
 *
 * Run as a precondition of output package generation and in CI against fixtures. A phase
 * transition is gated on this passing, because an unverifiable chain means the claim that
 * Phase 1 outputs preceded Phase 2 visibility cannot be substantiated.
 */
export async function verifyLedger(client: PoolClient, eventId: string): Promise<VerifyResult> {
  return verifyChain(await loadChain(client, eventId));
}
