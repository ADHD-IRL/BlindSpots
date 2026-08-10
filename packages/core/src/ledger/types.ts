import type { CanonicalValue } from './canonical-json.ts';

/**
 * Ledger entry kinds, enumerated from the Scribe's instrumentation list (Appendix B §B.13).
 *
 * The list is closed on purpose. "Logged by the Scribe" in the book is an enumeration of
 * what must be recoverable after the fact, and an open-ended `kind` column would let a
 * later milestone quietly stop recording one of them.
 */
export const LEDGER_KINDS = [
  'persona_output',
  'retrieval',
  'claim_traceback',
  'position_change',
  'challenge_outcome',
  'confidence_assignment',
  'gap_declaration',
  'abandoned_path',
  'human_intervention',
  'routing_event',
  'specificity_override',
  'phase_transition',
  'panel_proposal',
  'panel_approval',
  'finding_discarded',
] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** The prev_hash of the first entry in an event's chain. */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * A ledger entry as it is hashed. `seq` and `createdAt` are assigned by the store and are
 * deliberately absent from the hash preimage: the chain's ordering is carried by
 * `prevHash`, so including a database-assigned sequence would make the hash unverifiable
 * from the entry's own content.
 */
export interface LedgerEntry {
  readonly eventId: string;
  readonly phase: number;
  readonly actor: string;
  readonly kind: LedgerKind;
  readonly payload: CanonicalValue;
}

/** A persisted entry: the hashed content plus the chain fields the store assigned. */
export interface StoredLedgerEntry extends LedgerEntry {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

export type DivergenceReason =
  | 'genesis_prev_hash'
  /**
   * `seq` is allocated globally by the store, not per event, so an event's entries are
   * strictly increasing but not contiguous — other events interleave. Only the ordering is
   * an invariant. Excision within an event is caught by the prev_hash walk, which is the
   * actual integrity mechanism; `seq` is a cheap ordering cross-check on top of it.
   */
  | 'seq_not_increasing'
  | 'prev_hash_mismatch'
  | 'hash_mismatch'
  | 'duplicate_hash';

export interface Divergence {
  readonly seq: number;
  readonly reason: DivergenceReason;
  readonly detail: string;
}

export type VerifyResult = { readonly ok: true } | { readonly ok: false; readonly firstDivergence: Divergence };
