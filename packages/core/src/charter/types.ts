import type { GradedChunk } from '../retrieval/types.ts';
import type {
  Archetype,
  Confidence,
  DomainStatus,
  PersonaClass,
  Validity,
} from '../types/archetype.ts';

/**
 * Charter violation codes.
 *
 * Every one is a rule the book states as binding. The point of collecting them here as a
 * closed enum is that "the charter prohibits attribution above Considered on physical
 * evidence alone" has to be a check that runs, not a sentence in a prompt: a constraint that
 * lives only in a system prompt is a request, honoured most of the time and violated exactly
 * when the model is most confident, which is when it matters.
 */
export const VIOLATION_CODES = [
  'CH001_CONFIDENCE_VALIDITY',
  'CH002_ARCHETYPE_CAP',
  'CH003_UNTRACEABLE_SPECIFIC',
  'CH004_DETECTION_STATS_MISSING',
  'CH005_GAP_DISCIPLINE',
  'CH006_STATUS_CAP',
  'CH007_OUT_OF_SCOPE',
  'CH008_BASE_RATE_MISSING',
  'CH009_GRADE_INFLATION',
  'CH010_NAMED_INDIVIDUAL',
  'CH011_PROHIBITED_OUTPUT',
] as const;

export type ViolationCode = (typeof VIOLATION_CODES)[number];

export interface CharterViolation {
  readonly code: ViolationCode;
  readonly detail: string;
  /**
   * Whether a revised statement could satisfy the rule.
   *
   * `false` means the finding is discarded rather than returned for repair. An untraceable
   * specific is not a wording problem — rephrasing it would only launder the invention —
   * and a prohibited-output request must terminate rather than degrade, because "a persona
   * answering the safe eighty percent of a prohibited request has answered a prohibited
   * request" (§C.2.4).
   */
  readonly remediable: boolean;
  /**
   * Set when the rule requires routing rather than revision. Terminating: the request goes
   * to the named authority and no partial answer is produced.
   */
  readonly routeTo?: string;
}

/** A source grade a finding claims for itself. */
export interface ClaimedGrade {
  readonly chunkId: string;
  readonly reliability: GradedChunk['reliability'];
  readonly credibility: GradedChunk['credibility'];
}

export interface FindingDraft {
  readonly personaId: string;
  readonly statement: string;
  readonly confidence: Confidence;
  readonly validityTier: Validity;
  /** Required when confidence is `plausible`: §B.5.2 permits it at any tier, "basis named". */
  readonly basis: string;
  readonly sourceGrades: readonly ClaimedGrade[];
  /**
   * Which of the persona's scope inclusions this finding speaks to.
   *
   * Declared rather than inferred: matching registry terms against technical prose is too
   * unreliable to gate on, and §D.2.5 wants explicit scope declarations anyway so unshared
   * contributions arrive with a reason to be credited.
   */
  readonly addressesInclusion?: string;
  /**
   * Findings from OTHER personas that corroborate an attribution above the archetype cap.
   * Self-citation does not count and is rejected — the rule exists to require corroboration
   * across independently-bound fields, not within one.
   */
  readonly corroboratingFindings?: readonly { readonly findingId: string; readonly personaId: string }[];
  /** Detection claims must state both (§C.2.5, §C.2.6). */
  readonly samplingRate?: number;
  readonly falseNegativeRate?: number;
  /** Behavioural-indicator claims must state the base rate and resulting PPV (§C.3.1). */
  readonly indicatorBaseRate?: number;
  readonly positivePredictiveValue?: number;
  /** Whether this finding is offered as an anchor for a chain step. */
  readonly anchorsChain?: boolean;
  /** Evidence classes the finding's basis relies on. Checked against what was retrieved. */
  readonly claimedEvidenceClasses?: readonly string[];
  /**
   * Specifics a human reviewer has accepted despite failing the trace. Every override is
   * logged to the ledger — the path exists because extraction has false positives (§6 of
   * the implementation plan), not because the rule is optional.
   */
  readonly specificityOverrides?: readonly string[];
}

export interface PersonaContext {
  readonly personaId: string;
  readonly domainId: string;
  readonly archetype: Archetype;
  readonly personaClass: PersonaClass;
  /** Drives the confidence ceiling from the §C.5.3 promotion ladder. */
  readonly status: DomainStatus;
  readonly retrievedChunks: readonly GradedChunk[];
  readonly scopeInclusions: readonly string[];
  readonly scopeExclusions: readonly { readonly topic: string; readonly routeTo: string }[];
  /**
   * Evidence classes this domain requires before a finding is admissible. Where the
   * required class was not retrieved, the persona must emit a Gap, not estimate (§C.2.5).
   */
  readonly requiredEvidenceClasses?: readonly string[];
  /** Situation tags present in the retrieval set, used for the gap check. */
  readonly retrievedEvidenceClasses?: readonly string[];
}
