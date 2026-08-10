import type { CharterViolation } from './types.ts';

/**
 * The repair state machine.
 *
 * "On violation, return the finding to the persona with the specific violation codes and one
 * repair attempt. Second failure discards the finding and logs the discard. Never silently
 * accept."
 *
 * Modelled as a pure reducer so the policy is testable now, before any model is called. M4
 * supplies only the model round trip; the decision of what happens next is decided here.
 */

export type RepairState =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'awaiting_repair'; readonly violations: readonly CharterViolation[] }
  | {
      readonly kind: 'discarded';
      readonly reason: 'non_remediable' | 'repair_failed';
      readonly violations: readonly CharterViolation[];
    }
  | {
      readonly kind: 'routed';
      readonly routeTo: string;
      readonly violations: readonly CharterViolation[];
    };

export const INITIAL_ATTEMPT = 0;
export const MAX_REPAIR_ATTEMPTS = 1;

/**
 * Decides what happens to a finding given its violations and how many repairs it has had.
 *
 * @param attempt How many repair attempts have already been spent. 0 on first evaluation.
 */
export function nextRepairState(
  violations: readonly CharterViolation[],
  attempt: number = INITIAL_ATTEMPT,
): RepairState {
  if (violations.length === 0) return { kind: 'accepted' };

  // Routing terminates before anything else. A persona answering the safe eighty percent of
  // a prohibited request has answered a prohibited request, so there is no partial output
  // and no repair offered.
  const routed = violations.find((v) => v.routeTo !== undefined);
  if (routed !== undefined) {
    return { kind: 'routed', routeTo: routed.routeTo!, violations };
  }

  if (violations.some((v) => !v.remediable)) {
    return { kind: 'discarded', reason: 'non_remediable', violations };
  }

  if (attempt >= MAX_REPAIR_ATTEMPTS) {
    return { kind: 'discarded', reason: 'repair_failed', violations };
  }

  return { kind: 'awaiting_repair', violations };
}

/**
 * Whether a state means the finding never enters the record as a finding.
 * Discards and routings are still logged — the point is that they are logged as what they
 * are, rather than quietly becoming findings.
 */
export function isRejected(state: RepairState): boolean {
  return state.kind === 'discarded' || state.kind === 'routed';
}
