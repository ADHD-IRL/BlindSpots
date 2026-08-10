/**
 * Deterministic claim classification.
 *
 * The archetype caps in §B.5.2 apply to particular kinds of claim — "cannot exceed Plausible
 * on any predictive claim", "cannot exceed Considered on attribution" — so something has to
 * decide which kind a statement is. That decision is made here, by cue lexicons, for two
 * reasons: it must be deterministic to be testable, and it must be inspectable so a
 * reviewer can argue with the lexicon rather than with a black box.
 *
 * Every classifier FAILS CLOSED. If a statement looks like it might be attribution, the
 * attribution cap applies and the persona restates. The cost of a false positive is a
 * rewrite; the cost of a false negative is attribution overreach reported at high
 * confidence, which §B.12 lists as a named failure mode.
 *
 * Lexicons are exported so they can be reviewed and extended against real output.
 */

/** Claims about what will or could happen. Capped at Plausible for Anticipatory-Unvalidated. */
export const PREDICTIVE_CUES: readonly string[] = [
  'will ', 'would ', 'is expected to', 'are expected to', 'projected', 'forecast',
  'anticipated', 'by 20', 'within the next', 'over the coming', 'future', 'trajectory',
  'is likely to occur', 'trend toward', 'trends toward', 'will result in', 'going to',
];

/**
 * Claims that some effect was deliberate rather than benign.
 *
 * §C.3.1 is the reason this cap is hard: "A panel convened to find adversarial activity,
 * presented with ambiguous behavioral evidence, will construct an adversarial explanation,
 * and that explanation will be coherent, well-argued, and frequently wrong."
 */
export const ATTRIBUTION_CUES: readonly string[] = [
  'deliberate', 'deliberately', 'intentional', 'intentionally', 'sabotage', 'sabotaged',
  'adversary inserted', 'adversary introduced', 'was inserted by', 'attributable to',
  'attributed to', 'the work of', 'state actor', 'malicious', 'tampering', 'tampered',
  'coordinated by', 'directed by', 'orchestrated', 'indicates hostile', 'hostile intent',
];

/** Claims resting on a test or inspection result. Requires sampling statistics. */
export const DETECTION_CUES: readonly string[] = [
  'testing found', 'tests found', 'we tested', 'inspection found', 'inspected',
  'no defects were found', 'nothing was found', 'found no', 'found nothing',
  'screening detected', 'detected no', 'ndi', 'nde', 'assay showed', 'sampling showed',
  'lot acceptance', 'passed inspection', 'cleared inspection', 'no anomalies were detected',
];

/**
 * Claims resting on a behavioural indicator. Requires a base rate and PPV.
 *
 * §C.3.1: "if a behavioral indicator is present in three percent of a cleared population
 * annually and the adversarial base rate is far lower, the indicator's positive predictive
 * value is poor, and the finding must say so."
 */
export const INDICATOR_CUES: readonly string[] = [
  'indicator', 'indicators', 'behavioral pattern', 'behaviour pattern', 'behavior pattern',
  'exhibits', 'exhibited', 'travel pattern', 'financial stress', 'access anomaly',
  'unusual access', 'foreign contact', 'reporting lapse', 'is consistent with insider',
];

/** Requests for the mechanism of harm. Prohibited outright for Governed-Consequence (§C.2.4). */
export const PROHIBITED_MECHANISM_CUES: readonly string[] = [
  'synthesis route', 'synthesis routes', 'formulation', 'preparation method',
  'precursor route', 'to introduce', 'introduce to degrade', 'dopant to use',
  'which perturbation', 'perturbation to introduce', 'optimize for effect',
  'optimise for effect', 'maximize yield', 'maximise yield', 'improve stability of the agent',
  'delivery optimization', 'delivery optimisation', 'how to degrade', 'how to weaken',
];

/**
 * Person-identifying references. Prohibited in reflexive and insider-threat output (§C.3.4).
 *
 * Deliberately conservative — a false positive costs a rewrite, and the alternative is a
 * persona that has become a surveillance instrument.
 */
export const NAMED_INDIVIDUAL_CUES: readonly string[] = [
  'employee id', 'badge number', 'personnel number', 'clearance holder named',
  'ssn', 'date of birth', 'home address', 'personal email', 'his ', 'her ',
];

/**
 * A person-signalling word ("engineer", "contractor") followed by something that looks like
 * a name.
 *
 * The role word is matched case-insensitively but the name is checked for capitalization in
 * the ORIGINAL text: a single case-insensitive regex would match "engineer and", turning
 * every sentence about a role into a named-individual violation.
 *
 * No `g` flag — `RegExp.test` on a global regex carries `lastIndex` between calls, which
 * would make this classifier depend on which findings were checked before it.
 */
const PERSON_ROLE_RE =
  /\b(?:mr|ms|mrs|dr|employee|engineer|technician|analyst|manager|director|officer|contractor|individual|subject)\b\.?\s+(\S+)/i;

const CAPITALIZED_NAME_RE = /^[A-Z][a-z]{1,}$/;

/**
 * Cue matching is word-boundary aware.
 *
 * Plain substring matching is not safe here: the cue `nde` occurs inside "under", so
 * "will produce disbond under service loading" would classify as a detection claim and
 * demand sampling statistics for a finding that reports no test at all. A validator that
 * rejects conforming findings trains personas to work around it.
 */
function containsAny(haystack: string, cues: readonly string[]): boolean {
  const text = haystack.toLowerCase();
  return cues.some((cue) => cueRegex(cue).test(text));
}

const CUE_CACHE = new Map<string, RegExp>();

function cueRegex(cue: string): RegExp {
  let re = CUE_CACHE.get(cue);
  if (re === undefined) {
    const escaped = cue.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // \b works at both ends for alphanumeric cues; cues ending in a space (like "will ")
    // are trimmed above and get the same treatment.
    re = new RegExp(`\\b${escaped}\\b`);
    CUE_CACHE.set(cue, re);
  }
  return re;
}

export function isPredictiveClaim(statement: string): boolean {
  return containsAny(statement, PREDICTIVE_CUES);
}

export function isAttributionClaim(statement: string): boolean {
  return containsAny(statement, ATTRIBUTION_CUES);
}

export function isDetectionClaim(statement: string): boolean {
  return containsAny(statement, DETECTION_CUES);
}

export function isIndicatorClaim(statement: string): boolean {
  return containsAny(statement, INDICATOR_CUES);
}

export function isProhibitedMechanism(statement: string): boolean {
  return containsAny(statement, PROHIBITED_MECHANISM_CUES);
}

export function namesIndividual(statement: string): boolean {
  if (containsAny(statement, NAMED_INDIVIDUAL_CUES)) return true;

  const following = PERSON_ROLE_RE.exec(statement)?.[1];
  return following !== undefined && CAPITALIZED_NAME_RE.test(following);
}
