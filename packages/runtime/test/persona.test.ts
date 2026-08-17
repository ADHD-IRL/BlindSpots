import type { GradedChunk, PersonaContext, Scenario } from '@mae/core';
import { describe, expect, it } from 'vitest';
import {
  buildPersonaRequest,
  buildRepairRequest,
  personaSystemPrompt,
  personaUserPrompt,
} from '../src/persona/brief.ts';
import type { FindingParseError } from '../src/persona/parse.ts';
import { parseFinding } from '../src/persona/parse.ts';

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
  exclusions: [{ topic: 'cost', rationale: 'handled by the programme office' }],
  authoredBy: 'human:sponsor',
};

const ctx: PersonaContext = {
  personaId: 'materials.polymers_adhesives.principal',
  domainId: 'materials.polymers_adhesives',
  archetype: 'latent_physical',
  personaClass: 'domain',
  status: 'registered',
  retrievedChunks: [],
  scopeInclusions: ['adhesive_bonding', 'surface_preparation'],
  scopeExclusions: [{ topic: 'metallic_fastening', routeTo: 'materials.metallurgy' }],
};

const chunk: GradedChunk = {
  id: 'chunk-1',
  sourceId: 'src',
  fieldId: 'materials.polymers_adhesives.synthetic',
  text: 'Surface preparation controls interfacial durability.',
  reliability: 'F',
  credibility: 6,
  situationTags: ['surface_preparation'],
  contentClass: 'synthetic',
};

describe('the persona brief', () => {
  const system = personaSystemPrompt(ctx);

  it('names the persona, its domain and its archetype', () => {
    expect(system).toContain('materials.polymers_adhesives.principal');
    expect(system).toContain('latent_physical');
  });

  it('routes out-of-scope topics to their owner by name', () => {
    expect(system).toContain('metallic_fastening (belongs to materials.metallurgy)');
  });

  it('states the confidence vocabulary, because an unknown term cannot be emitted at all', () => {
    // The brief states rules to raise first-pass yield. It does not enforce them —
    // validateFinding runs over whatever comes back and does not care what the prompt said.
    expect(system).toContain('gap, considered, plausible, likely, assessed');
    expect(system).toContain('low, moderate, high');
  });

  it('tells the persona a missing record is itself a finding', () => {
    expect(system).toContain('that absence is itself a finding');
    expect(system).toContain('Do not');
    expect(system).toContain('estimate around a missing record');
  });

  it('says the persona cannot see any other persona\'s work', () => {
    // §B.7.1. The hidden-profile countermeasure depends on each persona committing to a
    // position before it can be influenced, so Phase 1 independence is structural.
    expect(system).toContain('cannot see any other');
  });
});

describe('the user prompt', () => {
  it('carries the passages with both grades and the chunk id to cite', () => {
    const prompt = personaUserPrompt(scenario, ctx, [chunk]);
    expect(prompt).toContain('[chunk-1] (F/6');
    expect(prompt).toContain('Surface preparation controls interfacial durability.');
  });

  it('marks synthetic passages as invented, in the evidence itself', () => {
    expect(personaUserPrompt(scenario, ctx, [chunk])).toContain('SYNTHETIC — invented, not evidence');
  });

  it('does not mark curated passages', () => {
    const curated = { ...chunk, contentClass: 'curated' as const, reliability: 'B' as const, credibility: 2 as const };
    const prompt = personaUserPrompt(scenario, ctx, [curated]);
    expect(prompt).toContain('[chunk-1] (B/2)');
    expect(prompt).not.toContain('SYNTHETIC');
  });

  it('says plainly when the field returned nothing', () => {
    // An empty retrieval set is a real state and must not look like an omission.
    expect(personaUserPrompt(scenario, ctx, [])).toContain('the bound field returned nothing');
  });

  it('carries the scenario exclusions with their rationale', () => {
    expect(personaUserPrompt(scenario, ctx, [chunk])).toContain(
      'cost (handled by the programme office)',
    );
  });

  it('contains no other persona\'s output, by construction', () => {
    const prompt = personaUserPrompt(scenario, ctx, [chunk]);
    expect(prompt).not.toMatch(/persona|finding from|panel member/i);
  });
});

describe('the request', () => {
  const request = buildPersonaRequest(scenario, ctx, [chunk], { model: 'claude-opus-5' });

  it('keys its purpose to the persona, so two personas never share a cassette', () => {
    expect(request.purpose).toBe('phase1_finding:materials.polymers_adhesives.principal');
  });

  it('asks for structured output against the finding schema', () => {
    expect(request.outputSchema).toMatchObject({ type: 'object' });
    expect((request.outputSchema as { required: string[] }).required).toContain('confidence');
  });
});

