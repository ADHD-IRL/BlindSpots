import {
  type CharterViolation,
  type FindingDraft,
  MAX_REPAIR_ATTEMPTS,
  type PersonaContext,
  type Scenario,
  nextRepairState,
  validateFinding,
} from '@mae/core';
import {
  ModelRefusalError,
  type ModelRequest,
  type ModelResponse,
  type ModelTransport,
  TruncatedResponseError,
  assertUsable,
} from '../model/types.ts';
import { IncompleteResponseError } from '../model/types.ts';
import { type BriefOptions, buildPersonaRequest, buildRepairRequest } from './brief.ts';
import { FindingParseError, parseFinding } from './parse.ts';

/**
 * One persona, one finding.
 *
 * This is the loop the whole architecture was built around, and it is deliberately small:
 * retrieval, the model call, the parse, the validator, the repair reducer. Every decision in
 * it was already made and tested somewhere else — `validateFinding` decides conformance,
 * `nextRepairState` decides consequence — so what remains here is only the joining, and a
 * bug here cannot quietly loosen a rule.
 *
 * Nothing throws out of it for a model-side failure. A refusal, a truncation and an
 * unparseable answer are all real outcomes of asking a model a question, and each one has to
 * be recorded as what it was rather than crashing a panel run halfway through.
 */

export interface PersonaAttempt {
  readonly request: ModelRequest;
  /** Null when the transport itself failed, which is why it is not simply omitted. */
  readonly response: ModelResponse | null;
  readonly violations: readonly CharterViolation[];
}

export type PersonaOutcome = {
  readonly personaId: string;
  /** Every round trip, in order, so the ledger can record what was asked and answered. */
  readonly attempts: readonly PersonaAttempt[];
} & (
  | { readonly kind: 'accepted'; readonly finding: FindingDraft }
  | {
      readonly kind: 'discarded';
      readonly reason: 'non_remediable' | 'repair_failed' | 'unparseable' | 'incomplete';
      readonly violations: readonly CharterViolation[];
      readonly detail: string;
    }
  | {
      readonly kind: 'routed';
      readonly routeTo: string;
      readonly violations: readonly CharterViolation[];
    }
  | { readonly kind: 'refused'; readonly refusalCategory: string }
);

export async function runPersona(
  transport: ModelTransport,
  scenario: Scenario,
  ctx: PersonaContext,
  options: BriefOptions,
): Promise<PersonaOutcome> {
  // The evidence comes from `ctx.retrievedChunks` and nowhere else. Taking the passages as a
  // separate argument would allow a prompt showing one retrieval set while the validator
  // checked another — and CH003 and CH009 both test the finding against the retrieval set,
  // so the two drifting apart would silently disable them.
  const attempts: PersonaAttempt[] = [];
  let request = buildPersonaRequest(scenario, ctx, ctx.retrievedChunks, options);

  for (let attempt = 0; ; attempt++) {
    let response: ModelResponse;
    try {
      response = assertUsable(await transport.complete(request));
    } catch (error) {
      attempts.push({ request, response: null, violations: [] });
      return terminalFromTransport(ctx.personaId, attempts, error);
    }

    let finding: FindingDraft;
    try {
      finding = parseFinding(response.text, ctx.personaId);
    } catch (error) {
      attempts.push({ request, response, violations: [] });
      if (!(error instanceof FindingParseError)) throw error;
      // Terminal, and deliberately not given the repair attempt. An unparseable answer says
      // the request is wrong, not that the finding is; spending the charter's single repair
      // on it would both hide a systematic prompt fault and leave a real violation with no
      // attempt left.
      return {
        personaId: ctx.personaId,
        attempts,
        kind: 'discarded',
        reason: 'unparseable',
        violations: [],
        detail: error.message,
      };
    }

    const violations = validateFinding(finding, ctx);
    attempts.push({ request, response, violations });

    const state = nextRepairState(violations, attempt);
    switch (state.kind) {
      case 'accepted':
        return { personaId: ctx.personaId, attempts, kind: 'accepted', finding };
      case 'routed':
        return {
          personaId: ctx.personaId,
          attempts,
          kind: 'routed',
          routeTo: state.routeTo,
          violations: state.violations,
        };
      case 'discarded':
        return {
          personaId: ctx.personaId,
          attempts,
          kind: 'discarded',
          reason: state.reason,
          violations: state.violations,
          detail: state.violations.map((v) => v.code).join(', '),
        };
      case 'awaiting_repair':
        request = buildRepairRequest(request, response.text, state.violations, options);
        break;
    }

    /* c8 ignore next 4 */
    if (attempt > MAX_REPAIR_ATTEMPTS) {
      // Unreachable: nextRepairState discards once the budget is spent. Present because an
      // unbounded loop around a paid model call is the wrong thing to leave to a proof.
      throw new Error(`Repair loop exceeded ${MAX_REPAIR_ATTEMPTS} attempts`);
    }
  }
}

function terminalFromTransport(
  personaId: string,
  attempts: readonly PersonaAttempt[],
  error: unknown,
): PersonaOutcome {
  // A refusal is a routing event, not an empty finding. It says the model declined the
  // question, which is information about the question — and a panel run must record that
  // rather than treat the persona as having found nothing.
  if (error instanceof ModelRefusalError) {
    return {
      personaId,
      attempts,
      kind: 'refused',
      refusalCategory: error.response.refusalCategory ?? 'unspecified',
    };
  }

  if (error instanceof TruncatedResponseError || error instanceof IncompleteResponseError) {
    return {
      personaId,
      attempts,
      kind: 'discarded',
      reason: 'incomplete',
      violations: [],
      detail: error.message,
    };
  }

  // Anything else — a cassette miss, a network fault, a credential problem — is a fault in
  // the harness rather than an outcome of the question, and must not be recorded as though
  // the persona had said something.
  throw error;
}
