import { randomUUID } from 'node:crypto';
import { type GradedChunk, type PersonaContext, verifyChain } from '@mae/core';
import type { PoolClient } from '@mae/store';
import { closePool, listFindings, loadChain, migrate, withClient } from '@mae/store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PersonaOutcome } from '../src/persona/run.ts';
import { persistOutcome } from '../src/persona/persist.ts';

const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';

const chunk: GradedChunk = {
  id: 'chunk-1',
  sourceId: 'src',
  fieldId: 'materials.polymers_adhesives.synthetic',
  text: 'Process records are supplier-held.',
  reliability: 'F',
  credibility: 6,
  situationTags: ['surface_preparation'],
  contentClass: 'synthetic',
};

const ctx: PersonaContext = {
  personaId: 'materials.polymers_adhesives.principal',
  domainId: 'materials.polymers_adhesives',
  archetype: 'latent_physical',
  personaClass: 'domain',
  status: 'registered',
  retrievedChunks: [chunk],
  scopeInclusions: ['surface_preparation'],
  scopeExclusions: [],
};

const accepted: PersonaOutcome = {
  personaId: ctx.personaId,
  kind: 'accepted',
  attempts: [
    {
      request: {
        purpose: 'p',
        model: 'claude-opus-5',
        maxTokens: 100,
        system: 's',
        messages: [{ role: 'user', content: 'u' }],
      },
      response: {
        text: '{}',
        stopReason: 'end_turn',
        model: 'claude-opus-5',
        usage: { inputTokens: 10, outputTokens: 5 },
        provenance: 'authored',
        transportId: 'recorded',
      },
      violations: [],
    },
  ],
  finding: {
    personaId: ctx.personaId,
    statement: 'The programme cannot verify interfacial durability from records it does not hold.',
    confidence: 'considered',
    validityTier: 'moderate',
    basis: 'supplier-held process records',
    syntheticBasis: true,
    sourceGrades: [{ chunkId: 'chunk-1', reliability: 'F', credibility: 6 }],
  },
};

/** Opens a scenario, panel and event so the foreign keys resolve. */
async function openTestEvent(client: PoolClient): Promise<string> {
  const scenarioId = randomUUID();
  const panelId = randomUUID();
  const eventId = randomUUID();

  await client.query(
    `INSERT INTO scenarios (id, subject, lifecycle_stage, mission_function, consequence_classes,
                            informing_decision, adversary_set, classification, authored_by,
                            subject_characteristics, exclusions)
     VALUES ($1,'s','qualification','f',ARRAY['physical_failure_in_service'],'d',ARRAY['a'],
             'unclassified','human:t',ARRAY['bonded_primary_structure'],'[]'::jsonb)`,
    [scenarioId],
  );
  await client.query('INSERT INTO panels (id, scenario_id) VALUES ($1, $2)', [panelId, scenarioId]);
  await client.query('INSERT INTO events (id, scenario_id, panel_id) VALUES ($1, $2, $3)', [
    eventId,
    scenarioId,
    panelId,
  ]);
  return eventId;
}

