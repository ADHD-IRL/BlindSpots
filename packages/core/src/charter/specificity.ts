/**
 * Specificity trace (Appendix B §B.9 step 5, §B.12 "hallucinated specificity").
 *
 * "Every identifier, value, version, and date traced to a bound field. Untraceable
 * specifics struck."
 *
 * The failure mode this exists for is precise values with no source: a model's fluency is
 * largely independent of its correctness (§D.8.3), so a confidently-stated part number is
 * exactly as well-written whether or not it appears anywhere in the field.
 *
 * Known limitation, stated rather than papered over: regex plus entity extraction over
 * technical prose will flag legitimate specifics as untraceable. The human override path
 * exists for that, and every override is logged.
 */

export const SPECIFIC_KINDS = [
  'version',
  'date',
  'part_number',
  'identifier',
  'percentage',
  'measurement',
  'quantity',
  'named_entity',
] as const;

export type SpecificKind = (typeof SPECIFIC_KINDS)[number];

export interface Specific {
  readonly kind: SpecificKind;
  readonly text: string;
}

export type TraceOutcome = 'matched' | 'derivable' | 'untraceable';

/**
 * Ordered most specific first. A token that matches an earlier pattern is not re-matched by
 * a later, looser one — otherwise `AMS-4911` would also register as a bare quantity.
 */
const PATTERNS: readonly { kind: SpecificKind; re: RegExp }[] = [
  // 2026-04-20, 20 April 2026, April 2026, 04/20/2026
  {
    kind: 'date',
    re: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/g,
  },
  // AMS-4911, MIL-STD-810H
  { kind: 'part_number', re: /\b[A-Z]{2,}[A-Z0-9]*[-–][A-Z0-9]+(?:[-–][A-Z0-9]+)*\b/g },
  // Lot 4471B, heat 22841, S/N 7A21-004. The lookahead requires a digit in the token, so
  // "the lot and found nothing" does not register "and" as a lot identifier.
  {
    kind: 'identifier',
    re: /\b(?:lot|heat|serial|batch|s\/n|p\/n)\s*#?\s*(?=[A-Za-z0-9-]*\d)[A-Z0-9][A-Z0-9-]*\b/gi,
  },
  // Percentage and measurement run before version, so "9.9 percent" is a percentage rather
  // than a bare "9.9" swallowed by the version pattern with its unit left behind.
  // No trailing \b after the alternation: "%" is not a word character, so \b would fail
  // immediately after it and "2%" would fall through to the bare-quantity pattern.
  { kind: 'percentage', re: /\b\d+(?:\.\d+)?\s?(?:%|percent\b)/gi },
  {
    kind: 'measurement',
    re: /\b\d+(?:\.\d+)?\s?(?:mm|cm|km|in|ft|kg|mg|lb|ksi|MPa|GPa|psi|°C|°F|hours?|hrs?|days?|months?|years?|cycles?)\b/g,
  },
  // v4.5, 1.2.3, R2024a. A bare "1.2" is deliberately NOT a version — in technical prose it
  // is far more often a quantity, and mislabelling it produces a confusing violation
  // message for a specific that still gets traced either way.
  { kind: 'version', re: /\bv\d+(?:\.\d+)+[a-z]?\b|\b\d+\.\d+\.\d+[a-z]?\b/gi },
  { kind: 'quantity', re: /\b\d+(?:,\d{3})*(?:\.\d+)?\b/g },
];

/**
 * Words that begin a sentence or are otherwise capitalized without naming anything.
 * Kept deliberately small: over-suppressing here turns a real invented entity into a
 * silent pass, which is the failure this check exists to prevent.
 */
const ENTITY_STOPWORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'A', 'An', 'It', 'We', 'They', 'There', 'If',
  'When', 'Where', 'While', 'Although', 'However', 'Because', 'Since', 'Given', 'Testing',
  'Analysis', 'Evidence', 'Findings', 'Sampling', 'Detection', 'No', 'Not', 'Both', 'Each',
  'Some', 'Any', 'All', 'One', 'Two', 'Three', 'Gap', 'Assessed', 'Likely', 'Plausible',
  'Considered', 'Phase', 'Note', 'Per', 'Attribution', 'Confidence', 'Under', 'Without',
]);

/** Two or more consecutive capitalized words, or an all-caps acronym of 3+ letters. */
const ENTITY_RE = /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+|[A-Z]{3,})\b/g;

