import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_REPAIR_ATTEMPTS, isRejected, nextRepairState } from '../src/charter/repair.ts';
import type {
  CharterViolation,
  FindingDraft,
  PersonaContext,
  ViolationCode,
} from '../src/charter/types.ts';
import { VIOLATION_CODES } from '../src/charter/types.ts';
import { validateFinding } from '../src/charter/validate.ts';
import type { GradedChunk } from '../src/retrieval/types.ts';
import {
  CONFIDENCE_TERMS,
  type Confidence,
  DOMAIN_STATUSES,
  VALIDITY_TIERS,
  type Validity,
} from '../src/types/archetype.ts';

const CHUNKS: GradedChunk[] = [
  {
    id: 'CHUNK_C3',
    sourceId: 'src-1',
    fieldId: 'materials.polymers_adhesives',
    text:
      'Surface preparation for adhesive bonding of primary structure. Inadequate preparation ' +
      'produces disbond under service environment loading. Lot 4471B showed a 2.0 percent ' +
      'deviation against the AMS-4911 baseline on 2026-04-20.',
    reliability: 'C',
    credibility: 3,
    situationTags: ['surface_preparation', 'disbond'],
  },
];

const BASE_CTX: PersonaContext = {
  personaId: 'materials.polymers_adhesives.principal',
  domainId: 'materials.polymers_adhesives',
  archetype: 'latent_physical',
  personaClass: 'domain',
  status: 'registered',
  retrievedChunks: CHUNKS,
  scopeInclusions: ['surface_preparation', 'adhesive_bonding', 'service_environment'],
  scopeExclusions: [{ topic: 'vendor_ownership', routeTo: 'supply_chain.vendor_intent' }],
};

const BASE_FINDING: FindingDraft = {
  personaId: BASE_CTX.personaId,
  statement: 'The surface preparation is inadequate for the service environment.',
  confidence: 'considered',
  validityTier: 'moderate',
  basis: 'field schema for bonded joint failure modes',
  sourceGrades: [],
};

const codes = (violations: CharterViolation[]): ViolationCode[] =>
  [...new Set(violations.map((v) => v.code))].sort();

// ==========================================================================================
// The adversarial corpus. Every case must be rejected with exactly the codes it names.
// ==========================================================================================

interface FixtureCase {
  readonly name: string;
  readonly why: string;
  readonly context: Partial<PersonaContext>;
  readonly finding: Partial<FindingDraft>;
  readonly expectedCodes: ViolationCode[];
}

const CORPUS: FixtureCase[] = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/charter/non-conforming.json', import.meta.url)),
      'utf8',
    ),
  ) as { cases: FixtureCase[] }
).cases;

describe('adversarial corpus (fixtures/charter/non-conforming.json)', () => {
  it.each(CORPUS.map((c) => [c.name, c] as const))('rejects %s', (_name, testCase) => {
    const ctx: PersonaContext = { ...BASE_CTX, ...testCase.context };
    const finding: FindingDraft = {
      ...BASE_FINDING,
      ...testCase.finding,
      personaId: ctx.personaId,
      // The fixture writes SELF for the self-corroboration case so it stays readable. The
      // key stays absent when the case declares none, rather than explicitly undefined.
      ...(testCase.finding.corroboratingFindings === undefined
        ? {}
        : {
            corroboratingFindings: testCase.finding.corroboratingFindings.map((c) => ({
              ...c,
              personaId: c.personaId === 'SELF' ? ctx.personaId : c.personaId,
            })),
          }),
    };

    expect(codes(validateFinding(finding, ctx)), testCase.why).toEqual(
      [...testCase.expectedCodes].sort(),
    );
  });

  it('exercises every declared violation code', () => {
    // Both directions matter. A code declared with no rule behind it is a constraint the
    // charter advertises and does not enforce; a rule emitting a code the enum does not
    // declare is a violation nothing downstream can route on. A rule with no adversarial
    // fixture is a rule nobody has watched fail.
    const fromCorpus = CORPUS.flatMap((c) => c.expectedCodes);

    // CH005 is context-level rather than statement-level — it turns on required versus
    // retrieved evidence classes — so it is driven here rather than from the corpus file.
    const gapViolations = validateFinding(
      { ...BASE_FINDING, claimedEvidenceClasses: ['cure_records'] },
      {
        ...BASE_CTX,
        requiredEvidenceClasses: ['cure_records'],
        retrievedEvidenceClasses: [],
      },
    );

    const exercised = new Set<ViolationCode>([...fromCorpus, ...gapViolations.map((v) => v.code)]);
    expect([...exercised].sort()).toEqual([...VIOLATION_CODES].sort());
  });
});

