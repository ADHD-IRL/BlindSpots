/**
 * Correlation-adjusted agreement (Appendix E §E.4).
 *
 * This is where quantification earns its place: it converts the most serious limitation in
 * the architecture from a caveat into a number. §B.7.2 states that agreement among personas
 * drawing on a shared base model is weak evidence. §E.4 answers "how weak?".
 */

/**
 * Effective independent sample size under clustered sampling.
 *
 *   n_eff = n / (1 + (n - 1) * rho)
 *
 * The denominator is the design effect. The behaviour that matters: as n grows, n_eff does
 * not grow without bound — it converges to 1/rho. At rho = 0.7, a plausible value for
 * personas over a shared base model with overlapping corpora, forty agreeing personas carry
 * the evidential weight of roughly 1.4 independent sources. Adding personas past a handful
 * adds essentially nothing to corroboration, no matter how impressive the consensus looks.
 *
 * That is also the fundable argument for architectural heterogeneity: reducing rho from 0.7
 * to 0.3 is worth more than tripling panel size at rho = 0.7.
 */
export function effectiveN(n: number, rho: number): number {
  if (!Number.isFinite(n) || n < 1) {
    throw new RangeError(`n must be at least 1, received ${n}`);
  }
  if (!Number.isFinite(rho) || rho < 0 || rho > 1) {
    throw new RangeError(`rho must be in [0, 1], received ${rho}`);
  }
  return n / (1 + (n - 1) * rho);
}

/** The limit of `effectiveN` as n grows: 1/rho, or Infinity for uncorrelated sources. */
export function effectiveNLimit(rho: number): number {
  if (!Number.isFinite(rho) || rho < 0 || rho > 1) {
    throw new RangeError(`rho must be in [0, 1], received ${rho}`);
  }
  return rho === 0 ? Number.POSITIVE_INFINITY : 1 / rho;
}

/**
 * A rho estimate together with where it came from.
 *
 * `unmeasured` is a first-class state, not a missing value defaulting to zero. §E.4.3
 * requires every package containing panel agreement to report effective independence
 * alongside the nominal count "with the rho estimate and its basis", and until a
 * ground-truth probe set exists there is no estimate to report. Defaulting to zero would
 * silently claim the personas are independent, which is the one thing they are known not
 * to be.
 */
export type RhoEstimate =
  | { readonly kind: 'measured'; readonly rho: number; readonly basis: string }
  | { readonly kind: 'unmeasured' };

export interface AgreementDisclosure {
  readonly nominalCount: number;
  readonly effectiveCount: number | null;
  readonly rho: RhoEstimate;
  readonly statement: string;
}

/**
 * Renders the disclosure that must accompany any reported panel agreement (§E.4.3).
 *
 * "'Eleven personas concurred' and 'eleven personas concurred, effective independence 1.4,
 * rho estimated at 0.68 from Q3 probe set' are the same finding presented honestly and
 * dishonestly. The second is harder to over-read, which is the point."
 */
export function discloseAgreement(
  nominalCount: number,
  rho: RhoEstimate,
): AgreementDisclosure {
  if (rho.kind === 'unmeasured') {
    return {
      nominalCount,
      effectiveCount: null,
      rho,
      statement:
        `${nominalCount} personas concurred. Correlation between personas is UNMEASURED, so ` +
        `effective independent sample size cannot be computed and this agreement is ` +
        `uninterpretable as corroboration. A probe set with established ground truth is ` +
        `required before agreement carries evidential weight.`,
    };
  }

  const effective = effectiveN(nominalCount, rho.rho);
  return {
    nominalCount,
    effectiveCount: effective,
    rho,
    statement:
      `${nominalCount} personas concurred, effective independence ${effective.toFixed(1)}, ` +
      `rho estimated at ${rho.rho.toFixed(2)} from ${rho.basis}.`,
  };
}
