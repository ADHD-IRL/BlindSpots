import { computeHash } from './hash.ts';
import {
  GENESIS_PREV_HASH,
  type DivergenceReason,
  type StoredLedgerEntry,
  type VerifyResult,
} from './types.ts';

/**
 * Walks a hash chain and returns the first point at which it diverges from what its own
 * contents imply.
 *
 * Why this exists (implementation plan §2.3): the entire hidden-profile countermeasure
 * rests on Phase 1 outputs existing before Phase 2 opens. If that ordering is not
 * cryptographically demonstrable, the architecture's central claim is unauditable. This
 * function is what makes it demonstrable.
 *
 * Pure: it takes already-loaded rows in `seq` order. The store wraps it as
 * `verifyLedger(eventId)`.
 *
 * @param entries Rows for a single event, ascending by `seq`.
 */
export function verifyChain(entries: readonly StoredLedgerEntry[]): VerifyResult {
  let expectedPrev = GENESIS_PREV_HASH;
  let lastSeq: number | null = null;

  for (const entry of entries) {
    if (lastSeq !== null && entry.seq <= lastSeq) {
      return diverge(
        entry.seq,
        'seq_not_increasing',
        `seq ${entry.seq} does not follow ${lastSeq}`,
      );
    }

    if (entry.prevHash !== expectedPrev) {
      // A reordered or excised entry surfaces here: its recorded prevHash points at a
      // predecessor that is not the entry actually preceding it.
      return diverge(
        entry.seq,
        expectedPrev === GENESIS_PREV_HASH ? 'genesis_prev_hash' : 'prev_hash_mismatch',
        `Expected prev_hash ${expectedPrev}, found ${entry.prevHash}`,
      );
    }

    const recomputed = computeHash(entry, entry.prevHash);
    if (recomputed !== entry.hash) {
      // A mutated payload, actor, kind, or phase surfaces here.
      return diverge(
        entry.seq,
        'hash_mismatch',
        `Recomputed hash ${recomputed} does not match recorded ${entry.hash}`,
      );
    }

    expectedPrev = entry.hash;
    lastSeq = entry.seq;
  }

  return { ok: true };
}

function diverge(seq: number, reason: DivergenceReason, detail: string): VerifyResult {
  return { ok: false, firstDivergence: { seq, reason, detail } };
}

/**
 * Builds the chain fields for the next entry. The store calls this while holding the
 * per-event lock that keeps concurrent appends from forking the chain.
 */
export function linkEntry(
  entry: Omit<StoredLedgerEntry, 'seq' | 'prevHash' | 'hash'>,
  prevHash: string,
  seq: number,
): StoredLedgerEntry {
  return { ...entry, seq, prevHash, hash: computeHash(entry, prevHash) };
}
