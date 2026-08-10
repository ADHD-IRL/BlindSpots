import { randomUUID } from 'node:crypto';
import type {
  PanelDepth,
  PanelProposal,
  PersonaClass,
  Registry,
  RhoEstimate,
  Scenario,
} from '@mae/core';
import type { PoolClient } from 'pg';
import { appendLedger } from './ledger.ts';

/** Phase 0. Convening (Appendix B §B.6). */
const PHASE_CONVENING = 0;

/**
 * Seniority tier for a persona id (§B.5: `[domain].[specialty].[tier]`).
 *
 * Depth decides it. §B.6 step 4 gives screening members "an abbreviated protocol focused on
 * anomaly pass and relevance determination", which is the journeyman register — §B.5's
 * "principal recognizes; journeyman enumerates". Full depth gets the principal.
 */
const TIER_FOR_DEPTH: Readonly<Record<PanelDepth, string>> = {
  full: 'principal',
  screening: 'journeyman',
};

export class EmptyRosterError extends Error {
  constructor() {
    super(
      'A model roster is required. Every panel member records a model_id for correlation ' +
        'tracking (Appendix B §B.7.2), and a panel whose members have no recorded model ' +
        'cannot have its agreement interpreted at all.',
    );
    this.name = 'EmptyRosterError';
  }
}

export class UnapprovedPanelError extends Error {
  readonly panelId: string;
  readonly missing: readonly ('scenario' | 'panel')[];

  constructor(panelId: string, missing: readonly ('scenario' | 'panel')[]) {
    super(
      `Panel ${panelId} is not cleared to run: ${missing.join(' and ')} approval missing. ` +
        `Appendix B §B.11 lists scenario authorship and panel composition approval as ` +
        `separate non-delegable decisions, and accountability attaches to a named human.`,
    );
    this.name = 'UnapprovedPanelError';
    this.panelId = panelId;
    this.missing = missing;
  }
}

export interface PersistedMember {
  readonly personaId: string;
  readonly domainId: string;
  readonly depth: PanelDepth;
  readonly personaClass: PersonaClass;
  readonly modelId: string;
  readonly provisional: boolean;
}

export interface CorrelationDisclosure {
  readonly nominalCount: number;
  readonly distinctModels: number;
  readonly rho: RhoEstimate;
  readonly statement: string;
  /**
   * Whether §B.9's requirement that the Challenger not share a model with the persona it
   * attacks can be satisfied at all by this panel. M7 asserts on this and is specified to
   * fail loudly rather than degrade quietly.
   */
  readonly challengerIndependenceSatisfiable: boolean;
}

export interface PersistedPanel {
  readonly eventId: string;
  readonly panelId: string;
  readonly scenarioId: string;
  readonly members: readonly PersistedMember[];
  readonly scenarioApprovedBy: string | null;
  readonly panelApprovedBy: string | null;
  readonly correlation: CorrelationDisclosure;
}

export interface OpenEventOptions {
  /**
   * Models available to this panel, assigned round-robin over members sorted by domain id.
   *
   * Required and non-empty. §B.7.2 ranks heterogeneous base models as the single most
   * effective mitigation for correlated error, so which models a panel runs on is a
   * property of the panel worth recording at the moment it is composed — not a runtime
   * detail discovered later.
   */
  readonly modelRoster: readonly string[];
  readonly eventId?: string;
  readonly panelId?: string;
}

/** Writes the scenario. Idempotent on id, so re-opening an event does not duplicate it. */
export async function persistScenario(client: PoolClient, scenario: Scenario): Promise<void> {
  await client.query(
    `INSERT INTO scenarios (
       id, subject, lifecycle_stage, mission_function, consequence_classes,
       informing_decision, decision_date, adversary_set, access_constraints,
       classification, exclusions, authored_by, subject_characteristics
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO NOTHING`,
    [
      scenario.id,
      scenario.subject,
      scenario.lifecycleStage,
      scenario.missionFunction,
      scenario.consequenceClasses,
      scenario.informingDecision,
      scenario.decisionDate ?? null,
      scenario.adversarySet,
      scenario.accessConstraints ?? null,
      scenario.classification,
      JSON.stringify(scenario.exclusions),
      scenario.authoredBy,
      scenario.subjectCharacteristics,
    ],
  );
}

