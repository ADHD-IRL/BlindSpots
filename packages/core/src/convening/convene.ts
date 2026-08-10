import { ARCHETYPE_MAP, implicatedArchetypes } from '../registry/archetype-map.ts';
import type {
  Domain,
  GovernanceGate,
  MatchedPredicate,
  PanelProposal,
  PanelSlot,
  Registry,
  RoutingHint,
  Scenario,
} from '../registry/types.ts';
import type { Archetype, ConsequenceClass, PanelDepth } from '../types/archetype.ts';

export interface ConveneConfig {
  /** Score at or above which a domain is convened at `full` depth. */
  readonly fullThreshold: number;
  /** Panel size band from Appendix B §B.6: "eight to fourteen at full depth". */
  readonly panelSizeMin: number;
  readonly panelSizeMax: number;
}

export const DEFAULT_CONVENE_CONFIG: ConveneConfig = {
  fullThreshold: 2,
  panelSizeMin: 8,
  panelSizeMax: 14,
};

/**
 * Convenes a panel from a scenario (Appendix B §B.2, §B.6).
 *
 * Pure and deterministic. Ties break on `domainId` ascending so the proposal is byte-stable
 * across runs, which is what lets the golden fixtures be diffed deliberately.
 *
 * ## Why relevance predicates, not archetype, select domains
 *
 * The implementation plan specifies "map consequence classes to implicated archetypes, then
 * within each archetype score domains" — archetype as a hard filter. That algorithm cannot
 * reproduce the book's own worked panels. §B.2.5 Scenario 1 has consequence classes
 * `physical_failure_in_service` and `safety_event`, implicating Latent-Physical,
 * Attributive-Contested, and Governed-Consequence — yet its stated panel puts supply chain
 * provenance at full depth and legal at screening depth, both Procedural-Interpretive.
 * §B.2.4's own examples say the same: "Foreign-jurisdiction suppliers at any tier implicates
 * provenance and legal."
 *
 * So relevance predicates do the convening, and a domain matching none of them scores zero
 * and is omitted regardless of archetype. This preserves the property the architecture
 * actually depends on — §C.4 step six, that predicates be "specific enough that some
 * scenarios genuinely exclude the domain" — while reproducing all three worked panels.
 *
 * Archetype implication still does three things: it gates Governed-Consequence (below), it
 * determines which charter and protocol a persona inherits, and it is recorded per slot so
 * the human adjudicator in §B.6 step 6 can see when a domain was convened from outside the
 * implicated set. Recorded in RECONCILE.md.
 */
export function convene(
  scenario: Scenario,
  registry: Registry,
  config: ConveneConfig = DEFAULT_CONVENE_CONFIG,
): PanelProposal {
  const implicated = implicatedArchetypes(scenario.consequenceClasses);
  const consequenceSet = new Set<string>(scenario.consequenceClasses);
  const characteristics = new Set(scenario.subjectCharacteristics);
  const scenarioExclusions = new Set(scenario.exclusions.map((e) => e.topic));

  const slots: PanelSlot[] = [];
  const routingHints: RoutingHint[] = [];

  for (const domain of registry.domains) {
    const routed = routingsFor(domain, characteristics, scenarioExclusions);
    if (routed.length > 0) {
      routingHints.push(...routed);
      continue;
    }

    // Governed-Consequence domains are never instantiated by convening, even when a
    // relevance predicate matches. See the gate below.
    if (domain.archetype === 'governed_consequence') continue;

    const matchedPredicates = matchPredicates(domain, consequenceSet, characteristics);
    // Zero matches means this scenario does not implicate this domain. This is the check
    // that keeps a registry of forty domains from convening forty personas.
    if (matchedPredicates.length === 0) continue;

    const score = matchedPredicates.reduce((sum, p) => sum + p.weight, 0);
    const depth: PanelDepth = score >= config.fullThreshold ? 'full' : 'screening';

    slots.push({
      domainId: domain.id,
      archetype: domain.archetype,
      depth,
      score,
      archetypeImplicated: implicated.has(domain.archetype),
      matchedPredicates,
    });
  }

  slots.sort(byScoreThenId);
  routingHints.sort((a, b) => a.domainId.localeCompare(b.domainId) || a.topic.localeCompare(b.topic));

  return {
    scenarioId: scenario.id,
    implicatedArchetypes: [...implicated].sort(),
    slots,
    governanceGates: governanceGates(scenario.consequenceClasses, implicated),
    routingHints,
    warnings: warningsFor(slots, config),
  };
}

function byScoreThenId(a: PanelSlot, b: PanelSlot): number {
  return b.score - a.score || a.domainId.localeCompare(b.domainId);
}

