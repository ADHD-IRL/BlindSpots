import {
  CONFIDENCE_RANK,
  type Confidence,
  type DomainStatus,
  VALIDITY_RANK,
} from '../types/archetype.ts';
import {
  isAttributionClaim,
  isDetectionClaim,
  isIndicatorClaim,
  isPredictiveClaim,
  isProhibitedMechanism,
  namesIndividual,
} from './claim-kind.ts';
import { untraceableSpecifics } from './specificity.ts';
import type { CharterViolation, FindingDraft, PersonaContext } from './types.ts';

/**
 * The charter validator.
 *
 * The persona proposes; this disposes. Every rule below is stated as binding somewhere in
 * Appendices B, C, or E, and every one is enforced here by deterministic code at the output
 * boundary rather than by instruction in a system prompt.
 *
 * Returns every violation rather than the first, so a persona repairing a finding sees the
 * whole problem at once instead of discovering it one round at a time.
 */
export function validateFinding(
  finding: FindingDraft,
  ctx: PersonaContext,
): CharterViolation[] {
  return [
    ...checkProhibitedOutput(finding, ctx),
    ...checkNamedIndividual(finding, ctx),
    ...checkScope(finding, ctx),
    ...checkConfidenceValidity(finding),
    ...checkArchetypeCap(finding, ctx),
    ...checkStatusCap(finding, ctx),
    ...checkDetectionStats(finding),
    ...checkBaseRate(finding, ctx),
    ...checkGapDiscipline(finding, ctx),
    ...checkGradeInflation(finding, ctx),
    ...checkSpecificity(finding, ctx),
  ];
}

// -- CH011 -------------------------------------------------------------------------------

/**
 * Governed-Consequence prohibited output (§C.2.4).
 *
 * "Enumerating which specific perturbations produce which degradation in which materials is
 * a sabotage methodology. It does not become permissible by being framed as detection
 * guidance, threat characterization, or hypothetical."
 *
 * Terminating, not degrading. There is no partial answer and no repair attempt.
 */
function checkProhibitedOutput(f: FindingDraft, ctx: PersonaContext): CharterViolation[] {
  if (!isProhibitedMechanism(f.statement)) return [];

  return [
    {
      code: 'CH011_PROHIBITED_OUTPUT',
      detail:
        'Statement requests or supplies mechanism-level instantiation (synthesis route, ' +
        'perturbation-to-effect pairing, or optimization for effect). This is prohibited ' +
        'under any framing including defensive, detective, or hypothetical. The program ' +
        'does not need to know how to dope its own materials; it needs to know where its ' +
        'verification regime has gaps, which is answerable entirely from the defensive side.',
      remediable: false,
      routeTo: routeFor(ctx, 'synthesis_routes') ?? 'human:program_authority',
    },
  ];
}

// -- CH010 -------------------------------------------------------------------------------

/**
 * The hard exclusion (§C.3.4).
 *
 * "A CI persona that profiles named individuals has become a surveillance instrument, and
 * no analytical benefit justifies it inside this construct." §E.8.6 restates it against the
 * temptation better statistics create: "Better screening methods make person-level
 * screening more tempting, not less prohibited."
 *
 * Applies to reflexive personas and to insider threat, whose subject is closest to the line.
 */
function checkNamedIndividual(f: FindingDraft, ctx: PersonaContext): CharterViolation[] {
  const inScope = ctx.personaClass === 'reflexive' || ctx.domainId === 'insider_threat';
  if (!inScope || !namesIndividual(f.statement)) return [];

  return [
    {
      code: 'CH010_NAMED_INDIVIDUAL',
      detail:
        'Statement contains person-identifying references. This persona reasons about ' +
        'roles, access categories, and structural exposure. Determinations about people ' +
        'belong to a human authority under its own legal framework.',
      remediable: false,
      routeTo: routeFor(ctx, 'named_individual_determination') ?? 'human:program_ci_authority',
    },
  ];
}

// -- CH007 -------------------------------------------------------------------------------