export function extractSpecifics(text: string): Specific[] {
  const found: Specific[] = [];
  const claimed: { start: number; end: number }[] = [];

  const overlaps = (start: number, end: number): boolean =>
    claimed.some((c) => start < c.end && end > c.start);

  for (const { kind, re } of PATTERNS) {
    for (const match of text.matchAll(new RegExp(re.source, re.flags))) {
      const start = match.index;
      const end = start + match[0].length;
      if (overlaps(start, end)) continue;
      claimed.push({ start, end });
      found.push({ kind, text: match[0].trim() });
    }
  }

  for (const match of text.matchAll(ENTITY_RE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(start, end)) continue;
    const phrase = match[0].trim();
    if (phrase.split(/\s+/).every((word) => ENTITY_STOPWORDS.has(word))) continue;
    claimed.push({ start, end });
    found.push({ kind: 'named_entity', text: phrase });
  }

  // Deduplicate on kind+normalized text, ordered for stable violation messages.
  const seen = new Set<string>();
  return found
    .filter((s) => {
      const key = `${s.kind}:${normalize(s.text)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.text.localeCompare(b.text));
}

/**
 * Traces one specific against the retrieved text.
 *
 * `derivable` covers the cases where the field genuinely supports the claim but not
 * character-for-character: a date written differently, a number with separators, a unit
 * spelled out. Anything else is `untraceable`, and untraceable specifics are struck.
 */
export function traceSpecific(specific: Specific, corpus: readonly string[]): TraceOutcome {
  const needle = normalize(specific.text);
  const haystacks = corpus.map(normalize);

  if (haystacks.some((h) => h.includes(needle))) return 'matched';

  for (const variant of derivations(specific)) {
    if (haystacks.some((h) => h.includes(normalize(variant)))) return 'derivable';
  }

  if (numericallyDerivable(specific, haystacks)) return 'derivable';

  return 'untraceable';
}

/**
 * Numeric equivalence with a matching unit.
 *
 * "2%" and "2.0 percent" are the same claim, and a field stating one supports the other.
 * Comparing the parsed values rather than the strings avoids a class of false positive that
 * would otherwise dominate — technical prose is inconsistent about trailing zeros,
 * thousands separators, and unit spelling, and none of that inconsistency is invention.
 */
const NUMERIC_KINDS = new Set<SpecificKind>(['percentage', 'measurement', 'quantity']);

function numericallyDerivable(specific: Specific, haystacks: readonly string[]): boolean {
  if (!NUMERIC_KINDS.has(specific.kind)) return false;

  const parsed = specific.text.match(/^([\d,]+(?:\.\d+)?)\s*(.*)$/);
  if (parsed === null) return false;

  const value = Number(parsed[1]!.replace(/,/g, ''));
  if (!Number.isFinite(value)) return false;
  const unit = canonicalUnit(parsed[2] ?? '');

  for (const haystack of haystacks) {
    for (const match of haystack.matchAll(/([\d,]+(?:\.\d+)?)\s*([a-z%°]*)/g)) {
      const candidate = Number(match[1]!.replace(/,/g, ''));
      if (candidate === value && canonicalUnit(match[2] ?? '') === unit) return true;
    }
  }
  return false;
}

function canonicalUnit(raw: string): string {
  const unit = raw.trim().toLowerCase();
  return unit === 'percent' ? '%' : unit;
}

function derivations(specific: Specific): string[] {
  const variants: string[] = [];
  const raw = specific.text;

  // Separators and spacing: "1,200" vs "1200", "10 mm" vs "10mm", "AMS–4911" vs "AMS-4911".
  variants.push(raw.replace(/,/g, ''), raw.replace(/\s+/g, ''), raw.replace(/[–—]/g, '-'));

  // Trailing zeros: "0.50" vs "0.5". A field stating one supports the other.
  const numeric = raw.match(/^(\d+(?:\.\d+)?)/)?.[1];
  if (numeric !== undefined && numeric.includes('.')) {
    variants.push(raw.replace(numeric, String(Number(numeric))));
  }

  // Percent notation.
  if (specific.kind === 'percentage') {
    variants.push(raw.replace(/\s?percent/i, '%'), raw.replace(/\s?%/, ' percent'));
  }

  // Dates in both directions. A finding may write the long form while the field records
  // ISO, or the reverse; the field supports the claim either way.
  if (specific.kind === 'date') {
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso !== null) {
      const [, y, m, dd] = iso;
      const month = MONTHS[Number(m) - 1];
      if (month !== undefined) {
        variants.push(`${Number(dd)} ${month} ${y}`, `${month} ${Number(dd)}, ${y}`, `${month} ${y}`);
      }
    }

    const long = raw.match(/^(?:(\d{1,2})\s+)?([A-Z][a-z]+)\s+(\d{4})$/);
    if (long !== null) {
      const [, dd, monthName, y] = long;
      const monthIndex = MONTHS.findIndex((m) => m === monthName);
      if (monthIndex >= 0) {
        const mm = String(monthIndex + 1).padStart(2, '0');
        if (dd !== undefined) variants.push(`${y}-${mm}-${dd.padStart(2, '0')}`);
        variants.push(`${y}-${mm}`);
      }
    }
  }

  return variants.filter((v) => v !== raw);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
}

export interface UntraceableSpecific extends Specific {
  readonly outcome: 'untraceable';
}

/** Every specific in `text` that the corpus does not support, minus any human override. */
export function untraceableSpecifics(
  text: string,
  corpus: readonly string[],
  overrides: readonly string[] = [],
): UntraceableSpecific[] {
  const overridden = new Set(overrides.map(normalize));
  return extractSpecifics(text)
    .filter((s) => !overridden.has(normalize(s.text)))
    .filter((s) => traceSpecific(s, corpus) === 'untraceable')
    .map((s) => ({ ...s, outcome: 'untraceable' as const }));
}