describe.skipIf(!HAS_DB)('persisting a persona outcome', () => {
  beforeAll(async () => {
    await withClient((client) => migrate(client));
  });
  afterAll(closePool);

  it('writes the retrieval before the outcome, even though only one produces a finding', async () => {
    // What was in front of the persona is a fact about the run independent of what came
    // back, and CH003 and CH009 are both judged against it.
    await withClient(async (client) => {
      const eventId = await openTestEvent(client);
      await client.query('BEGIN');
      const result = await persistOutcome(client, {
        eventId,
        phase: 1,
        outcome: accepted,
        ctx,
        fieldId: chunk.fieldId,
        provisional: false,
      });
      await client.query('COMMIT');

      expect(result.retrievalSeq).toBeLessThan(result.outcomeSeq);
      const chain = await loadChain(client, eventId);
      expect(chain.map((e) => e.kind)).toEqual(['retrieval', 'persona_output']);
      expect(verifyChain(chain)).toEqual({ ok: true });
    });
  });

  it('anchors the finding to the ledger entry that recorded it', async () => {
    await withClient(async (client) => {
      const eventId = await openTestEvent(client);
      await client.query('BEGIN');
      const result = await persistOutcome(client, {
        eventId,
        phase: 1,
        outcome: accepted,
        ctx,
        fieldId: chunk.fieldId,
        provisional: false,
      });
      await client.query('COMMIT');

      const findings = await listFindings(client, eventId);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.ledgerSeq).toBe(result.outcomeSeq);
      expect(findings[0]!.confidence).toBe('considered');
      expect(findings[0]!.sourceGrades[0]).toEqual({
        chunkId: 'chunk-1',
        reliability: 'F',
        credibility: 6,
      });
    });
  });

  it('records the provenance of every attempt, so a replay cannot pass as a live run', async () => {
    await withClient(async (client) => {
      const eventId = await openTestEvent(client);
      await client.query('BEGIN');
      await persistOutcome(client, {
        eventId,
        phase: 1,
        outcome: accepted,
        ctx,
        fieldId: chunk.fieldId,
        provisional: false,
      });
      await client.query('COMMIT');

      const chain = await loadChain(client, eventId);
      const output = chain.find((e) => e.kind === 'persona_output')!;
      const payload = output.payload as { attempts: { provenance: string }[] };
      expect(payload.attempts[0]!.provenance).toBe('authored');
    });
  });

  it('carries the synthetic count into the retrieval entry', async () => {
    // CH012 keys off this, and a reviewer reconstructing why a finding was capped needs it
    // stated rather than re-derived.
    await withClient(async (client) => {
      const eventId = await openTestEvent(client);
      await client.query('BEGIN');
      await persistOutcome(client, {
        eventId,
        phase: 1,
        outcome: accepted,
        ctx,
        fieldId: chunk.fieldId,
        provisional: false,
      });
      await client.query('COMMIT');

      const chain = await loadChain(client, eventId);
      const retrieval = chain.find((e) => e.kind === 'retrieval')!;
      expect((retrieval.payload as { syntheticChunks: number }).syntheticChunks).toBe(1);
    });
  });

  it.each([
    [
      'a discard',
      {
        ...accepted,
        kind: 'discarded' as const,
        reason: 'repair_failed' as const,
        detail: 'CH012_SYNTHETIC_BASIS',
        violations: [
          { code: 'CH012_SYNTHETIC_BASIS' as const, detail: 'too high', remediable: true },
        ],
      },
      'finding_discarded',
    ],
    [
      'a routing',
      {
        ...accepted,
        kind: 'routed' as const,
        routeTo: 'human:program_authority',
        violations: [
          { code: 'CH011_PROHIBITED_OUTPUT' as const, detail: 'mechanism', remediable: false },
        ],
      },
      'routing_event',
    ],
    [
      'a refusal',
      { ...accepted, kind: 'refused' as const, refusalCategory: 'unspecified' },
      'finding_discarded',
    ],
  ])('records %s, and writes no finding', async (_name, outcome, expectedKind) => {
    // A discard that leaves no trace is indistinguishable from a persona that was never
    // asked, and the discards are where the charter actually did something.
    await withClient(async (client) => {
      const eventId = await openTestEvent(client);
      await client.query('BEGIN');
      await persistOutcome(client, {
        eventId,
        phase: 1,
        outcome: outcome as PersonaOutcome,
        ctx,
        fieldId: chunk.fieldId,
        provisional: false,
      });
      await client.query('COMMIT');

      const chain = await loadChain(client, eventId);
      expect(chain.map((e) => e.kind)).toEqual(['retrieval', expectedKind]);
      expect(await listFindings(client, eventId)).toEqual([]);
      expect(verifyChain(chain)).toEqual({ ok: true });
    });
  });

  it('writes a gap into the gap map as well as the findings table', async () => {
    const gap: PersonaOutcome = {
      ...accepted,
      finding: { ...accepted.finding!, confidence: 'gap' },
    } as PersonaOutcome;

    await withClient(async (client) => {
      const eventId = await openTestEvent(client);
      await client.query('BEGIN');
      const result = await persistOutcome(client, {
        eventId,
        phase: 1,
        outcome: gap,
        ctx,
        fieldId: chunk.fieldId,
        provisional: false,
      });
      await client.query('COMMIT');

      expect(result.gapId).not.toBeNull();
      const { rows } = await client.query(
        'SELECT persona_id, claim_blocked FROM gap_declarations WHERE event_id = $1',
        [eventId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!['persona_id']).toBe(ctx.personaId);
    });
  });

  it('marks a provisional persona\'s finding provisional in the record', async () => {
    await withClient(async (client) => {
      const eventId = await openTestEvent(client);
      await client.query('BEGIN');
      await persistOutcome(client, {
        eventId,
        phase: 1,
        outcome: accepted,
        ctx,
        fieldId: chunk.fieldId,
        provisional: true,
      });
      await client.query('COMMIT');

      expect((await listFindings(client, eventId))[0]!.provisional).toBe(true);
    });
  });
});
