import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.ts';
import type { LedgerEntry } from './types.ts';

/**
 * `hash = sha256(event_id || prev_hash || canonical_json(payload) || actor || kind || phase)`
 *
 * `event_id` is a deliberate addition to the formula in the implementation plan §2.3, which
 * reads `sha256(prev_hash || canonical_json(payload) || actor || kind || phase)`. Two
 * problems follow from omitting it. Every event's chain roots at the same genesis
 * prev_hash, so two events opening with the same actor, kind, phase, and payload produce
 * byte-identical hashes and collide on the `ledger_hash_uq` index. And an entry could be
 * moved from one event to another without invalidating its hash, which is exactly the kind
 * of relocation the chain exists to make impossible. Binding the entry to its event is
 * strictly stronger and costs nothing. Recorded in RECONCILE.md.
 *
 * The field separator matters too. Without one, an actor of `"ab"` with kind `"c"` and an actor
 * of `"a"` with kind `"bc"` hash identically, which would let a tampered entry keep a valid
 * hash by shifting a character across a field boundary. U+001F (unit separator) is used
 * because `canonicalJson` escapes control characters inside strings, so the separator
 * cannot occur anywhere in the serialized payload.
 */
const FIELD_SEPARATOR = '\u001f';

export function hashPreimage(entry: LedgerEntry, prevHash: string): string {
  return [
    entry.eventId,
    prevHash,
    canonicalJson(entry.payload),
    entry.actor,
    entry.kind,
    String(entry.phase),
  ].join(FIELD_SEPARATOR);
}

export function computeHash(entry: LedgerEntry, prevHash: string): string {
  return createHash('sha256').update(hashPreimage(entry, prevHash), 'utf8').digest('hex');
}