// ==========================================================================================

describe('a conforming finding', () => {
  it('passes clean', () => {
    expect(validateFinding(BASE_FINDING, BASE_CTX)).toEqual([]);
  });

  it('passes with specifics that appear verbatim in the retrieval set', () => {
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement: 'Lot 4471B showed a 2.0 percent deviation against the AMS-4911 baseline.',
    };
    expect(codes(validateFinding(finding, BASE_CTX))).toEqual([]);
  });

  it('passes a detection claim that states both statistics', () => {
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement: 'Testing found no disbond in the sampled surface preparation.',
      samplingRate: 0.05,
      falseNegativeRate: 0.4,
    };
    expect(codes(validateFinding(finding, BASE_CTX))).toEqual([]);
  });
});

describe('CH001 confidence and validity (§B.5.2)', () => {
  const rank: Record<Confidence, number> = { gap: 0, considered: 1, plausible: 2, likely: 3, assessed: 4 };
  const validityRank: Record<Validity, number> = { low: 0, moderate: 1, high: 2 };

  it('permits exactly the combinations the vocabulary table permits', () => {
    for (const confidence of CONFIDENCE_TERMS) {
      for (const validityTier of VALIDITY_TIERS) {
        const violations = validateFinding(
          { ...BASE_FINDING, confidence, validityTier },
          BASE_CTX,
        ).filter((v) => v.code === 'CH001_CONFIDENCE_VALIDITY');

        // Assessed: high only. Likely: high or moderate. Everything else: any tier.
        const shouldFail =
          (confidence === 'assessed' && validityRank[validityTier] < validityRank.high) ||
          (confidence === 'likely' && validityRank[validityTier] < validityRank.moderate);

        expect(violations.length > 0, `${confidence} @ ${validityTier}`).toBe(shouldFail);
      }
    }
    expect(rank.assessed).toBeGreaterThan(rank.considered);
  });

  it('is remediable — restating at a lower confidence satisfies it', () => {
    const bad = validateFinding({ ...BASE_FINDING, confidence: 'assessed', validityTier: 'low' }, BASE_CTX);
    expect(bad.every((v) => v.remediable)).toBe(true);

    const repaired = validateFinding(
      { ...BASE_FINDING, confidence: 'considered', validityTier: 'low' },
      BASE_CTX,
    );
    expect(repaired).toEqual([]);
  });
});

describe('CH002 archetype caps (§B.5.2, §C.2.5)', () => {
  it('lets attribution reach likely when another persona corroborates', () => {
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement: 'The anomaly pattern is deliberate rather than a commercial quality escape.',
      confidence: 'likely',
      validityTier: 'high',
      corroboratingFindings: [{ findingId: 'f-9', personaId: 'supply_chain.vendor_intent.principal' }],
    };
    expect(codes(validateFinding(finding, BASE_CTX))).toEqual([]);
  });

  it('does not cap a non-attribution claim in an attribution-capped archetype', () => {
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement: 'The surface preparation is inadequate for the service environment.',
      confidence: 'assessed',
      validityTier: 'high',
    };
    expect(codes(validateFinding(finding, BASE_CTX))).toEqual([]);
  });

  it('does not cap a predictive claim outside anticipatory_unvalidated', () => {
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement: 'Inadequate preparation will produce disbond under service environment loading.',
      confidence: 'likely',
      validityTier: 'high',
    };
    expect(codes(validateFinding(finding, BASE_CTX))).toEqual([]);
  });

  it('fails closed on ambiguous attribution wording', () => {
    // The cost of a false positive here is a rewrite. The cost of a false negative is
    // attribution overreach reported at high confidence (§B.12).
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement: 'The deviation is plausibly attributable to tampering upstream.',
      confidence: 'likely',
      validityTier: 'high',
    };
    expect(codes(validateFinding(finding, BASE_CTX))).toContain('CH002_ARCHETYPE_CAP');
  });
});

