import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONVENE_CONFIG, convene } from '../src/convening/convene.ts';
import { ARCHETYPE_MAP } from '../src/registry/archetype-map.ts';
import { SEED_REGISTRY } from '../src/registry/seed.ts';
import type { PanelProposal, Scenario } from '../src/registry/types.ts';
import { ARCHETYPES, CONSEQUENCE_CLASSES } from '../src/types/archetype.ts';

interface Fixture {
  readonly scenario: Scenario;
  readonly expectedPanel: {
    readonly full: string[];
    readonly screening: string[];
    readonly governanceGates: string[];
  };
}

function loadFixture(name: string): Fixture {
  const path = fileURLToPath(new URL(`../../../fixtures/scenarios/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

const FIXTURES = [
  'composite-qualification',
  'sole-source-decision',
  'fielded-c2-midlife',
] as const;

const depth = (proposal: PanelProposal, want: 'full' | 'screening'): string[] =>
  proposal.slots
    .filter((s) => s.depth === want)
    .map((s) => s.domainId)
    .sort();

describe('ARCHETYPE_MAP', () => {
  it('covers every consequence class', () => {
    expect(Object.keys(ARCHETYPE_MAP).sort()).toEqual([...CONSEQUENCE_CLASSES].sort());
  });

  it('maps only to real archetypes', () => {
    for (const archetypes of Object.values(ARCHETYPE_MAP)) {
      for (const a of archetypes) expect(ARCHETYPES).toContain(a);
    }
  });

  it('does not implicate immediate_observable for in-service structural failure', () => {
    // §B.2.3: "A scenario whose only consequence class is in-service structural failure
    // does not implicate the Immediate-Observable archetype at all... That is not an
    // oversight. That is the architecture working."
    expect(ARCHETYPE_MAP.physical_failure_in_service).not.toContain('immediate_observable');
  });
});

describe('seed registry', () => {
  it('spans all six archetypes', () => {
    // §C.8 stage 1: a registry seeded from one archetype builds the spine the architecture
    // exists to prevent, and golden scenario tests will not catch it if all fixtures share
    // that archetype.
    const present = new Set(SEED_REGISTRY.domains.map((d) => d.archetype));
    expect([...present].sort()).toEqual([...ARCHETYPES].sort());
  });

  it('instantiates supply chain plurally, with one archetype each', () => {
    // §B.3.1: a single persona holding all three would apply whichever archetype's
    // confidence discipline is loosest.
    const supplyChain = SEED_REGISTRY.domains.filter((d) => d.parentDomain === 'supply_chain');
    expect(supplyChain.map((d) => `${d.id}:${d.archetype}`).sort()).toEqual([
      'supply_chain.authenticity:latent_physical',
      'supply_chain.provenance:procedural_interpretive',
      'supply_chain.vendor_intent:attributive_contested',
    ]);
  });

  it('has unique domain ids', () => {
    const ids = SEED_REGISTRY.domains.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every domain at least one relevance predicate', () => {
    // A domain with none can never be convened, which makes it registry dead weight.
    for (const d of SEED_REGISTRY.domains) {
      expect(d.predicates.length, `${d.id} has no relevance predicates`).toBeGreaterThan(0);
    }
  });

  it('registers counterintelligence as reflexive', () => {
    // §B.4 / §C.3.2. The Phase 1 cross-domain read exception gates on persona class, not on
    // a hardcoded set of domain ids.
    const ci = SEED_REGISTRY.domains.find((d) => d.id === 'counterintelligence');
    expect(ci?.personaClass).toBe('reflexive');
  });

  it('excludes named-individual determination from every attributive-contested persona', () => {
    // §C.3.4, restated in §C.9: "Never let any persona make determinations about named
    // individuals." Enforced again at the output boundary by CH010.
    for (const d of SEED_REGISTRY.domains.filter((x) =>
      ['counterintelligence', 'insider_threat'].includes(x.id),
    )) {
      expect(d.scopeExclusions.map((e) => e.topic)).toContain('named_individual_determination');
    }
  });
});

describe('convene: golden panels from Appendix B §B.2.5', () => {
  it.each(FIXTURES)('%s reproduces the panel the book states', (name) => {
    const { scenario, expectedPanel } = loadFixture(name);
    const proposal = convene(scenario, SEED_REGISTRY);

    expect(depth(proposal, 'full')).toEqual(expectedPanel.full);
    expect(depth(proposal, 'screening')).toEqual(expectedPanel.screening);
    expect(proposal.governanceGates.map((g) => g.archetype)).toEqual(expectedPanel.governanceGates);
  });

  it('produces three materially different panels', () => {
    // §B.2.5: "Three panels. Minimal overlap." A construct that produces the same panel for
    // all three has a spine, and its multidisciplinary claim is decorative.
    const panels = FIXTURES.map((n) => new Set(depth(convene(loadFixture(n).scenario, SEED_REGISTRY), 'full')));

    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        const shared = [...panels[i]!].filter((d) => panels[j]!.has(d));
        expect(shared.length, `panels ${i} and ${j} share ${shared.join(', ')}`).toBeLessThanOrEqual(2);
      }
    }
    // No domain appears in all three. Anything that did would be a spine candidate.
    const inAll = [...panels[0]!].filter((d) => panels[1]!.has(d) && panels[2]!.has(d));
    expect(inAll).toEqual([]);
  });

  it('recurs only counterintelligence and geopolitical, each in two of the three', () => {
    // §B.2.5's prose says "Only counterintelligence appears in more than one", but its own
    // enumerated panels list geopolitical in both Scenario 2 and Scenario 3. The enumerated
    // panels are the ground truth an implementation must reproduce, so this asserts them
    // rather than the summary sentence. Recorded in RECONCILE.md.
    const counts = new Map<string, number>();
    for (const name of FIXTURES) {
      for (const id of depth(convene(loadFixture(name).scenario, SEED_REGISTRY), 'full')) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    const recurring = [...counts].filter(([, n]) => n > 1).map(([id]) => id).sort();
    expect(recurring).toEqual(['counterintelligence', 'geopolitical']);
    expect(counts.get('counterintelligence')).toBe(2);
  });

  /**
   * The spine-reassertion regression guard.
   *
   * A cyber-spined construct treats every archetype as "cyber, but slower", and the
   * symptom is a cyber persona at full depth on a structures qualification review. If this
   * test ever fails, the convening mechanism has acquired a home discipline.
   */
  it('convenes NO immediate_observable domain at full depth for the composite scenario', () => {
    const proposal = convene(loadFixture('composite-qualification').scenario, SEED_REGISTRY);
    const cyberAtFull = proposal.slots.filter(
      (s) => s.depth === 'full' && s.archetype === 'immediate_observable',
    );
    expect(cyberAtFull).toEqual([]);
  });

  it('surfaces a governance gate for safety_event rather than convening energetics', () => {
    // §B.14, §C.2.4, §C.8 stage 6. Scenario 1 carries a safety-event consequence class and
    // the book's panel contains no governed-consequence persona.
    const proposal = convene(loadFixture('composite-qualification').scenario, SEED_REGISTRY);

    expect(proposal.implicatedArchetypes).toContain('governed_consequence');
    expect(proposal.slots.map((s) => s.domainId)).not.toContain('energetics');
    expect(proposal.governanceGates[0]).toMatchObject({
      archetype: 'governed_consequence',
      impliedBy: ['safety_event'],
    });
  });

  it('routes legal out of the sole-source scenario rather than convening it', () => {
    // The subject IS an acquisition decision, which legal-and-regulatory's scope exclusions
    // route to contracting. Without that, the general domain displaces the specialist one.
    const proposal = convene(loadFixture('sole-source-decision').scenario, SEED_REGISTRY);

    expect(proposal.slots.map((s) => s.domainId)).not.toContain('legal.legal_regulatory');
    expect(proposal.routingHints).toContainEqual({
      domainId: 'legal.legal_regulatory',
      topic: 'acquisition_and_contracting',
      routeTo: 'legal.contracting_acquisition',
    });
  });
});

describe('convene: mechanics', () => {
  const base = loadFixture('composite-qualification').scenario;

  it('is deterministic and byte-stable across repeated calls', () => {
    const a = JSON.stringify(convene(base, SEED_REGISTRY));
    const b = JSON.stringify(convene(base, SEED_REGISTRY));
    expect(a).toBe(b);
  });

  it('is independent of registry ordering', () => {
    const reversed = { domains: [...SEED_REGISTRY.domains].reverse() };
    expect(JSON.stringify(convene(base, reversed))).toBe(JSON.stringify(convene(base, SEED_REGISTRY)));
  });

  it('is independent of subject-characteristic ordering', () => {
    const shuffled: Scenario = {
      ...base,
      subjectCharacteristics: [...base.subjectCharacteristics].reverse(),
    };
    expect(JSON.stringify(convene(shuffled, SEED_REGISTRY))).toBe(
      JSON.stringify(convene(base, SEED_REGISTRY)),
    );
  });

  it('explains every slot with the predicates that matched', () => {
    // §B.6 step 2 requires the derivation be "mechanical, reviewable". A slot with no
    // stated reason is not reviewable.
    for (const slot of convene(base, SEED_REGISTRY).slots) {
      expect(slot.matchedPredicates.length).toBeGreaterThan(0);
      expect(slot.score).toBeCloseTo(
        slot.matchedPredicates.reduce((sum, p) => sum + p.weight, 0),
        10,
      );
    }
  });

  it('convenes nothing when no predicate matches', () => {
    const unrelated: Scenario = {
      ...base,
      consequenceClasses: ['legal_exposure'],
      subjectCharacteristics: ['a_characteristic_no_domain_registered_against'],
    };
    const proposal = convene(unrelated, SEED_REGISTRY);

    // legal_exposure is registered by export control (weight 2) and contracting (weight 1),
    // so exactly those two convene, at the depths their weights earn. A registry of twenty
    // domains does not convene twenty personas.
    expect(depth(proposal, 'full')).toEqual(['legal.export_control']);
    expect(depth(proposal, 'screening')).toEqual(['legal.contracting_acquisition']);
  });

  it('honours scenario-level exclusions', () => {
    const excluded: Scenario = {
      ...base,
      exclusions: [{ topic: 'damage_tolerance', rationale: 'covered by a separate review' }],
    };
    const proposal = convene(excluded, SEED_REGISTRY);

    expect(proposal.slots.map((s) => s.domainId)).not.toContain('structures');
    expect(proposal.routingHints).toContainEqual({
      domainId: 'structures',
      topic: 'damage_tolerance',
      routeTo: 'scenario:excluded',
    });
  });

  it('warns when the panel falls outside the 8-14 band without changing the slots', () => {
    // The book's own illustrative panels sit at six and seven, below the band it states as
    // practice, so this must stay advisory. §B.6 puts a human in the adjudication seat.
    const proposal = convene(base, SEED_REGISTRY);
    expect(proposal.slots.filter((s) => s.depth === 'full')).toHaveLength(7);
    expect(proposal.warnings.some((w) => w.includes('below the 8-14 band'))).toBe(true);
  });

  it('flags a full-depth slot convened from outside the implicated archetypes', () => {
    // supply_chain.provenance is Procedural-Interpretive, which the composite scenario does
    // not implicate. It is convened on subject characteristics, exactly as §B.2.5 states —
    // and the Devil's Advocate reviewing the panel should be told.
    const proposal = convene(base, SEED_REGISTRY);
    const provenance = proposal.slots.find((s) => s.domainId === 'supply_chain.provenance');

    expect(provenance).toMatchObject({ depth: 'full', archetypeImplicated: false });
    expect(proposal.warnings.some((w) => w.includes('supply_chain.provenance'))).toBe(true);
  });

  it('respects a raised full-depth threshold', () => {
    const strict = convene(base, SEED_REGISTRY, { ...DEFAULT_CONVENE_CONFIG, fullThreshold: 5 });
    expect(depth(strict, 'full')).toEqual(['materials.polymers_adhesives']);
    // Nothing is dropped by raising the threshold — the rest demote to screening.
    expect(strict.slots).toHaveLength(convene(base, SEED_REGISTRY).slots.length);
  });
});