describe('the repair request', () => {
  const original = buildPersonaRequest(scenario, ctx, [chunk], { model: 'claude-opus-5' });
  const repair = buildRepairRequest(
    original,
    '{"confidence":"assessed"}',
    [{ code: 'CH012_SYNTHETIC_BASIS', detail: 'cannot exceed "considered"', remediable: true }],
    { model: 'claude-opus-5' },
  );

  it('carries the violation codes verbatim rather than asking for a rewrite', () => {
    // "Revise this" produces a rewrite of the prose around the same defect, and several of
    // these rules exist precisely to catch a defect that survives rephrasing.
    const last = repair.messages[repair.messages.length - 1]!;
    expect(last.content).toContain('CH012_SYNTHETIC_BASIS');
    expect(last.content).toContain('cannot exceed "considered"');
  });

  it('replays the prior answer so the persona sees what it said', () => {
    expect(repair.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(repair.messages[1]!.content).toBe('{"confidence":"assessed"}');
  });

  it('offers withdrawal as a gap, not only revision', () => {
    expect(repair.messages[2]!.content).toContain('confidence "gap"');
  });

  it('says this is the only attempt', () => {
    expect(repair.messages[2]!.content).toContain('only');
    expect(repair.messages[2]!.content).toContain('discards the finding');
  });

  it('keys to a different cassette than the first attempt', () => {
    expect(repair.purpose).not.toBe(original.purpose);
    expect(repair.purpose.endsWith(':repair')).toBe(true);
  });
});

describe('parsing a finding', () => {
  const good = JSON.stringify({
    statement: 'Surface preparation records are supplier-held.',
    confidence: 'considered',
    validityTier: 'moderate',
    basis: 'retrieved passages',
    sourceGrades: [{ chunkId: 'chunk-1', reliability: 'F', credibility: 6 }],
    syntheticBasis: true,
  });

  it('parses a well-formed finding and stamps the persona', () => {
    const finding = parseFinding(good, ctx.personaId);
    expect(finding.personaId).toBe(ctx.personaId);
    expect(finding.confidence).toBe('considered');
    expect(finding.syntheticBasis).toBe(true);
  });

  it('omits absent optionals rather than setting them undefined', () => {
    // exactOptionalPropertyTypes: an explicit undefined and an absent key are different
    // things, and CH012 distinguishes "did not declare" from "declared false".
    const finding = parseFinding(good, ctx.personaId);
    expect('anchorsChain' in finding).toBe(false);
  });

  it.each([
    ['empty', '', /the response was empty/],
    ['not JSON', 'I think the joint is fine.', /Could not parse/],
    ['an array', '[]', /expected a single JSON object/],
    ['no statement', '{"confidence":"considered"}', /statement is required/],
    ['blank statement', '{"statement":"  ","confidence":"considered"}', /statement is required/],
  ])('refuses %s', (_name, input, message) => {
    expect(() => parseFinding(input, ctx.personaId)).toThrow(message as RegExp);
  });

  it('refuses an unrecognised confidence rather than defaulting it', () => {
    // The failure this exists for: a defaulted confidence reaches validateFinding looking
    // well-formed and passes rules it was never checked against.
    const bad = JSON.stringify({
      statement: 'x',
      confidence: 'certain',
      validityTier: 'high',
      basis: '',
      sourceGrades: [],
    });
    expect(() => parseFinding(bad, ctx.personaId)).toThrow(/confidence must be one of/);
  });

  it('refuses an unrecognised validity tier', () => {
    const bad = JSON.stringify({
      statement: 'x',
      confidence: 'considered',
      validityTier: 'very high',
      basis: '',
      sourceGrades: [],
    });
    expect(() => parseFinding(bad, ctx.personaId)).toThrow(/validityTier must be one of/);
  });

  it('accepts an empty basis, leaving CH001 to decide whether that is fatal', () => {
    // It only is at `plausible`. Deciding it here would duplicate the rule somewhere nobody
    // would look for it.
    const finding = parseFinding(
      JSON.stringify({
        statement: 'x',
        confidence: 'considered',
        validityTier: 'low',
        basis: '',
        sourceGrades: [],
      }),
      ctx.personaId,
    );
    expect(finding.basis).toBe('');
  });

  it.each([
    ['a bad reliability letter', { chunkId: 'c', reliability: 'Z', credibility: 6 }, /reliability must be A–F/],
    ['a credibility out of range', { chunkId: 'c', reliability: 'F', credibility: 9 }, /credibility must be/],
    ['a missing chunk id', { reliability: 'F', credibility: 6 }, /chunkId is required/],
  ])('refuses %s', (_name, grade, message) => {
    const bad = JSON.stringify({
      statement: 'x',
      confidence: 'considered',
      validityTier: 'low',
      basis: '',
      sourceGrades: [grade],
    });
    expect(() => parseFinding(bad, ctx.personaId)).toThrow(message as RegExp);
  });

  it('does not clamp a rate into range, so CH004 sees the violation', () => {
    const finding = parseFinding(
      JSON.stringify({
        statement: 'x',
        confidence: 'considered',
        validityTier: 'low',
        basis: '',
        sourceGrades: [],
        samplingRate: 4.2,
      }),
      ctx.personaId,
    );
    expect(finding.samplingRate).toBe(4.2);
  });

  it('carries the raw text on the error so the failure can be logged', () => {
    try {
      parseFinding('not json', ctx.personaId);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as FindingParseError).raw).toBe('not json');
    }
  });
});