describe('CH005 gap discipline (§C.2.5, §C.2.7)', () => {
  const gapCtx: PersonaContext = {
    ...BASE_CTX,
    requiredEvidenceClasses: ['cure_records', 'bath_chemistry'],
    retrievedEvidenceClasses: ['bath_chemistry'],
  };

  it('rejects a finding resting on evidence the program does not hold', () => {
    const finding: FindingDraft = { ...BASE_FINDING, claimedEvidenceClasses: ['cure_records'] };
    expect(codes(validateFinding(finding, gapCtx))).toEqual(['CH005_GAP_DISCIPLINE']);
  });

  it('accepts a gap declaration in its place', () => {
    // The inaccessible record is itself the finding — this is the archetype's most valuable
    // single output, a map of where the program is trusting documents it cannot check.
    const finding: FindingDraft = {
      ...BASE_FINDING,
      confidence: 'gap',
      claimedEvidenceClasses: ['cure_records'],
    };
    expect(codes(validateFinding(finding, gapCtx))).toEqual([]);
  });

  it('accepts a finding resting only on retrieved evidence', () => {
    const finding: FindingDraft = { ...BASE_FINDING, claimedEvidenceClasses: ['bath_chemistry'] };
    expect(codes(validateFinding(finding, gapCtx))).toEqual([]);
  });
});

describe('CH009 grade discipline (§E.2.2)', () => {
  it('rejects a finding citing a chunk that was never retrieved', () => {
    // A distinct failure from grade inflation: the finding rests on evidence absent from its
    // own retrieval set, so there is nothing to check the claimed grade against.
    const finding: FindingDraft = {
      ...BASE_FINDING,
      sourceGrades: [{ chunkId: 'CHUNK_NEVER_RETRIEVED', reliability: 'C', credibility: 3 }],
    };
    const violation = validateFinding(finding, BASE_CTX).find(
      (v) => v.code === 'CH009_GRADE_INFLATION',
    )!;

    expect(violation.detail).toContain('not in its retrieval set');
    expect(violation.remediable).toBe(true);
  });

  it('accepts grades that match the retrieval set exactly', () => {
    const finding: FindingDraft = {
      ...BASE_FINDING,
      sourceGrades: [{ chunkId: 'CHUNK_C3', reliability: 'C', credibility: 3 }],
    };
    expect(codes(validateFinding(finding, BASE_CTX))).toEqual([]);
  });

  it('accepts grades weaker than the source, since only improvement is the error', () => {
    // Understating is not the failure mode §E.2.2 describes. Optimistic propagation is.
    const finding: FindingDraft = {
      ...BASE_FINDING,
      sourceGrades: [{ chunkId: 'CHUNK_C3', reliability: 'E', credibility: 5 }],
    };
    expect(codes(validateFinding(finding, BASE_CTX))).toEqual([]);
  });
});