/** Out-of-scope tasking is refused and logged (§B.14), routed to the named target (§B.5). */
function checkScope(f: FindingDraft, ctx: PersonaContext): CharterViolation[] {
  const text = f.statement.toLowerCase();

  for (const exclusion of ctx.scopeExclusions) {
    if (mentionsTopic(text, exclusion.topic)) {
      return [
        {
          code: 'CH007_OUT_OF_SCOPE',
          detail: `Statement addresses "${exclusion.topic}", which this persona's scope excludes.`,
          remediable: false,
          routeTo: exclusion.routeTo,
        },
      ];
    }
  }

  // The inclusion half of the rule is checked against a DECLARED field rather than inferred
  // from prose. Matching snake_case registry terms against technical writing produces both
  // false positives and false negatives at a rate that would make the validator untrusted,
  // and a validator personas learn to work around enforces nothing. Requiring the persona
  // to name the inclusion it is speaking to is deterministic, and it is the same discipline
  // §D.2.5 relies on: explicit scope declarations are what give the panel prior knowledge of
  // where each contribution comes from.
  if (
    ctx.scopeInclusions.length > 0 &&
    f.addressesInclusion !== undefined &&
    !ctx.scopeInclusions.includes(f.addressesInclusion)
  ) {
    return [
      {
        code: 'CH007_OUT_OF_SCOPE',
        detail:
          `Finding declares scope inclusion "${f.addressesInclusion}", which this persona ` +
          `does not own (${ctx.scopeInclusions.join(', ')}).`,
        remediable: true,
      },
    ];
  }

  return [];
}

// -- CH001 -------------------------------------------------------------------------------

/** Confidence vocabulary and permitted validity tiers (§B.5.2). */
const REQUIRED_VALIDITY: Partial<Record<Confidence, 'high' | 'moderate'>> = {
  assessed: 'high', // "High validity only"
  likely: 'moderate', // "High, moderate"
};

function checkConfidenceValidity(f: FindingDraft): CharterViolation[] {
  const violations: CharterViolation[] = [];

  const floor = REQUIRED_VALIDITY[f.confidence];
  if (floor !== undefined && VALIDITY_RANK[f.validityTier] < VALIDITY_RANK[floor]) {
    violations.push({
      code: 'CH001_CONFIDENCE_VALIDITY',
      detail:
        `Confidence "${f.confidence}" requires ${floor === 'high' ? 'high' : 'high or moderate'} ` +
        `validity; this finding is ${f.validityTier}. Fluency is not evidence: the vocabulary ` +
        `is tied to the validity tier precisely so well-written findings cannot be read as ` +
        `better-supported ones.`,
      remediable: true,
    });
  }

  // "Plausible — Any, basis named." The basis is what distinguishes a plausible finding
  // from an assertion, so an empty one voids the term.
  if (f.confidence === 'plausible' && f.basis.trim() === '') {
    violations.push({
      code: 'CH001_CONFIDENCE_VALIDITY',
      detail:
        'Confidence "plausible" is permitted at any validity tier but only with the basis ' +
        'named (Appendix B §B.5.2). No basis was given.',
      remediable: true,
    });
  }

  return violations;
}

// -- CH002 -------------------------------------------------------------------------------

function checkArchetypeCap(f: FindingDraft, ctx: PersonaContext): CharterViolation[] {
  const violations: CharterViolation[] = [];

  // "Anticipatory-Unvalidated cannot exceed Plausible on any predictive claim." The
  // archetype has no usable feedback loop; its value is framing rather than prediction.
  if (
    ctx.archetype === 'anticipatory_unvalidated' &&
    isPredictiveClaim(f.statement) &&
    CONFIDENCE_RANK[f.confidence] > CONFIDENCE_RANK.plausible
  ) {
    violations.push({
      code: 'CH002_ARCHETYPE_CAP',
      detail:
        `Anticipatory-Unvalidated cannot exceed "plausible" on a predictive claim; this ` +
        `finding claims "${f.confidence}". No usable feedback loop exists for this archetype.`,
      remediable: true,
    });
  }

  // "Attributive-Contested cannot exceed Considered on attribution absent named
  // corroborating findings from other personas." Restated in §C.2.5 for Latent-Physical:
  // "Attribution to deliberate action may not exceed Considered on physical evidence alone."
  const attributionCapped =
    ctx.archetype === 'attributive_contested' || ctx.archetype === 'latent_physical';

  if (
    attributionCapped &&
    isAttributionClaim(f.statement) &&
    CONFIDENCE_RANK[f.confidence] > CONFIDENCE_RANK.considered
  ) {
    const corroborating = (f.corroboratingFindings ?? []).filter(
      // Self-corroboration is not corroboration. The rule exists to require agreement
      // across independently-bound fields, and a persona citing itself supplies none.
      (c) => c.personaId !== ctx.personaId,
    );

    if (corroborating.length === 0) {
      violations.push({
        code: 'CH002_ARCHETYPE_CAP',
        detail:
          `Attribution above "considered" requires named corroborating findings from other ` +
          `personas; this finding claims "${f.confidence}" with ` +
          `${(f.corroboratingFindings ?? []).length === 0 ? 'none' : 'only self-citation'}. ` +
          `Ambiguous evidence contradicts nothing, so a coherent adversarial explanation is ` +
          `not evidence that one is correct.`,
        remediable: true,
      });
    }
  }

  return violations;
}

