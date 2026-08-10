import { describe, expect, it } from 'vitest';
import { chainBounds, interventionPoint } from '../src/composition/chain-bounds.ts';
import {
  discloseAgreement,
  effectiveN,
  effectiveNLimit,
} from '../src/metrics/effective-n.ts';

describe('chainBounds — Appendix E §E.3 worked example', () => {
  // "A five-step chain with steps at 0.8, 0.7, 0.9, 0.6, and 0.8 has a product of roughly
  // 0.24, against a minimum of 0.6."
  const WORKED = [0.8, 0.7, 0.9, 0.6, 0.8].map((feasibility) => ({ feasibility }));

  it('reproduces the stated bounds', () => {
    const bounds = chainBounds(WORKED);
    expect(bounds.floor).toBeCloseTo(0.24192, 10);
    expect(bounds.ceiling).toBe(0.6);
  });

  it('rounds to the 0.24 the book states', () => {
    expect(chainBounds(WORKED).floor.toFixed(2)).toBe('0.24');
  });

  it('keeps floor below ceiling — the range of honest uncertainty', () => {
    const { floor, ceiling } = chainBounds(WORKED);
    expect(floor).toBeLessThan(ceiling);
  });

  it('identifies the intervention point as the weakest step', () => {
    // §E.3.1: the step contributing most to the gap is the one whose disruption most
    // degrades the chain, which is what a defender needs for prioritization.
    expect(interventionPoint(WORKED)).toBe(3); // the 0.6 step
  });
});

describe('chainBounds — mechanics', () => {
  it('collapses to a single value for a one-step chain', () => {
    expect(chainBounds([{ feasibility: 0.42 }])).toEqual({ floor: 0.42, ceiling: 0.42 });
  });

  it('makes precondition stacking arithmetic rather than rhetorical', () => {
    // "A narratively compelling seven-step chain whose product falls below 0.05 is a chain
    // that reads far better than it performs, and the number says so."
    const sevenSteps = Array.from({ length: 7 }, () => ({ feasibility: 0.6 }));
    const { floor, ceiling } = chainBounds(sevenSteps);

    expect(floor).toBeLessThan(0.05);
    expect(ceiling).toBe(0.6); // reads as a better-than-even chain if you report only this
  });

  it('is exact for certainty and impossibility', () => {
    expect(chainBounds([{ feasibility: 1 }, { feasibility: 1 }])).toEqual({ floor: 1, ceiling: 1 });
    expect(chainBounds([{ feasibility: 0 }, { feasibility: 1 }])).toEqual({ floor: 0, ceiling: 0 });
  });

  it('rejects an empty chain', () => {
    expect(() => chainBounds([])).toThrow(RangeError);
  });

  it.each([[-0.1], [1.1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'rejects feasibility %p',
    (feasibility) => {
      expect(() => chainBounds([{ feasibility: 0.5 }, { feasibility }])).toThrow(RangeError);
    },
  );

  it('breaks intervention ties on the earlier step', () => {
    // The earlier step is the one a defender can act on soonest.
    expect(interventionPoint([{ feasibility: 0.3 }, { feasibility: 0.9 }, { feasibility: 0.3 }])).toBe(0);
  });
});

describe('effectiveN — Appendix E §E.4.1 design effect table', () => {
  // Reproduced exactly from the table in §E.4.1. Rows are rho, columns n = 5/10/20/40, then
  // the limit as n grows.
  const TABLE: readonly [number, number, number, number, number, number][] = [
    [0.1, 3.6, 5.3, 6.9, 8.2, 10.0],
    [0.3, 2.3, 2.7, 3.0, 3.1, 3.3],
    [0.5, 1.7, 1.8, 1.9, 2.0, 2.0],
    [0.7, 1.3, 1.4, 1.4, 1.4, 1.4],
    [0.9, 1.1, 1.1, 1.1, 1.1, 1.1],
  ];

  it.each(TABLE)('rho = %p reproduces the row exactly', (rho, at5, at10, at20, at40, limit) => {
    expect(Number(effectiveN(5, rho).toFixed(1))).toBe(at5);
    expect(Number(effectiveN(10, rho).toFixed(1))).toBe(at10);
    expect(Number(effectiveN(20, rho).toFixed(1))).toBe(at20);
    expect(Number(effectiveN(40, rho).toFixed(1))).toBe(at40);
    expect(Number(effectiveNLimit(rho).toFixed(1))).toBe(limit);
  });

  it('converges to 1/rho rather than growing without bound', () => {
    // This is the finding that matters: adding personas past a handful adds essentially
    // nothing to corroboration.
    expect(effectiveN(1_000_000, 0.7)).toBeCloseTo(effectiveNLimit(0.7), 4);
  });

  it('shows heterogeneity beating panel size', () => {
    // "Reducing rho from 0.7 to 0.3 is worth more than tripling panel size at rho = 0.7."
    expect(effectiveN(10, 0.3)).toBeGreaterThan(effectiveN(30, 0.7));
  });

  it('equals n when sources are genuinely independent', () => {
    expect(effectiveN(11, 0)).toBe(11);
    expect(effectiveNLimit(0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('collapses to 1 when sources are perfectly correlated', () => {
    // Ten copies of one mind is one source, which is the honest reading of ten instances of
    // one model agreeing.
    expect(effectiveN(10, 1)).toBe(1);
  });

  it.each([
    [0, 0.5],
    [5, -0.1],
    [5, 1.1],
    [Number.NaN, 0.5],
  ])('rejects n = %p, rho = %p', (n, rho) => {
    expect(() => effectiveN(n, rho)).toThrow(RangeError);
  });
});

describe('discloseAgreement — §E.4.3', () => {
  it('reports effective independence alongside the nominal count', () => {
    const disclosure = discloseAgreement(11, { kind: 'measured', rho: 0.68, basis: 'Q3 probe set' });

    // 11 / (1 + 10 * 0.68) = 1.41, which the book renders as 1.4.
    expect(disclosure.effectiveCount).toBeCloseTo(1.41, 2);
    expect(disclosure.statement).toBe(
      '11 personas concurred, effective independence 1.4, rho estimated at 0.68 from Q3 probe set.',
    );
  });

  it('says agreement is uninterpretable when rho is unmeasured', () => {
    // Not zero. Defaulting to zero would silently claim independence, which is the one
    // thing personas over a shared base model are known not to have.
    const disclosure = discloseAgreement(11, { kind: 'unmeasured' });

    expect(disclosure.effectiveCount).toBeNull();
    expect(disclosure.statement).toContain('UNMEASURED');
    expect(disclosure.statement).toContain('uninterpretable');
  });
});
