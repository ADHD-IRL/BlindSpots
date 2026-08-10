/**
 * The six domain archetypes (Appendix B §B.3).
 *
 * Archetypes are peers. None is the reference implementation for the others, and none is
 * privileged: the whole point of §B.1 is that an architecture with a home discipline
 * produces excellent findings in that discipline and shallow ones everywhere else, while
 * reporting all of them at the same confidence.
 */
export const ARCHETYPES = [
  'immediate_observable',
  'latent_physical',
  'attributive_contested',
  'procedural_interpretive',
  'anticipatory_unvalidated',
  'governed_consequence',
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

/**
 * Consequence classes (Appendix B §B.2.3). The scenario author enumerates what failure
 * looks like for this subject; these are the convening mechanism.
 */
export const CONSEQUENCE_CLASSES = [
  'physical_failure_in_service',
  'information_compromise',
  'mission_unavailability',
  'adversary_capability_advantage',
  'program_disruption',
  'decision_corruption',
  'safety_event',
  'legal_exposure',
] as const;

export type ConsequenceClass = (typeof CONSEQUENCE_CLASSES)[number];

/** Lifecycle stages from the scenario schema (Appendix B §B.2.2). */
export const LIFECYCLE_STAGES = [
  'requirements',
  'design',
  'qualification',
  'production',
  'fielded',
  'sustainment',
  'disposal',
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/**
 * Confidence vocabulary (Appendix B §B.5.2). Fixed terms, ordered weakest to strongest so
 * that ceilings can be expressed as comparisons. `gap` is not a confidence level at all —
 * it is the declaration that a claim is not assessable — so it sits outside the ordering.
 */
export const CONFIDENCE_TERMS = ['gap', 'considered', 'plausible', 'likely', 'assessed'] as const;

export type Confidence = (typeof CONFIDENCE_TERMS)[number];

/** Ordinal rank used for ceiling comparisons. `gap` ranks lowest and never violates a cap. */
export const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = {
  gap: 0,
  considered: 1,
  plausible: 2,
  likely: 3,
  assessed: 4,
};

/**
 * Validity tiers (Appendix A §A.8, applied per domain in §A.12 step one). These describe
 * the domain's feedback structure, not the analyst's certainty: a subdomain with stable
 * cue-outcome relationships and timely unambiguous feedback supports encoded expertise,
 * and one without supports encoded consensus, which is a weaker thing.
 */
export const VALIDITY_TIERS = ['low', 'moderate', 'high'] as const;

export type Validity = (typeof VALIDITY_TIERS)[number];

export const VALIDITY_RANK: Readonly<Record<Validity, number>> = {
  low: 0,
  moderate: 1,
  high: 2,
};

/** Persona classes (Appendix B §B.4). */
export const PERSONA_CLASSES = ['domain', 'adversary', 'process', 'reflexive'] as const;

export type PersonaClass = (typeof PERSONA_CLASSES)[number];

/**
 * Registration status (Appendix C §C.5.3). The ladder is not cosmetic: each rung carries a
 * confidence ceiling, because a provisional persona has no validated field and reasons
 * largely from base model priors, which is the condition that produces fluent unreliable
 * output.
 */
export const DOMAIN_STATUSES = ['provisional', 'curated', 'registered'] as const;

export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

/** Panel depth (Appendix B §B.6 step 4). */
export const PANEL_DEPTHS = ['full', 'screening'] as const;

export type PanelDepth = (typeof PANEL_DEPTHS)[number];