// -- CH006 -------------------------------------------------------------------------------

/** The §C.5.3 promotion ladder, as a confidence ceiling. */
const STATUS_CEILING: Readonly<Record<DomainStatus, Confidence>> = {
  provisional: 'plausible', // uncurated, never shadow-run
  curated: 'likely', // field built and shadow-run, not yet validated against outcomes
  registered: 'assessed', // validated against outcomes, full range
};

function checkStatusCap(f: FindingDraft, ctx: PersonaContext): CharterViolation[] {
  const violations: CharterViolation[] = [];
  const ceiling = STATUS_CEILING[ctx.status];

  if (CONFIDENCE_RANK[f.confidence] > CONFIDENCE_RANK[ceiling]) {
    violations.push({
      code: 'CH006_STATUS_CAP',
      detail:
        `A ${ctx.status} persona is capped at "${ceiling}"; this finding claims ` +
        `"${f.confidence}". A persona without a validated field reasons largely from base ` +
        `model priors, which is exactly the condition producing fluent unreliable output.`,
      remediable: true,
    });
  }

  // "may contribute conditions, may not anchor a chain" (§C.5.2).
  if (ctx.status === 'provisional' && f.anchorsChain === true) {
    violations.push({
      code: 'CH006_STATUS_CAP',
      detail:
        'A provisional persona may contribute conditions but may not anchor a chain. ' +
        'Anchoring an unvalidated finding would put a chain\'s weight on a field nobody has ' +
        'shadow-run.',
      remediable: true,
    });
  }

  return violations;
}

// -- CH004 -------------------------------------------------------------------------------

/**
 * The sampling problem (§C.2.5, §C.2.6).
 *
 * "'We tested the lot and found nothing' is not a finding. The finding is: we tested n units
 * from a lot of N, using a method with sensitivity s for this defect class, giving this
 * probability of detecting contamination at rate r."
 *
 * This matters because adversarial insertion rates are low by design — an adversary salting
 * a lot at one or two percent sits well below the detection threshold of any sampling plan a
 * program realistically runs.
 */
function checkDetectionStats(f: FindingDraft): CharterViolation[] {
  if (!isDetectionClaim(f.statement)) return [];

  const missing: string[] = [];
  if (!isRate(f.samplingRate)) missing.push('sampling_rate');
  if (!isRate(f.falseNegativeRate)) missing.push('false_negative_rate');
  if (missing.length === 0) return [];

  return [
    {
      code: 'CH004_DETECTION_STATS_MISSING',
      detail:
        `Detection claim is missing ${missing.join(' and ')}. "Testing found nothing" is ` +
        `prohibited without them: acceptance sampling is built to catch process-level ` +
        `quality problems and is poorly matched to deliberate low-rate insertion.`,
      remediable: true,
    },
  ];
}

// -- CH008 -------------------------------------------------------------------------------

/**
 * Base rate discipline for behavioural indicators (§C.3.1).
 *
 * Without it, an indicator present in three percent of a cleared population annually reads
 * as evidence when its positive predictive value is poor.
 */
function checkBaseRate(f: FindingDraft, ctx: PersonaContext): CharterViolation[] {
  if (ctx.archetype !== 'attributive_contested' || !isIndicatorClaim(f.statement)) return [];

  const missing: string[] = [];
  if (!isRate(f.indicatorBaseRate)) missing.push('indicator_base_rate');
  if (!isRate(f.positivePredictiveValue)) missing.push('positive_predictive_value');
  if (missing.length === 0) return [];

  return [
    {
      code: 'CH008_BASE_RATE_MISSING',
      detail:
        `Behavioural-indicator claim is missing ${missing.join(' and ')}. Base rates in this ` +
        `archetype are unfavourable, and a finding that does not state the indicator's ` +
        `positive predictive value overstates what the indicator supports.`,
      remediable: true,
    },
  ];
}

