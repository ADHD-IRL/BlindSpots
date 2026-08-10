export interface ChainStepFeasibility {
  readonly feasibility: number;
}

export interface ChainBounds {
  /** Product of step feasibilities: the value if the steps are genuinely independent. */
  readonly floor: number;
  /** The weakest step: a hard upper bound requiring no independence assumption. */
  readonly ceiling: number;
}

/**
 * Chain composition bounds (Appendix E §E.3).
 *
 * Both bounds are computed and both must be reported. The naming is worth reading carefully
 * because it inverts the usual intuition:
 *
 *  - The **ceiling** is the weakest step. "A chain cannot be more feasible than its least
 *    feasible element... This is a hard upper bound and it requires no independence
 *    assumption."
 *  - The **floor** is the product under independence.
 *
 * "The gap between those two numbers is the range of honest uncertainty." Where the true
 * value sits depends on shared enablers: an adversary who achieves step one is more likely
 * to achieve step two when both draw on the same capability and access, which pushes toward
 * the ceiling; steps requiring genuinely distinct capabilities behave closer to independent
 * and push toward the floor.
 *
 * There is deliberately no function here that returns a single number. "Reporting a single
 * number is not [honest], and reporting only the minimum systematically overstates chain
 * feasibility, which is the direction that wastes remediation budget."
 *
 * The practical value is that precondition stacking becomes arithmetic rather than
 * rhetorical: a narratively compelling seven-step chain whose product falls below 0.05 is a
 * chain that reads far better than it performs, and the number says so without anyone having
 * to win an argument about it.
 */
export function chainBounds(steps: readonly ChainStepFeasibility[]): ChainBounds {
  if (steps.length === 0) {
    throw new RangeError('A chain must have at least one step.');
  }
  for (const [i, step] of steps.entries()) {
    if (!Number.isFinite(step.feasibility) || step.feasibility < 0 || step.feasibility > 1) {
      throw new RangeError(`Step ${i} has feasibility ${step.feasibility}, which is not in [0, 1].`);
    }
  }

  return {
    floor: steps.reduce((product, step) => product * step.feasibility, 1),
    ceiling: Math.min(...steps.map((step) => step.feasibility)),
  };
}

/**
 * The step contributing most to the gap between the bounds.
 *
 * §E.3.1: "It also identifies the intervention point automatically. The step contributing
 * most to the gap between ceiling and floor is the step whose disruption most degrades the
 * chain, which is precisely what a defender needs to know for prioritization."
 *
 * Measured as the step whose removal raises the floor most — equivalently the least feasible
 * step, since the floor is a product. Ties break on the earlier ordinal, which is the step a
 * defender can act on soonest.
 */
export function interventionPoint(steps: readonly ChainStepFeasibility[]): number {
  chainBounds(steps); // validate
  let best = 0;
  for (let i = 1; i < steps.length; i++) {
    if (steps[i]!.feasibility < steps[best]!.feasibility) best = i;
  }
  return best;
}
