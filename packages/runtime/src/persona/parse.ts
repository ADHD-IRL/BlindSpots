import {
  CONFIDENCE_TERMS,
  type Confidence,
  type FindingDraft,
  VALIDITY_TIERS,
  type Validity,
} from '@mae/core';

/**
 * Parsing a model response into a finding.
 *
 * Fails closed, everywhere. A structured-output schema makes malformed responses unlikely,
 * not impossible, and the failure mode this guards against is specific: a finding that
 * parses into *something* — a missing confidence quietly defaulting to `considered`, an
 * unrecognised validity tier coerced to `low` — reaches `validateFinding` looking
 * well-formed and passes rules it was never actually checked against. A parse error is
 * recoverable. A finding that entered the record by default is not.
 */

export class FindingParseError extends Error {
  readonly raw: string;

  constructor(message: string, raw: string) {
    super(`Could not parse a finding: ${message}`);
    this.name = 'FindingParseError';
    this.raw = raw;
  }
}

const CONFIDENCE_SET: ReadonlySet<string> = new Set(CONFIDENCE_TERMS);
const VALIDITY_SET: ReadonlySet<string> = new Set(VALIDITY_TIERS);

export function parseFinding(text: string, personaId: string): FindingDraft {
  const fail = (message: string): never => {
    throw new FindingParseError(message, text);
  };

  if (text.trim() === '') {
    // Reachable when a caller skips `assertUsable`: a refusal carries no content, and an
    // empty string must not read as a persona with nothing to say.
    return fail('the response was empty');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return fail((error as Error).message);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('expected a single JSON object');
  }
  const f = parsed as Record<string, unknown>;

  if (typeof f['statement'] !== 'string' || f['statement'].trim() === '') {
    return fail('statement is required and must be non-empty');
  }
  if (typeof f['confidence'] !== 'string' || !CONFIDENCE_SET.has(f['confidence'])) {
    return fail(`confidence must be one of ${CONFIDENCE_TERMS.join(', ')}`);
  }
  if (typeof f['validityTier'] !== 'string' || !VALIDITY_SET.has(f['validityTier'])) {
    return fail(`validityTier must be one of ${VALIDITY_TIERS.join(', ')}`);
  }
  // Required but permitted to be empty: CH001 is what decides whether an empty basis is
  // fatal, and it only is at `plausible`. Deciding that here would duplicate the rule in a
  // place nobody would think to look for it.
  if (typeof f['basis'] !== 'string') return fail('basis is required');

  const grades = f['sourceGrades'];
  if (!Array.isArray(grades)) return fail('sourceGrades is required and must be an array');

  const sourceGrades = grades.map((g, i) => {
    const grade = g as Record<string, unknown>;
    if (typeof g !== 'object' || g === null) return fail(`sourceGrades[${i}] must be an object`);
    if (typeof grade['chunkId'] !== 'string' || grade['chunkId'] === '') {
      return fail(`sourceGrades[${i}].chunkId is required`);
    }
    if (typeof grade['reliability'] !== 'string' || !/^[A-F]$/.test(grade['reliability'])) {
      return fail(`sourceGrades[${i}].reliability must be A–F`);
    }
    const credibility = grade['credibility'];
    if (typeof credibility !== 'number' || !Number.isInteger(credibility) || credibility < 1 || credibility > 6) {
      return fail(`sourceGrades[${i}].credibility must be an integer 1–6`);
    }
    return {
      chunkId: grade['chunkId'],
      reliability: grade['reliability'] as FindingDraft['sourceGrades'][number]['reliability'],
      credibility: credibility as FindingDraft['sourceGrades'][number]['credibility'],
    };
  });

  return {
    personaId,
    statement: f['statement'],
    confidence: f['confidence'] as Confidence,
    validityTier: f['validityTier'] as Validity,
    basis: f['basis'],
    sourceGrades,
    ...optionalString(f, 'addressesInclusion', fail),
    ...optionalBoolean(f, 'syntheticBasis', fail),
    ...optionalBoolean(f, 'anchorsChain', fail),
    ...optionalNumber(f, 'samplingRate', fail),
    ...optionalNumber(f, 'falseNegativeRate', fail),
    ...optionalNumber(f, 'indicatorBaseRate', fail),
    ...optionalNumber(f, 'positivePredictiveValue', fail),
    ...optionalStringArray(f, 'claimedEvidenceClasses', fail),
  };
}

type Fail = (message: string) => never;

function optionalString(f: Record<string, unknown>, key: string, fail: Fail): object {
  const value = f[key];
  if (value === undefined) return {};
  if (typeof value !== 'string') fail(`${key} must be a string`);
  return { [key]: value };
}

function optionalBoolean(f: Record<string, unknown>, key: string, fail: Fail): object {
  const value = f[key];
  if (value === undefined) return {};
  if (typeof value !== 'boolean') fail(`${key} must be a boolean`);
  return { [key]: value };
}

function optionalNumber(f: Record<string, unknown>, key: string, fail: Fail): object {
  const value = f[key];
  if (value === undefined) return {};
  // Not clamped to 0–1 here: CH004 and CH008 decide what a valid rate is, and a value
  // outside the range must reach them as a violation rather than be silently corrected
  // into a finding that then passes.
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${key} must be a finite number`);
  return { [key]: value };
}

function optionalStringArray(f: Record<string, unknown>, key: string, fail: Fail): object {
  const value = f[key];
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    fail(`${key} must be an array of strings`);
  }
  return { [key]: value };
}
