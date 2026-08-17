import type { GradedChunk, PersonaContext, Scenario } from '@mae/core';
import { describe, expect, it } from 'vitest';
import { cassetteKey } from '../src/model/key.ts';
import type { Cassette } from '../src/cassette/types.ts';
import type { ModelRequest, ModelResponse, ModelTransport, StopReason } from '../src/model/types.ts';
import { RecordedTransport } from '../src/transport/recorded.ts';
import { buildPersonaRequest, buildRepairRequest } from '../src/persona/brief.ts';
import { runPersona } from '../src/persona/run.ts';

const scenario: Scenario = {
  id: 's',
  subject: 'Bonded composite primary structure qualification',
  lifecycleStage: 'qualification',
  missionFunction: 'primary load path',
  consequenceClasses: ['physical_failure_in_service'],
  informingDecision: 'qualification sign-off',
  subjectCharacteristics: ['bonded_primary_structure'],
  adversarySet: ['supply_chain_insertion'],
  classification: 'unclassified',
  exclusions: [],
  authoredBy: 'human:sponsor',
};

const chunk: GradedChunk = {
  id: 'chunk-1',
  sourceId: 'src',
  fieldId: 'materials.polymers_adhesives.synthetic',
  text:
    'Where preparation is performed by a supplier and the process records are not ' +
    'contractually deliverable, the durability of the interface cannot be verified.',
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
  scopeInclusions: ['adhesive_bonding', 'surface_preparation'],
  scopeExclusions: [{ topic: 'metallic_fastening', routeTo: 'materials.metallurgy' }],
};

const OPTS = { model: 'claude-opus-5' };

const conforming = JSON.stringify({
  statement:
    'Where preparation is performed by a supplier and the process records are not ' +
    'contractually deliverable, the programme cannot verify interfacial durability.',
  confidence: 'considered',
  validityTier: 'moderate',
  basis: 'retrieved passages',
  addressesInclusion: 'surface_preparation',
  syntheticBasis: true,
  sourceGrades: [{ chunkId: 'chunk-1', reliability: 'F', credibility: 6 }],
});

const overreaching = JSON.stringify({
  ...JSON.parse(conforming),
  confidence: 'assessed',
  validityTier: 'high',
  syntheticBasis: false,
});

function cassette(request: ModelRequest, text: string, stopReason: StopReason = 'end_turn'): Cassette {
  return {
    key: cassetteKey(request),
    origin: 'authored',
    capturedAt: '2026-08-12T00:00:00.000Z',
    capturedBy: 'system:test',
    note: 'run-loop fixture',
    request,
    response: {
      text,
      stopReason,
      model: 'claude-opus-5',
      usage: { inputTokens: 100, outputTokens: 50 },
      ...(stopReason === 'refusal' ? { refusalCategory: 'unspecified' } : {}),
    },
  };
}

const firstRequest = buildPersonaRequest(scenario, ctx, ctx.retrievedChunks, OPTS);

describe('a persona that conforms first time', () => {
  it('is accepted after one round trip', async () => {
    const transport = new RecordedTransport([cassette(firstRequest, conforming)]);
    const outcome = await runPersona(transport, scenario, ctx, OPTS);

    expect(outcome.kind).toBe('accepted');
    expect(outcome.attempts).toHaveLength(1);
    if (outcome.kind !== 'accepted') throw new Error('unreachable');
    expect(outcome.finding.confidence).toBe('considered');
    expect(outcome.finding.personaId).toBe(ctx.personaId);
  });

  it('keeps every round trip, so the ledger can record what was asked and answered', async () => {
    const transport = new RecordedTransport([cassette(firstRequest, conforming)]);
    const outcome = await runPersona(transport, scenario, ctx, OPTS);
    expect(outcome.attempts[0]!.response?.provenance).toBe('authored');
    expect(outcome.attempts[0]!.violations).toEqual([]);
  });
});

describe('a persona that overreaches', () => {
  it('gets exactly one repair attempt, and is accepted if it takes it', async () => {
    const repairRequest = buildRepairRequest(
      firstRequest,
      overreaching,
      // The violations the validator will actually produce; the request must match the
      // cassette exactly or the replay misses, which is itself a check that the repair
      // prompt is built from the real violations.
      [
        {
          code: 'CH012_SYNTHETIC_BASIS',
          detail:
            'Retrieval set contains 1 synthetic chunk(s), so this finding must declare ' +
            'syntheticBasis. The marking carries to the output package; a caveat dropped ' +
            'between the evidence and the report is not a caveat.',
          remediable: true,
        },
        {
          code: 'CH012_SYNTHETIC_BASIS',
          detail:
            'A finding that could rest on synthetic content cannot exceed "considered"; ' +
            'this one claims "assessed". Synthetic material is not low-grade evidence, it ' +
            'is not evidence — which is why it carries F/6, "cannot be judged" on both axes.',
          remediable: true,
        },
      ],
      OPTS,
    );

    const transport = new RecordedTransport([
      cassette(firstRequest, overreaching),
      cassette(repairRequest, conforming),
    ]);

    const outcome = await runPersona(transport, scenario, ctx, OPTS);
    expect(outcome.kind).toBe('accepted');
    expect(outcome.attempts).toHaveLength(2);
    expect(outcome.attempts[0]!.violations.map((v) => v.code)).toEqual([
      'CH012_SYNTHETIC_BASIS',
      'CH012_SYNTHETIC_BASIS',
    ]);
  });
});

