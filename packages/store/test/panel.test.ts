import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEED_REGISTRY, type Scenario, convene } from '@mae/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadChain } from '../src/ledger.ts';
import {
  EmptyRosterError,
  UnapprovedPanelError,
  approvePanel,
  approveScenario,
  loadPanel,
  loadScenario,
  openEvent,
  requireApprovedPanel,
} from '../src/panel.ts';
import { seedRegistry } from '../src/seed.ts';
import { HAS_DB, setupSchema, teardown, withClient } from './helpers.ts';

interface Fixture {
  readonly scenario: Scenario;
  readonly expectedPanel: { readonly full: string[]; readonly screening: string[] };
}

function fixture(name: string): Fixture {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../fixtures/scenarios/${name}.json`, import.meta.url)),
      'utf8',
    ),
  ) as Fixture;
}

/** A fresh scenario each time, so tests never collide on the fixture's fixed id. */
function freshScenario(name: string): Scenario {
  return { ...fixture(name).scenario, id: randomUUID() };
}

const ROSTER = ['claude-opus-5', 'other-vendor-model'];

describe.skipIf(!HAS_DB)('panel persistence (database)', () => {
  beforeAll(async () => {
    await setupSchema();
    await withClient((client) => seedRegistry(client, SEED_REGISTRY.domains));
  });
  afterAll(teardown);

  it('opens an event with the panel unapproved', async () => {
    // §B.6 step 6 puts a human signature between the proposal and everything downstream.
    // A panel that arrived pre-approved would make that gate decorative.
    const scenario = freshScenario('composite-qualification');
    const proposal = convene(scenario, SEED_REGISTRY);

    const persisted = await withClient((client) =>
      openEvent(client, scenario, proposal, SEED_REGISTRY, { modelRoster: ROSTER }),
    );

    expect(persisted.members).toHaveLength(proposal.slots.length);
    expect(persisted.scenarioApprovedBy).toBeNull();
    expect(persisted.panelApprovedBy).toBeNull();
  });

  it('derives persona ids, classes and provisional flags from the registry', async () => {
    const scenario = freshScenario('fielded-c2-midlife');
    const proposal = convene(scenario, SEED_REGISTRY);

    const persisted = await withClient((client) =>
      openEvent(client, scenario, proposal, SEED_REGISTRY, { modelRoster: ROSTER }),
    );

    // §B.5: [domain].[specialty].[tier]. Full depth gets the principal register, screening
    // the journeyman, matching §B.6 step 4's abbreviated protocol.
    const ci = persisted.members.find((m) => m.domainId === 'counterintelligence')!;
    expect(ci.personaId).toBe('counterintelligence.principal');
    // §B.4 / §C.3.2: the Phase 1 cross-domain read exception gates on this, not on an ad
    // hoc flag or a hardcoded set of domain ids.
    expect(ci.personaClass).toBe('reflexive');

    const legal = persisted.members.find((m) => m.domainId === 'legal.legal_regulatory')!;
    expect(legal.depth).toBe('screening');
    expect(legal.personaId).toBe('legal.legal_regulatory.journeyman');

    expect(persisted.members.every((m) => m.provisional === false)).toBe(true);
  });

  it('re-convenes the persisted scenario back to the golden panel', async () => {
    // The charter has to be re-derivable from the record, not merely stored. This is the
    // test that catches a scenario column being dropped on the way to the database — which
    // is exactly how `subject_characteristics` went missing.
    const { expectedPanel } = fixture('composite-qualification');
    const scenario = freshScenario('composite-qualification');
    const proposal = convene(scenario, SEED_REGISTRY);

    const persisted = await withClient((client) =>
      openEvent(client, scenario, proposal, SEED_REGISTRY, { modelRoster: ROSTER }),
    );

    const reloaded = await withClient((client) => loadScenario(client, persisted.scenarioId));
    const reconvened = convene(reloaded, SEED_REGISTRY);

    const depth = (want: 'full' | 'screening') =>
      reconvened.slots.filter((s) => s.depth === want).map((s) => s.domainId).sort();

    expect(depth('full')).toEqual(expectedPanel.full);
    expect(depth('screening')).toEqual(expectedPanel.screening);
    // Byte-identical, not merely equivalent: the record must reproduce the proposal exactly.
    expect(JSON.stringify(reconvened.slots)).toBe(JSON.stringify(proposal.slots));
  });

  it('records the proposal, gates and warnings to the hash-chained ledger', async () => {
    const scenario = freshScenario('composite-qualification');
    const proposal = convene(scenario, SEED_REGISTRY);

    const persisted = await withClient((client) =>
      openEvent(client, scenario, proposal, SEED_REGISTRY, { modelRoster: ROSTER }),
    );

    const chain = await withClient((client) => loadChain(client, persisted.eventId));
    expect(chain).toHaveLength(1);
    expect(chain[0]!.kind).toBe('panel_proposal');

    const payload = chain[0]!.payload as Record<string, unknown>;
    // The Devil's Advocate reviews the framing in §B.6 step 5, and needs the governance gate
    // and the warnings, not just the roster.
    expect(payload['governanceGates']).toHaveLength(1);
    expect(JSON.stringify(payload['warnings'])).toContain('below the 8-14 band');
    expect(payload['slots']).toHaveLength(proposal.slots.length);
  });

  describe('the approval gate (§B.11)', () => {
    let panelId = '';

    beforeAll(async () => {
      const scenario = freshScenario('sole-source-decision');
      const proposal = convene(scenario, SEED_REGISTRY);
      const persisted = await withClient((client) =>
        openEvent(client, scenario, proposal, SEED_REGISTRY, { modelRoster: ROSTER }),
      );
      panelId = persisted.panelId;
    });

    it('refuses with neither signature', async () => {
      await withClient(async (client) => {
        await expect(requireApprovedPanel(client, panelId)).rejects.toThrow(UnapprovedPanelError);
      });
    });

    it('refuses with only the panel signed', async () => {
      // Scenario authorship and panel composition approval are separate non-delegable
      // decisions. Signing the composition does not ratify the framing, and framing errors
      // dominate.
      await withClient((client) => approvePanel(client, panelId, 'human:lead_analyst'));

      await withClient(async (client) => {
        await expect(requireApprovedPanel(client, panelId)).rejects.toThrow(/scenario approval missing/);
      });
    });

    it('clears once both are signed', async () => {
      const { scenarioId } = await withClient((client) => loadPanel(client, panelId));
      await withClient((client) => approveScenario(client, scenarioId, 'human:sponsor'));

      const approved = await withClient((client) => requireApprovedPanel(client, panelId));
      expect(approved.panelApprovedBy).toBe('human:lead_analyst');
      expect(approved.scenarioApprovedBy).toBe('human:sponsor');
    });

    it('appends panel_approval to the chain after panel_proposal', async () => {
      const { eventId } = await withClient((client) => loadPanel(client, panelId));
      const chain = await withClient((client) => loadChain(client, eventId));

      expect(chain.map((e) => e.kind)).toEqual(['panel_proposal', 'panel_approval']);
      expect(chain[1]!.actor).toBe('human:lead_analyst');
    });

    it('freezes the composition once approved', async () => {
      // The composition IS the charter. Editing it after signature invalidates every
      // traceback that cites it.
      await withClient(async (client) => {
        await expect(
          client.query('UPDATE panel_members SET depth = $1 WHERE panel_id = $2', ['screening', panelId]),
        ).rejects.toThrow(/composition is frozen/);
      });
    });

    it('refuses to move a signature once set', async () => {
      await withClient(async (client) => {
        await expect(
          client.query('UPDATE panels SET approved_by = $1 WHERE id = $2', ['human:someone_else', panelId]),
        ).rejects.toThrow(/approval is write-once/);
      });
    });

    it('requires a named human', async () => {
      const scenario = freshScenario('fielded-c2-midlife');
      const proposal = convene(scenario, SEED_REGISTRY);
      const persisted = await withClient((client) =>
        openEvent(client, scenario, proposal, SEED_REGISTRY, { modelRoster: ROSTER }),
      );

      await withClient(async (client) => {
        await expect(approvePanel(client, persisted.panelId, '   ')).rejects.toThrow(/named human/);
      });
    });
  });

  describe('correlation disclosure (§B.7.2, §E.4.3)', () => {
    it('reports rho as unmeasured rather than defaulting to zero', async () => {
      const scenario = freshScenario('composite-qualification');
      const persisted = await withClient((client) =>
        openEvent(client, scenario, convene(scenario, SEED_REGISTRY), SEED_REGISTRY, {
          modelRoster: ROSTER,
        }),
      );

      expect(persisted.correlation.rho).toEqual({ kind: 'unmeasured' });
      expect(persisted.correlation.statement).toContain('UNMEASURED');
      // The panel has not run. Claiming concurrence at composition time would assert a
      // result that does not exist yet — that sentence belongs to Phase 7.
      expect(persisted.correlation.statement).not.toContain('concurred');
      expect(persisted.correlation.challengerIndependenceSatisfiable).toBe(true);
    });

    it('flags a single-model panel as unable to satisfy Challenger independence', async () => {
      // §B.9: "The Challenger must not share a corpus with the persona it attacks." M7 is
      // specified to assert this at panel construction and fail loudly if unsatisfiable —
      // this is the value it will assert on.
      const scenario = freshScenario('composite-qualification');
      const persisted = await withClient((client) =>
        openEvent(client, scenario, convene(scenario, SEED_REGISTRY), SEED_REGISTRY, {
          modelRoster: ['claude-opus-5'],
        }),
      );

      expect(persisted.correlation.distinctModels).toBe(1);
      expect(persisted.correlation.challengerIndependenceSatisfiable).toBe(false);
      expect(persisted.correlation.statement).toContain('cannot be satisfied');
    });

    it('assigns models reproducibly for the same proposal and roster', async () => {
      const scenario = freshScenario('composite-qualification');
      const proposal = convene(scenario, SEED_REGISTRY);

      const a = await withClient((client) =>
        openEvent(client, scenario, proposal, SEED_REGISTRY, { modelRoster: ROSTER }),
      );
      const b = await withClient((client) =>
        openEvent(client, { ...scenario, id: randomUUID() }, proposal, SEED_REGISTRY, {
          modelRoster: ROSTER,
        }),
      );

      // Correlation measurements across events are only comparable if the same domain lands
      // on the same model each time.
      expect(a.members.map((m) => `${m.domainId}:${m.modelId}`)).toEqual(
        b.members.map((m) => `${m.domainId}:${m.modelId}`),
      );
    });

    it('rejects an empty roster', async () => {
      const scenario = freshScenario('composite-qualification');
      await withClient(async (client) => {
        await expect(
          openEvent(client, scenario, convene(scenario, SEED_REGISTRY), SEED_REGISTRY, {
            modelRoster: [],
          }),
        ).rejects.toThrow(EmptyRosterError);
      });
    });
  });

  it('rolls back the whole event when any part fails', async () => {
    const scenario = freshScenario('composite-qualification');
    const proposal = convene(scenario, SEED_REGISTRY);
    const panelId = randomUUID();

    // A slot naming a domain the registry does not hold. Nothing may survive.
    const broken = {
      ...proposal,
      slots: [...proposal.slots, { ...proposal.slots[0]!, domainId: 'does.not.exist' }],
    };

    await withClient(async (client) => {
      await expect(
        openEvent(client, scenario, broken, SEED_REGISTRY, { modelRoster: ROSTER, panelId }),
      ).rejects.toThrow(/unknown domain/);

      const { rows } = await client.query('SELECT 1 FROM panels WHERE id = $1', [panelId]);
      expect(rows).toEqual([]);
    });
  });
});
