import { randomUUID } from 'node:crypto';
import type { Confidence, FindingDraft, Validity } from '@mae/core';
import type { PoolClient } from './pool.ts';

/**
 * Findings, anchored to the ledger.
 *
 * `findings.ledger_seq` is NOT NULL and references `ledger(seq)`, which forces the order:
 * the ledger entry is written first and the finding row points at it. That is what makes
 * "this finding existed at this point in the chain" a fact about the schema rather than a
 * convention — a finding cannot be inserted without an entry, and the entry cannot be
 * altered without breaking the hash chain.
 *
 * Nothing here decides whether a finding is admissible. `validateFinding` did that before
 * this is ever called; a store that re-litigated the charter would be a second place for
 * the rules to live and drift.
 */

export interface RecordFindingArgs {
  readonly eventId: string;
  readonly phase: number;
  readonly finding: FindingDraft;
  /** The seq of the `persona_output` entry this finding was recorded under. */
  readonly ledgerSeq: number;
  /** From `PersistedMember.provisional` — §C.5.2 carries the marking to the package. */
  readonly provisional: boolean;
  readonly findingId?: string;
}

export interface PersistedFinding {
  readonly id: string;
  readonly eventId: string;
  readonly personaId: string;
  readonly phase: number;
  readonly statement: string;
  readonly confidence: Confidence;
  readonly validityTier: Validity;
  readonly basis: string;
  readonly sourceGrades: FindingDraft['sourceGrades'];
  readonly provisional: boolean;
  readonly ledgerSeq: number;
}

export async function recordFinding(client: PoolClient, args: RecordFindingArgs): Promise<string> {
  const { finding } = args;
  const id = args.findingId ?? randomUUID();

  await client.query(
    `INSERT INTO findings
       (id, event_id, persona_id, phase, statement, confidence, validity_tier, basis,
        source_grades, sampling_rate, false_negative_rate, provisional, ledger_seq)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)`,
    [
      id,
      args.eventId,
      finding.personaId,
      args.phase,
      finding.statement,
      finding.confidence,
      finding.validityTier,
      finding.basis,
      JSON.stringify(
        finding.sourceGrades.map((g) => ({
          chunk_id: g.chunkId,
          reliability: g.reliability,
          credibility: g.credibility,
        })),
      ),
      finding.samplingRate ?? null,
      finding.falseNegativeRate ?? null,
      args.provisional,
      args.ledgerSeq,
    ],
  );

  return id;
}

export interface RecordGapArgs {
  readonly eventId: string;
  readonly personaId: string;
  /** The record that does not exist or cannot be reached. */
  readonly recordNamed: string;
  readonly holder?: string;
  /** What could not be concluded without it. */
  readonly claimBlocked: string;
  readonly obtainable?: boolean;
  readonly ledgerSeq: number;
}

/**
 * A gap declaration.
 *
 * §C.2.7 calls the aggregate of these the archetype's most valuable single output — a map of
 * where the programme is trusting documents it cannot check. Recorded as its own row rather
 * than as a finding with `confidence: 'gap'` so that map can be queried without reasoning
 * about confidence terms, which is how it will actually be used.
 */
export async function recordGapDeclaration(client: PoolClient, args: RecordGapArgs): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO gap_declarations
       (id, event_id, persona_id, record_named, holder, claim_blocked, obtainable, ledger_seq)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      args.eventId,
      args.personaId,
      args.recordNamed,
      args.holder ?? null,
      args.claimBlocked,
      args.obtainable ?? null,
      args.ledgerSeq,
    ],
  );
  return id;
}

export async function listFindings(
  client: PoolClient,
  eventId: string,
): Promise<PersistedFinding[]> {
  const { rows } = await client.query<{
    id: string;
    event_id: string;
    persona_id: string;
    phase: number;
    statement: string;
    confidence: Confidence;
    validity_tier: Validity;
    basis: string;
    source_grades: { chunk_id: string; reliability: string; credibility: number }[];
    provisional: boolean;
    ledger_seq: string;
  }>(
    `SELECT id, event_id, persona_id, phase, statement, confidence, validity_tier, basis,
            source_grades, provisional, ledger_seq
       FROM findings WHERE event_id = $1 ORDER BY ledger_seq`,
    [eventId],
  );

  return rows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    personaId: r.persona_id,
    phase: r.phase,
    statement: r.statement,
    confidence: r.confidence,
    validityTier: r.validity_tier,
    basis: r.basis,
    sourceGrades: r.source_grades.map((g) => ({
      chunkId: g.chunk_id,
      reliability: g.reliability as FindingDraft['sourceGrades'][number]['reliability'],
      credibility: g.credibility as FindingDraft['sourceGrades'][number]['credibility'],
    })),
    provisional: r.provisional,
    ledgerSeq: Number(r.ledger_seq),
  }));
}