// -- CH005 -------------------------------------------------------------------------------

/**
 * Gap discipline (§C.2.5, §C.2.7).
 *
 * "Where verification depends on records the program does not hold, emit Gap. Do not
 * estimate." Gap declarations naming the specific record, supplier tier, and unverifiable
 * claim aggregate into this archetype's most valuable single output: a map of where the
 * program is trusting documents it cannot check.
 */
function checkGapDiscipline(f: FindingDraft, ctx: PersonaContext): CharterViolation[] {
  if (f.confidence === 'gap') return []; // Already a gap declaration.

  const required = ctx.requiredEvidenceClasses ?? [];
  if (required.length === 0) return [];

  const retrieved = new Set(ctx.retrievedEvidenceClasses ?? []);
  const claimed = new Set(f.claimedEvidenceClasses ?? []);
  const missing = required.filter((cls) => claimed.has(cls) && !retrieved.has(cls));
  if (missing.length === 0) return [];

  return [
    {
      code: 'CH005_GAP_DISCIPLINE',
      detail:
        `Finding rests on evidence class(es) ${missing.join(', ')}, which the retrieval set ` +
        `does not contain. Emit a gap declaration naming the record and its holder rather ` +
        `than estimating. The inaccessible record is itself the finding.`,
      remediable: true,
    },
  ];
}

// -- CH009 -------------------------------------------------------------------------------

/**
 * No optimistic grade propagation (§E.2.2).
 *
 * "A finding synthesizing three C3 inputs is not thereby B2. Corroboration among sources of
 * unknown independence is exactly the failure mode section E.4 addresses."
 */
function checkGradeInflation(f: FindingDraft, ctx: PersonaContext): CharterViolation[] {
  if (f.sourceGrades.length === 0) return [];

  const byId = new Map(ctx.retrievedChunks.map((c) => [c.id, c]));
  const violations: CharterViolation[] = [];

  for (const claimed of f.sourceGrades) {
    const actual = byId.get(claimed.chunkId);
    if (actual === undefined) {
      violations.push({
        code: 'CH009_GRADE_INFLATION',
        detail: `Finding cites chunk ${claimed.chunkId}, which is not in its retrieval set.`,
        remediable: true,
      });
      continue;
    }
    // 'A' < 'F' and 1 < 6 in both scales, so "better" is "lower".
    if (claimed.reliability < actual.reliability || claimed.credibility < actual.credibility) {
      violations.push({
        code: 'CH009_GRADE_INFLATION',
        detail:
          `Finding claims ${claimed.reliability}${claimed.credibility} for chunk ` +
          `${claimed.chunkId}, which is graded ${actual.reliability}${actual.credibility}. ` +
          `Grades do not improve on the way to a finding.`,
        remediable: true,
      });
    }
  }

  return violations;
}

// -- CH003 -------------------------------------------------------------------------------

/**
 * Specificity trace (§B.9 step 5).
 *
 * Non-remediable by design. An untraceable specific is not a wording problem — allowing a
 * rewrite would let the persona keep the invention and soften the phrasing around it. The
 * specific is struck and the finding goes back without it.
 */
function checkSpecificity(f: FindingDraft, ctx: PersonaContext): CharterViolation[] {
  const corpus = ctx.retrievedChunks.map((c) => c.text);
  const untraceable = untraceableSpecifics(f.statement, corpus, f.specificityOverrides);
  if (untraceable.length === 0) return [];

  return [
    {
      code: 'CH003_UNTRACEABLE_SPECIFIC',
      detail:
        `Untraceable specifics: ${untraceable.map((s) => `${s.text} (${s.kind})`).join(', ')}. ` +
        `Every identifier, value, version, and date must trace to the bound field. ` +
        `Untraceable specifics are struck.`,
      remediable: false,
    },
  ];
}

// -- helpers -----------------------------------------------------------------------------

function isRate(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function routeFor(ctx: PersonaContext, topic: string): string | undefined {
  return ctx.scopeExclusions.find((e) => e.topic === topic)?.routeTo;
}

/** Topics are snake_case registry terms; statements are prose. Match on the words. */
function mentionsTopic(lowercaseText: string, topic: string): boolean {
  const words = topic.split('_').filter((w) => w.length > 2);
  if (words.length === 0) return false;
  return words.every((word) => lowercaseText.includes(word));
}