describe('CH003 specificity trace (§B.9 step 5)', () => {
  it('is non-remediable — the specific is struck, not rephrased', () => {
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement: 'Lot 7743B deviated against the AMS-9915 baseline.',
    };
    const violations = validateFinding(finding, BASE_CTX).filter(
      (v) => v.code === 'CH003_UNTRACEABLE_SPECIFIC',
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]!.remediable).toBe(false);
  });

  it('accepts a specific that is derivable rather than verbatim', () => {
    // The field says "2.0 percent" and "2026-04-20"; the finding says "2%" and
    // "20 April 2026". The field genuinely supports both.
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement: 'A 2% deviation was recorded on 20 April 2026.',
    };
    expect(codes(validateFinding(finding, BASE_CTX))).toEqual([]);
  });

  it('derives dates in the other direction too', () => {
    // Technical prose writes dates both ways, and neither direction is invention. Here the
    // field records the long form and the finding writes ISO.
    const ctx: PersonaContext = {
      ...BASE_CTX,
      retrievedChunks: [
        { ...CHUNKS[0]!, text: 'The cure deviation was recorded on 20 April 2026.' },
      ],
    };
    const finding: FindingDraft = { ...BASE_FINDING, statement: 'Recorded on 2026-04-20.' };

    expect(codes(validateFinding(finding, ctx))).toEqual([]);
  });

  it('honours a human override', () => {
    // Extraction has false positives over technical prose. The override path exists for
    // that — and every use of it is logged to the ledger.
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement: 'Lot 7743B deviated from baseline.',
      specificityOverrides: ['Lot 7743B'],
    };
    expect(codes(validateFinding(finding, BASE_CTX))).toEqual([]);
  });

  it('names every untraceable specific, not just the first', () => {
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement: 'Lot 7743B shows 9.9 percent deviation against AMS-9915.',
    };
    const detail = validateFinding(finding, BASE_CTX).find(
      (v) => v.code === 'CH003_UNTRACEABLE_SPECIFIC',
    )!.detail;

    expect(detail).toContain('7743B');
    expect(detail).toContain('9.9 percent');
    expect(detail).toContain('AMS-9915');
  });
});

describe('CH007 scope (§B.14)', () => {
  it('routes rather than repairs when the topic is excluded', () => {
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement: 'The vendor ownership structure indicates foreign control.',
    };
    const violation = validateFinding(finding, BASE_CTX).find((v) => v.code === 'CH007_OUT_OF_SCOPE')!;

    expect(violation.remediable).toBe(false);
    expect(violation.routeTo).toBe('supply_chain.vendor_intent');
  });

  it('accepts a finding declaring an inclusion the persona owns', () => {
    const finding: FindingDraft = { ...BASE_FINDING, addressesInclusion: 'surface_preparation' };
    expect(codes(validateFinding(finding, BASE_CTX))).toEqual([]);
  });

  it('rejects a finding declaring an inclusion the persona does not own', () => {
    // Repairable and NOT routed, unlike the exclusion branch: the persona named a scope it
    // does not hold, which is a mis-declaration to correct rather than a request to hand to
    // another authority. Scope is declared rather than inferred from prose — see
    // validate.ts for why matching registry terms against technical writing was rejected.
    const finding: FindingDraft = { ...BASE_FINDING, addressesInclusion: 'beneficial_ownership' };
    const violation = validateFinding(finding, BASE_CTX).find((v) => v.code === 'CH007_OUT_OF_SCOPE')!;

    expect(violation.remediable).toBe(true);
    expect(violation.routeTo).toBeUndefined();
    expect(violation.detail).toContain('beneficial_ownership');
  });

  it('does not check declarations when the persona declares no inclusions', () => {
    const ctx: PersonaContext = { ...BASE_CTX, scopeInclusions: [] };
    const finding: FindingDraft = { ...BASE_FINDING, addressesInclusion: 'anything_at_all' };
    expect(codes(validateFinding(finding, ctx))).toEqual([]);
  });
});

describe('CH010 and CH011 terminate rather than degrade', () => {
  it('routes a named-individual determination to the CI authority', () => {
    const ctx: PersonaContext = { ...BASE_CTX, domainId: 'insider_threat', archetype: 'attributive_contested' };
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement: 'Engineer Marcus Reyes has anomalous access and his badge number is in scope.',
    };
    const violation = validateFinding(finding, ctx).find((v) => v.code === 'CH010_NAMED_INDIVIDUAL')!;

    expect(violation.remediable).toBe(false);
    expect(violation.routeTo).toBe('human:program_ci_authority');
  });

  it('does not fire on role-level and access-category language', () => {
    // The persona reasons about roles, access categories, and structural exposure. That
    // must remain possible or the domain has no output at all.
    const ctx: PersonaContext = { ...BASE_CTX, domainId: 'insider_threat', archetype: 'attributive_contested' };
    const finding: FindingDraft = {
      ...BASE_FINDING,
      statement:
        'Privileged maintenance roles hold standing write access to the configuration baseline.',
    };
    expect(codes(validateFinding(finding, ctx))).not.toContain('CH010_NAMED_INDIVIDUAL');
  });

  it('rejects prohibited mechanism content regardless of framing', () => {
    for (const framing of [
      'For detection purposes, the perturbation to introduce is a trace dopant.',
      'Hypothetically, the synthesis route would begin with the precursor.',
      'As threat characterization only: optimize for effect by adjusting the formulation.',
    ]) {
      const violation = validateFinding({ ...BASE_FINDING, statement: framing }, BASE_CTX).find(
        (v) => v.code === 'CH011_PROHIBITED_OUTPUT',
      );
      expect(violation, framing).toBeDefined();
      expect(violation!.remediable).toBe(false);
    }
  });
});