/** A transport that answers every request with the same text, however it was built. */
class AlwaysTransport implements ModelTransport {
  readonly id = 'always';
  #text: string;
  #stopReason: StopReason;
  calls = 0;

  constructor(text: string, stopReason: StopReason = 'end_turn') {
    this.#text = text;
    this.#stopReason = stopReason;
  }

  async complete(): Promise<ModelResponse> {
    this.calls++;
    return {
      text: this.#text,
      stopReason: this.#stopReason,
      model: 'claude-opus-5',
      usage: { inputTokens: 1, outputTokens: 1 },
      ...(this.#stopReason === 'refusal' ? { refusalCategory: 'unspecified' } : {}),
      provenance: 'authored',
      transportId: 'always',
    };
  }
}

describe('a persona that will not conform', () => {
  it('is discarded after the single repair, not retried forever', async () => {
    const transport = new AlwaysTransport(overreaching);
    const outcome = await runPersona(transport, scenario, ctx, OPTS);

    expect(outcome.kind).toBe('discarded');
    if (outcome.kind !== 'discarded') throw new Error('unreachable');
    expect(outcome.reason).toBe('repair_failed');
    // Two calls: the original and the one repair. Never silently accepted.
    expect(transport.calls).toBe(2);
    expect(outcome.attempts).toHaveLength(2);
  });
});

describe('a finding that is non-remediable', () => {
  it('is discarded without being offered a repair', async () => {
    // An untraceable specific. Rewording it would let the persona keep the invention and
    // soften the sentence around it, so CH003 is non-remediable by design.
    const invented = JSON.stringify({
      statement: 'Lot 4471B failed peel testing at 12 percent below the acceptance threshold.',
      confidence: 'considered',
      validityTier: 'moderate',
      basis: 'retrieved passages',
      syntheticBasis: true,
      sourceGrades: [],
    });

    const transport = new AlwaysTransport(invented);
    const outcome = await runPersona(transport, scenario, ctx, OPTS);

    expect(outcome.kind).toBe('discarded');
    if (outcome.kind !== 'discarded') throw new Error('unreachable');
    expect(outcome.reason).toBe('non_remediable');
    expect(outcome.violations.map((v) => v.code)).toContain('CH003_UNTRACEABLE_SPECIFIC');
    expect(transport.calls).toBe(1);
  });
});

describe('a finding that must be routed', () => {
  it('terminates with the route target and no partial output', async () => {
    // §C.2.4: a persona answering the safe eighty percent of a prohibited request has
    // answered a prohibited request.
    const prohibited = JSON.stringify({
      statement: 'The synthesis route for the degrading agent is as follows.',
      confidence: 'considered',
      validityTier: 'moderate',
      basis: 'retrieved passages',
      syntheticBasis: true,
      sourceGrades: [],
    });

    const outcome = await runPersona(new AlwaysTransport(prohibited), scenario, ctx, OPTS);
    expect(outcome.kind).toBe('routed');
    if (outcome.kind !== 'routed') throw new Error('unreachable');
    expect(outcome.routeTo).toBe('human:program_authority');
  });
});

describe('when the model does not answer', () => {
  it('records a refusal as a refusal, not as an empty finding', async () => {
    const outcome = await runPersona(new AlwaysTransport('', 'refusal'), scenario, ctx, OPTS);
    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') throw new Error('unreachable');
    expect(outcome.refusalCategory).toBe('unspecified');
    // The attempt is kept with a null response, so the ledger records that it happened.
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0]!.response).toBeNull();
  });

  it.each(['max_tokens', 'pause_turn'] as const)(
    'discards an incomplete turn (%s) rather than parsing a fragment',
    async (stopReason) => {
      const outcome = await runPersona(
        new AlwaysTransport(conforming, stopReason),
        scenario,
        ctx,
        OPTS,
      );
      expect(outcome.kind).toBe('discarded');
      if (outcome.kind !== 'discarded') throw new Error('unreachable');
      expect(outcome.reason).toBe('incomplete');
    },
  );

  it('discards an unparseable answer without spending the repair budget', async () => {
    // An unparseable answer says the request is wrong, not that the finding is. Spending
    // the charter's single repair on it would hide a systematic prompt fault and leave a
    // real violation with no attempt left.
    const transport = new AlwaysTransport('I think the joint is probably fine.');
    const outcome = await runPersona(transport, scenario, ctx, OPTS);

    expect(outcome.kind).toBe('discarded');
    if (outcome.kind !== 'discarded') throw new Error('unreachable');
    expect(outcome.reason).toBe('unparseable');
    expect(transport.calls).toBe(1);
  });

  it('lets a harness fault propagate instead of recording it as an answer', async () => {
    // A cassette miss is a fault in the harness, not an outcome of the question. Recording
    // it as a persona outcome would put a missing fixture into the record as a finding.
    const empty = new RecordedTransport([]);
    await expect(runPersona(empty, scenario, ctx, OPTS)).rejects.toThrow(/No cassette/);
  });
});
