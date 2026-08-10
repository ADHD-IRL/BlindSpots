import type {
  Archetype,
  ConsequenceClass,
  DomainStatus,
  LifecycleStage,
  PanelDepth,
  PersonaClass,
} from '../types/archetype.ts';

/** A topic this domain does not own, and where it goes instead (Appendix B §B.5). */
export interface ScopeExclusion {
  readonly topic: string;
  /**
   * Named routing target. Appendix C §C.5.1 makes this measurable: when a persona routes to
   * a target not present in the convened panel or the registry, that is logged, and
   * repeated unroutable requests clustering on a theme indicate a missing domain.
   */
  readonly routeTo: string;
}

/**
 * A relevance predicate: the subject characteristics or consequence classes that make this
 * domain matter (Appendix B §B.2.4).
 *
 * Appendix C §C.4 step six is the constraint that matters here: "A domain that is not
 * registered against consequence classes will never be convened, and a domain registered
 * against everything will always be convened, which reintroduces a spine through the back
 * door." Predicates should be specific enough that some scenarios genuinely exclude
 * the domain.
 */
export interface RelevancePredicate {
  readonly kind: 'consequence_class' | 'subject_characteristic';
  readonly value: string;
  readonly weight: number;
}

export interface Domain {
  readonly id: string; // 'materials.metallurgy'
  readonly displayName: string;
  readonly archetype: Archetype;
  readonly parentDomain?: string;
  readonly scopeInclusions: readonly string[];
  readonly scopeExclusions: readonly ScopeExclusion[];
  readonly status: DomainStatus;
  readonly personaClass: PersonaClass;
  readonly predicates: readonly RelevancePredicate[];
}

export interface Registry {
  readonly domains: readonly Domain[];
}

/** A scenario, per the schema in Appendix B §B.2.2. */
export interface Scenario {
  readonly id: string;
  readonly subject: string;
  readonly lifecycleStage: LifecycleStage;
  readonly missionFunction: string;
  readonly consequenceClasses: readonly ConsequenceClass[];
  /**
   * The decision this assessment must inform, and when it is made. Without it an
   * assessment produces findings that arrive after they can be acted on — fatal for
   * latent-physical domains in particular, where the mitigation window frequently closes
   * at a milestone the assessment was scheduled after (§B.2.2).
   */
  readonly informingDecision: string;
  readonly decisionDate?: string;
  readonly adversarySet: readonly string[];
  readonly accessConstraints?: string;
  readonly classification: string;
  /** Controlled-vocabulary tags describing the subject. See `subjectCharacteristics`. */
  readonly subjectCharacteristics: readonly string[];
  readonly exclusions: readonly { readonly topic: string; readonly rationale: string }[];
  readonly authoredBy: string;
}

export interface MatchedPredicate {
  readonly kind: RelevancePredicate['kind'];
  readonly value: string;
  readonly weight: number;
}

export interface PanelSlot {
  readonly domainId: string;
  readonly archetype: Archetype;
  readonly depth: PanelDepth;
  readonly score: number;
  readonly archetypeImplicated: boolean;
  /** Why this domain is here. The proposal explains itself; §B.6 requires it be reviewable. */
  readonly matchedPredicates: readonly MatchedPredicate[];
}

/**
 * An archetype the scenario implicates but that convening will not instantiate on its own.
 *
 * Governed-Consequence domains instantiate only in cleared enclaves, under specific program
 * need, with human authority approval (§B.14, §C.2.4, §C.8 stage 6). Surfacing the gate
 * rather than silently dropping the archetype keeps the omission visible to the human lead
 * who adjudicates the panel.
 */
export interface GovernanceGate {
  readonly archetype: Archetype;
  readonly impliedBy: readonly ConsequenceClass[];
  readonly reason: string;
}

/** A domain excluded because it routes the subject elsewhere. */
export interface RoutingHint {
  readonly domainId: string;
  readonly topic: string;
  readonly routeTo: string;
}

export interface PanelProposal {
  readonly scenarioId: string;
  readonly implicatedArchetypes: readonly Archetype[];
  readonly slots: readonly PanelSlot[];
  readonly governanceGates: readonly GovernanceGate[];
  readonly routingHints: readonly RoutingHint[];
  /** Advisories for the human adjudicator; never a hard failure. */
  readonly warnings: readonly string[];
}
