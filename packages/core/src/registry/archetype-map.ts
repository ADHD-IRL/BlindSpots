import type { Archetype, ConsequenceClass } from '../types/archetype.ts';

/**
 * Consequence classes drive archetype selection (Appendix B §B.2.3).
 *
 * Transcribed verbatim from the table in §B.2.3. The mapping is deliberately many-to-many:
 * a scenario with three consequence classes typically implicates four or five archetypes,
 * which is the correct outcome because real programs fail in several ways at once.
 *
 * Note what does not appear here: any assumption that a particular discipline is always
 * relevant. A scenario whose only consequence class is in-service structural failure does
 * not implicate `immediate_observable` at all, and the resulting panel contains no cyber
 * persona at full depth. That is not an oversight — it is the architecture working, and
 * `convening.test.ts` guards it as a regression.
 */
export const ARCHETYPE_MAP: Readonly<Record<ConsequenceClass, readonly Archetype[]>> = {
  // Physical failure or degradation in service
  physical_failure_in_service: ['latent_physical', 'attributive_contested'],
  // Loss or compromise of sensitive information
  information_compromise: [
    'immediate_observable',
    'attributive_contested',
    'procedural_interpretive',
  ],
  // Mission unavailability at time of need
  mission_unavailability: ['immediate_observable', 'latent_physical', 'attributive_contested'],
  // Adversary gains capability advantage
  adversary_capability_advantage: ['attributive_contested', 'anticipatory_unvalidated'],
  // Program disruption: schedule, cost, source
  program_disruption: [
    'procedural_interpretive',
    'anticipatory_unvalidated',
    'attributive_contested',
  ],
  // Decision corruption: leadership acts on bad picture
  decision_corruption: ['attributive_contested', 'anticipatory_unvalidated'],
  // Safety or catastrophic-consequence event
  safety_event: ['latent_physical', 'governed_consequence'],
  // Legal, regulatory, or contractual exposure
  legal_exposure: ['procedural_interpretive'],
} as const;

/** The archetypes any of `classes` implicates, deduplicated and stably ordered. */
export function implicatedArchetypes(
  classes: readonly ConsequenceClass[],
): ReadonlySet<Archetype> {
  const out = new Set<Archetype>();
  for (const c of classes) {
    // No `?? []` fallback: ARCHETYPE_MAP is total over ConsequenceClass and a test asserts
    // it. A fallback here would be unreachable branch coverage standing in for a guarantee
    // the type system already provides.
    for (const archetype of ARCHETYPE_MAP[c]) out.add(archetype);
  }
  return out;
}