/**
 * Opens a Phase 0 event: scenario, panel, members, and the `panel_proposal` ledger entry.
 *
 * The panel is created UNAPPROVED. §B.6 step 6 puts a human signature between the proposal
 * and everything downstream, and `requireApprovedPanel` is what makes that gate real rather
 * than advisory.
 *
 * The ledger payload carries the whole proposal — per-slot matched predicates, governance
 * gates, routing hints and warnings. Those are the material the Devil's Advocate reviews in
 * §B.6 step 5, and the hash-chained ledger is where reviewable context belongs; putting it
 * in ordinary tables would let it be edited after the fact.
 */
export async function openEvent(
  client: PoolClient,
  scenario: Scenario,
  proposal: PanelProposal,
  registry: Registry,
  options: OpenEventOptions,
): Promise<PersistedPanel> {
  const roster = options.modelRoster;
  if (roster.length === 0) throw new EmptyRosterError();

  const eventId = options.eventId ?? randomUUID();
  const panelId = options.panelId ?? randomUUID();
  const byId = new Map(registry.domains.map((d) => [d.id, d]));

  // Sorted by domain id so model assignment is reproducible for the same proposal and
  // roster. A panel that assigned models differently on each run would make correlation
  // measurements incomparable across events.
  const slots = [...proposal.slots].sort((a, b) => a.domainId.localeCompare(b.domainId));

  const members: PersistedMember[] = slots.map((slot, index) => {
    const domain = byId.get(slot.domainId);
    if (domain === undefined) {
      throw new Error(`Panel slot references unknown domain ${slot.domainId}`);
    }
    return {
      personaId: `${slot.domainId}.${TIER_FOR_DEPTH[slot.depth]}`,
      domainId: slot.domainId,
      depth: slot.depth,
      personaClass: domain.personaClass,
      modelId: roster[index % roster.length]!,
      provisional: domain.status === 'provisional',
    };
  });

  const correlation = discloseCorrelation(members);

  await client.query('BEGIN');
  try {
    await persistScenario(client, scenario);

    await client.query('INSERT INTO panels (id, scenario_id) VALUES ($1, $2)', [
      panelId,
      scenario.id,
    ]);

    for (const member of members) {
      await client.query(
        `INSERT INTO panel_members (panel_id, persona_id, domain_id, depth, persona_class, model_id, provisional)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          panelId,
          member.personaId,
          member.domainId,
          member.depth,
          member.personaClass,
          member.modelId,
          member.provisional,
        ],
      );
    }

    await client.query(
      'INSERT INTO events (id, scenario_id, panel_id, phase) VALUES ($1, $2, $3, $4)',
      [eventId, scenario.id, panelId, PHASE_CONVENING],
    );

    await appendLedger(client, {
      eventId,
      phase: PHASE_CONVENING,
      actor: `human:${scenario.authoredBy.replace(/^human:/, '')}`,
      kind: 'panel_proposal',
      payload: {
        panelId,
        scenarioId: scenario.id,
        implicatedArchetypes: [...proposal.implicatedArchetypes],
        members: members.map((m) => ({ ...m })),
        slots: proposal.slots.map((s) => ({
          domainId: s.domainId,
          archetype: s.archetype,
          depth: s.depth,
          score: s.score,
          archetypeImplicated: s.archetypeImplicated,
          matchedPredicates: s.matchedPredicates.map((p) => ({ ...p })),
        })),
        governanceGates: proposal.governanceGates.map((g) => ({
          archetype: g.archetype,
          impliedBy: [...g.impliedBy],
          reason: g.reason,
        })),
        routingHints: proposal.routingHints.map((h) => ({ ...h })),
        warnings: [...proposal.warnings],
        correlation: {
          nominalCount: correlation.nominalCount,
          distinctModels: correlation.distinctModels,
          statement: correlation.statement,
          challengerIndependenceSatisfiable: correlation.challengerIndependenceSatisfiable,
        },
      },
    });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  return {
    eventId,
    panelId,
    scenarioId: scenario.id,
    members,
    scenarioApprovedBy: null,
    panelApprovedBy: null,
    correlation,
  };
}

/**
 * ρ is `unmeasured` until a ground-truth probe set exists (§E.4.2). It is deliberately not
 * defaulted to zero: zero would assert the personas are independent, which is the one thing
 * personas over a shared base model are known not to be.
 */
function discloseCorrelation(members: readonly PersistedMember[]): CorrelationDisclosure {
  const distinctModels = new Set(members.map((m) => m.modelId)).size;
  const rho: RhoEstimate = { kind: 'unmeasured' };

  // Deliberately NOT `discloseAgreement`'s sentence. That one reports agreement a panel has
  // reached; this panel has not run, and saying "N personas concurred" at composition time
  // would assert a result that does not exist yet. `discloseAgreement` is what Phase 7 calls
  // once there is agreement to report.
  const parts = [
    `${members.length} personas composed across ${distinctModels} ` +
      `${distinctModels === 1 ? 'model' : 'distinct models'}.`,
    'Correlation between personas is UNMEASURED, so any agreement this panel reaches cannot ' +
      'be converted to an effective independent sample size and is uninterpretable as ' +
      'corroboration. A probe set with established ground truth is required first ' +
      '(Appendix E §E.4.2).',
  ];

  if (distinctModels < 2) {
    parts.push(
      "The panel runs on a single model, so Appendix B §B.9's requirement that the " +
        'Challenger not share a model with the persona it attacks cannot be satisfied.',
    );
  }

  return {
    nominalCount: members.length,
    distinctModels,
    rho,
    statement: parts.join(' '),
    challengerIndependenceSatisfiable: distinctModels >= 2,
  };
}

export async function approveScenario(
  client: PoolClient,
  scenarioId: string,
  approvedBy: string,
): Promise<void> {
  await signOff(client, 'scenarios', scenarioId, approvedBy);
}

export async function approvePanel(
  client: PoolClient,
  panelId: string,
  approvedBy: string,
): Promise<void> {
  // One transaction: `appendLedger` takes a transaction-scoped advisory lock to stop
  // concurrent appends forking the chain, and outside an explicit transaction that lock
  // would release after the single statement that took it.
  await client.query('BEGIN');
  try {
    await signOff(client, 'panels', panelId, approvedBy);

    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM events WHERE panel_id = $1 ORDER BY opened_at',
      [panelId],
    );

    for (const row of rows) {
      await appendLedger(client, {
        eventId: row.id,
        phase: PHASE_CONVENING,
        actor: `human:${approvedBy.replace(/^human:/, '')}`,
        kind: 'panel_approval',
        payload: { panelId, approvedBy },
      });
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function signOff(
  client: PoolClient,
  table: 'scenarios' | 'panels',
  id: string,
  approvedBy: string,
): Promise<void> {
  if (approvedBy.trim() === '') {
    throw new Error(
      'Approval requires a named human. §B.11: accountability attaches to a named human.',
    );
  }

  // Table name is a closed union, never caller input.
  const { rowCount } = await client.query(
    `UPDATE ${table} SET approved_by = $1, approved_at = now() WHERE id = $2`,
    [approvedBy, id],
  );

  if (rowCount === 0) throw new Error(`No ${table} row with id ${id}`);
}

export async function loadPanel(client: PoolClient, panelId: string): Promise<PersistedPanel> {
  const { rows: panelRows } = await client.query<{
    panel_id: string;
    scenario_id: string;
    panel_approved_by: string | null;
    scenario_approved_by: string | null;
    event_id: string | null;
  }>(
    `SELECT p.id AS panel_id, p.scenario_id, p.approved_by AS panel_approved_by,
            s.approved_by AS scenario_approved_by, e.id AS event_id
       FROM panels p
       JOIN scenarios s ON s.id = p.scenario_id
       LEFT JOIN events e ON e.panel_id = p.id
      WHERE p.id = $1`,
    [panelId],
  );

  const panel = panelRows[0];
  if (panel === undefined) throw new Error(`No panel with id ${panelId}`);

  const { rows: memberRows } = await client.query<{
    persona_id: string;
    domain_id: string;
    depth: PanelDepth;
    persona_class: PersonaClass;
    model_id: string;
    provisional: boolean;
  }>(
    `SELECT persona_id, domain_id, depth, persona_class, model_id, provisional
       FROM panel_members WHERE panel_id = $1 ORDER BY domain_id`,
    [panelId],
  );

  const members: PersistedMember[] = memberRows.map((r) => ({
    personaId: r.persona_id,
    domainId: r.domain_id,
    depth: r.depth,
    personaClass: r.persona_class,
    modelId: r.model_id,
    provisional: r.provisional,
  }));

  return {
    eventId: panel.event_id ?? '',
    panelId: panel.panel_id,
    scenarioId: panel.scenario_id,
    members,
    scenarioApprovedBy: panel.scenario_approved_by,
    panelApprovedBy: panel.panel_approved_by,
    correlation: discloseCorrelation(members),
  };
}

/**
 * The gate M4 calls before instantiating a single persona.
 *
 * BOTH signatures are required. §B.11 lists scenario authorship and panel composition
 * approval as two separate non-delegable decisions — one human signing the panel does not
 * ratify the framing, and framing errors dominate (§B.6 step 5).
 */
export async function requireApprovedPanel(
  client: PoolClient,
  panelId: string,
): Promise<PersistedPanel> {
  const panel = await loadPanel(client, panelId);

  const missing: ('scenario' | 'panel')[] = [];
  if (panel.scenarioApprovedBy === null) missing.push('scenario');
  if (panel.panelApprovedBy === null) missing.push('panel');
  if (missing.length > 0) throw new UnapprovedPanelError(panelId, missing);

  return panel;
}

/** Rebuilds a `Scenario` from the record, so a persisted charter can be re-convened. */
export async function loadScenario(client: PoolClient, scenarioId: string): Promise<Scenario> {
  const { rows } = await client.query<{
    id: string;
    subject: string;
    lifecycle_stage: Scenario['lifecycleStage'];
    mission_function: string;
    consequence_classes: Scenario['consequenceClasses'];
    informing_decision: string;
    decision_date: Date | null;
    adversary_set: string[];
    access_constraints: string | null;
    classification: string;
    exclusions: Scenario['exclusions'];
    authored_by: string;
    subject_characteristics: string[];
  }>('SELECT * FROM scenarios WHERE id = $1', [scenarioId]);

  const row = rows[0];
  if (row === undefined) throw new Error(`No scenario with id ${scenarioId}`);

  return {
    id: row.id,
    subject: row.subject,
    lifecycleStage: row.lifecycle_stage,
    missionFunction: row.mission_function,
    consequenceClasses: row.consequence_classes,
    informingDecision: row.informing_decision,
    ...(row.decision_date === null
      ? {}
      : { decisionDate: row.decision_date.toISOString().slice(0, 10) }),
    adversarySet: row.adversary_set,
    ...(row.access_constraints === null ? {} : { accessConstraints: row.access_constraints }),
    classification: row.classification,
    subjectCharacteristics: row.subject_characteristics,
    exclusions: row.exclusions,
    authoredBy: row.authored_by,
  };
}