function matchPredicates(
  domain: Domain,
  consequenceClasses: ReadonlySet<string>,
  characteristics: ReadonlySet<string>,
): MatchedPredicate[] {
  const matched: MatchedPredicate[] = [];
  for (const predicate of domain.predicates) {
    // Exact matching against a controlled vocabulary. No NLP, no fuzzy matching, no
    // embeddings: convening must be deterministic and reviewable, and §B.6 step 2 calls
    // the derivation "mechanical, reviewable" for exactly this reason.
    const pool =
      predicate.kind === 'consequence_class' ? consequenceClasses : characteristics;
    if (pool.has(predicate.value)) {
      matched.push({ kind: predicate.kind, value: predicate.value, weight: predicate.weight });
    }
  }
  return matched.sort((a, b) => b.weight - a.weight || a.value.localeCompare(b.value));
}

/**
 * A domain routes out when the scenario's subject falls in its scope exclusions, or when
 * the scenario author put the topic explicitly out of scope.
 *
 * This is the mechanism that keeps a general domain from displacing the specialist one.
 * A sole-source acquisition decision carries legal exposure, but that exposure belongs to
 * export control and contracting, which is what legal-and-regulatory's exclusions say.
 *
 * Every matching topic is returned, not just the first. Appendix C §C.5.1 makes routing a
 * measurable signal: repeated unroutable requests clustering on a theme indicate a missing
 * domain, and that only works if each routed topic is recorded rather than collapsed.
 */
function routingsFor(
  domain: Domain,
  characteristics: ReadonlySet<string>,
  scenarioExclusions: ReadonlySet<string>,
): RoutingHint[] {
  const hints: RoutingHint[] = [];
  for (const exclusion of domain.scopeExclusions) {
    if (characteristics.has(exclusion.topic)) {
      hints.push({ domainId: domain.id, topic: exclusion.topic, routeTo: exclusion.routeTo });
    }
  }
  for (const inclusion of domain.scopeInclusions) {
    if (scenarioExclusions.has(inclusion)) {
      hints.push({ domainId: domain.id, topic: inclusion, routeTo: 'scenario:excluded' });
    }
  }
  return hints;
}

/**
 * Governed-Consequence is implicated by `safety_event` but never auto-convened.
 *
 * Those domains "instantiate only in cleared enclaves, under specific program need, with
 * human authority approval" (§B.14, §C.2.4, §C.8 stage 6). §B.2.5 Scenario 1 demonstrates
 * this directly: it carries a safety-event consequence class and its panel contains no
 * energetics or weapons-effects persona.
 *
 * The gate is surfaced rather than silently dropped, so the omission stays visible to the
 * human lead who adjudicates the panel.
 */
function governanceGates(
  classes: readonly ConsequenceClass[],
  implicated: ReadonlySet<Archetype>,
): GovernanceGate[] {
  if (!implicated.has('governed_consequence')) return [];

  const impliedBy = classes.filter((c) => ARCHETYPE_MAP[c].includes('governed_consequence'));
  return [
    {
      archetype: 'governed_consequence',
      impliedBy,
      reason:
        'Governed-Consequence domains instantiate only in a cleared enclave, under specific ' +
        'program need, with human authority approval (Appendix B §B.14, Appendix C §C.2.4). ' +
        'Convening surfaces the requirement; it does not satisfy it.',
    },
  ];
}

function warningsFor(slots: readonly PanelSlot[], config: ConveneConfig): string[] {
  const warnings: string[] = [];

  const full = slots.filter((s) => s.depth === 'full');
  if (full.length < config.panelSizeMin) {
    warnings.push(
      `Panel has ${full.length} domains at full depth, below the ${config.panelSizeMin}-${config.panelSizeMax} ` +
        `band in Appendix B §B.6. Check whether a consequence class is missing from the scenario.`,
    );
  } else if (full.length > config.panelSizeMax) {
    warnings.push(
      `Panel has ${full.length} domains at full depth, above the ${config.panelSizeMin}-${config.panelSizeMax} ` +
        `band in Appendix B §B.6. Larger panels degrade synthesis quality; consider clustered ` +
        `synthesis (Appendix C §C.6.2).`,
    );
  }

  // Not an error — the book's own Scenario 1 convenes provenance and legal from outside the
  // implicated set — but the Devil's Advocate reviewing the panel should see it.
  for (const slot of full.filter((s) => !s.archetypeImplicated)) {
    warnings.push(
      `${slot.domainId} is convened at full depth from ${slot.archetype}, which this ` +
        `scenario's consequence classes do not implicate. Convened on subject characteristics ` +
        `alone; confirm the consequence classes are complete.`,
    );
  }

  return warnings;
}
