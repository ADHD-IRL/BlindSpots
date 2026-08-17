import type { CanonicalValue, GradedChunk, PersonaContext } from '@mae/core';
import {
  type PoolClient,
  appendLedger,
  recordFinding,
  recordGapDeclaration,
} from '@mae/store';
import type { PersonaAttempt, PersonaOutcome } from './run.ts';

/**
 * Writing a persona's outcome to the record.
 *
 * Every outcome is recorded, not only the accepted ones. §B.13's instrumentation list is an
 * enumeration of what must be recoverable after the fact, and a discard that leaves no trace
 * is indistinguishable from a persona that was never asked. The discards and routings are
 * the interesting half: they are where the charter actually did something.
 *
 * The retrieval entry goes first, always, including when the model then refused. What was in
 * front of the persona is a fact about the run independent of what came back, and CH003 and
 * CH009 are both judged against it — so a reviewer has to be able to see it even when there
 * is no finding to judge.
 */

export interface PersistOutcomeArgs {
  readonly eventId: string;
  readonly phase: number;
  readonly outcome: PersonaOutcome;
  readonly ctx: PersonaContext;
  readonly fieldId: string;
  readonly provisional: boolean;
}

export interface PersistedOutcome {
  readonly retrievalSeq: number;
  readonly outcomeSeq: number;
  readonly findingId: string | null;
  readonly gapId: string | null;
}

export async function persistOutcome(
  client: PoolClient,
  args: PersistOutcomeArgs,
): Promise<PersistedOutcome> {
  const { eventId, phase, outcome, ctx } = args;

  const retrieval = await appendLedger(client, {
    eventId,
    phase,
    actor: ctx.personaId,
    kind: 'retrieval',
    payload: {
      fieldId: args.fieldId,
      chunkIds: ctx.retrievedChunks.map((c) => c.id),
      grades: ctx.retrievedChunks.map(gradeOf),
      // Carried explicitly rather than inferred from the grades later: CH012 keys off this,
      // and a reviewer reconstructing why a finding was capped needs it stated.
      syntheticChunks: ctx.retrievedChunks.filter((c) => c.contentClass === 'synthetic').length,
    },
  });

  const attempts = args.outcome.attempts.map(attemptSummary);

  switch (outcome.kind) {
    case 'accepted': {
      const entry = await appendLedger(client, {
        eventId,
        phase,
        actor: ctx.personaId,
        kind: 'persona_output',
        payload: {
          statement: outcome.finding.statement,
          confidence: outcome.finding.confidence,
          validityTier: outcome.finding.validityTier,
          basis: outcome.finding.basis,
          syntheticBasis: outcome.finding.syntheticBasis ?? false,
          sourceGrades: outcome.finding.sourceGrades.map((g) => ({
            chunkId: g.chunkId,
            reliability: g.reliability,
            credibility: g.credibility,
          })),
          attempts,
        },
      });

      const findingId = await recordFinding(client, {
        eventId,
        phase,
        finding: outcome.finding,
        ledgerSeq: entry.seq,
        provisional: args.provisional,
      });

      // A gap is a finding *and* a row in the gap map. §C.2.7 treats the aggregate of these
      // as the most valuable single output of the evidence-access archetypes, and it has to
      // be queryable without reasoning about confidence terms.
      const gapId =
        outcome.finding.confidence === 'gap'
          ? await recordGapDeclaration(client, {
              eventId,
              personaId: ctx.personaId,
              recordNamed: outcome.finding.basis,
              claimBlocked: outcome.finding.statement,
              ledgerSeq: entry.seq,
            })
          : null;

      return { retrievalSeq: retrieval.seq, outcomeSeq: entry.seq, findingId, gapId };
    }

    case 'routed': {
      // Terminating, and no partial output is written. A persona answering the safe eighty
      // percent of a prohibited request has answered a prohibited request (§C.2.4).
      const entry = await appendLedger(client, {
        eventId,
        phase,
        actor: ctx.personaId,
        kind: 'routing_event',
        payload: {
          routeTo: outcome.routeTo,
          violations: outcome.violations.map((v) => ({ code: v.code, detail: v.detail })),
          attempts,
        },
      });
      return { retrievalSeq: retrieval.seq, outcomeSeq: entry.seq, findingId: null, gapId: null };
    }

    case 'discarded': {
      const entry = await appendLedger(client, {
        eventId,
        phase,
        actor: ctx.personaId,
        kind: 'finding_discarded',
        payload: {
          reason: outcome.reason,
          detail: outcome.detail,
          violations: outcome.violations.map((v) => ({ code: v.code, detail: v.detail })),
          attempts,
        },
      });
      return { retrievalSeq: retrieval.seq, outcomeSeq: entry.seq, findingId: null, gapId: null };
    }

    case 'refused': {
      // Recorded as a discard with its category rather than as a routing event. A routing
      // event asserts that a named authority owns the question; a model refusal does not
      // establish that, and claiming it would put a conclusion in the record that nothing
      // supports. It is still worth reading: a refusal here is a signal about the question.
      const entry = await appendLedger(client, {
        eventId,
        phase,
        actor: ctx.personaId,
        kind: 'finding_discarded',
        payload: {
          reason: 'model_refusal',
          detail: `The model declined the request (${outcome.refusalCategory}).`,
          violations: [],
          attempts,
        },
      });
      return { retrievalSeq: retrieval.seq, outcomeSeq: entry.seq, findingId: null, gapId: null };
    }
  }
}

function gradeOf(chunk: GradedChunk): CanonicalValue {
  return {
    chunkId: chunk.id,
    reliability: chunk.reliability,
    credibility: chunk.credibility,
    contentClass: chunk.contentClass,
  };
}

/**
 * What each round trip was, without the prompt or the answer.
 *
 * The provenance is the load-bearing field: a finding replayed from an authored cassette and
 * one produced by a live call must not look alike in the record. The text is deliberately
 * left out — the finding itself is stored, and duplicating every draft into the ledger would
 * bloat the chain without making anything more auditable.
 */
function attemptSummary(attempt: PersonaAttempt): CanonicalValue {
  return {
    provenance: attempt.response?.provenance ?? 'none',
    transportId: attempt.response?.transportId ?? 'none',
    model: attempt.response?.model ?? 'none',
    stopReason: attempt.response?.stopReason ?? 'none',
    inputTokens: attempt.response?.usage.inputTokens ?? 0,
    outputTokens: attempt.response?.usage.outputTokens ?? 0,
    violations: attempt.violations.map((v) => v.code),
  };
}