describe('repair reducer', () => {
  const remediable: CharterViolation = {
    code: 'CH001_CONFIDENCE_VALIDITY',
    detail: 'x',
    remediable: true,
  };
  const nonRemediable: CharterViolation = {
    code: 'CH003_UNTRACEABLE_SPECIFIC',
    detail: 'x',
    remediable: false,
  };
  const routing: CharterViolation = {
    code: 'CH011_PROHIBITED_OUTPUT',
    detail: 'x',
    remediable: false,
    routeTo: 'human:program_authority',
  };

  it('accepts a finding with no violations', () => {
    expect(nextRepairState([])).toEqual({ kind: 'accepted' });
  });

  it('offers exactly one repair, then discards', () => {
    expect(nextRepairState([remediable], 0).kind).toBe('awaiting_repair');
    expect(nextRepairState([remediable], MAX_REPAIR_ATTEMPTS)).toMatchObject({
      kind: 'discarded',
      reason: 'repair_failed',
    });
  });

  it('discards a non-remediable violation without offering repair', () => {
    expect(nextRepairState([nonRemediable], 0)).toMatchObject({
      kind: 'discarded',
      reason: 'non_remediable',
    });
  });

  it('routes before anything else, and never offers a partial answer', () => {
    // A persona answering the safe eighty percent of a prohibited request has answered a
    // prohibited request (§C.2.4).
    expect(nextRepairState([remediable, routing], 0)).toMatchObject({
      kind: 'routed',
      routeTo: 'human:program_authority',
    });
  });

  it('does not count acceptance or a pending repair as rejection', () => {
    // isRejected gates whether the finding enters the record. A finding still in repair has
    // not been rejected, and treating it as such would discard work the persona is owed.
    expect(isRejected({ kind: 'accepted' })).toBe(false);
    expect(isRejected(nextRepairState([remediable], 0))).toBe(false);
    expect(isRejected(nextRepairState([nonRemediable], 0))).toBe(true);
    expect(isRejected(nextRepairState([routing], 0))).toBe(true);
  });

  it('never silently accepts a finding that has violations', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            code: fc.constantFrom<ViolationCode>(
              'CH001_CONFIDENCE_VALIDITY',
              'CH003_UNTRACEABLE_SPECIFIC',
              'CH011_PROHIBITED_OUTPUT',
            ),
            detail: fc.string(),
            remediable: fc.boolean(),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        fc.integer({ min: 0, max: 3 }),
        (violations, attempt) => {
          const state = nextRepairState(violations, attempt);
          expect(state.kind).not.toBe('accepted');
          if (state.kind !== 'awaiting_repair') expect(isRejected(state)).toBe(true);
        },
      ),
    );
  });
});

describe('property: the validator is total and deterministic', () => {
  it('never throws and always returns the same result for the same input', () => {
    fc.assert(
      fc.property(
        fc.record({
          statement: fc.string({ maxLength: 200 }),
          confidence: fc.constantFrom(...CONFIDENCE_TERMS),
          validityTier: fc.constantFrom(...VALIDITY_TIERS),
          basis: fc.string({ maxLength: 40 }),
        }),
        fc.constantFrom(...DOMAIN_STATUSES),
        (partial, status) => {
          const finding: FindingDraft = { ...BASE_FINDING, ...partial };
          const ctx: PersonaContext = { ...BASE_CTX, status };

          const first = validateFinding(finding, ctx);
          const second = validateFinding(finding, ctx);
          expect(JSON.stringify(first)).toBe(JSON.stringify(second));
        },
      ),
    );
  });
});
