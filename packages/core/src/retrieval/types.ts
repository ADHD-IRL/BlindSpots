/**
 * Admiralty Code grading (Appendix E §E.2).
 *
 * Two independent axes, and the independence is the information content. "A completely
 * reliable source can report information that is doubtful. An unreliable source can report
 * something independently confirmed. Collapsing the two into a single confidence figure
 * destroys the distinction and is the most common error in practice."
 *
 * So there is deliberately no `toScalar` here, and there never should be. B2 and D2 differ
 * in a way no single number preserves.
 */

/** Source reliability, A (completely reliable) through F (cannot be judged). */
export const RELIABILITY_GRADES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type Reliability = (typeof RELIABILITY_GRADES)[number];

export const RELIABILITY_MEANING: Readonly<Record<Reliability, string>> = {
  A: 'completely reliable',
  B: 'usually reliable',
  C: 'fairly reliable',
  D: 'not usually reliable',
  E: 'unreliable',
  F: 'cannot be judged',
};

/** Information credibility, 1 (confirmed by independent sources) through 6 (cannot be judged). */
export const CREDIBILITY_GRADES = [1, 2, 3, 4, 5, 6] as const;
export type Credibility = (typeof CREDIBILITY_GRADES)[number];

export const CREDIBILITY_MEANING: Readonly<Record<Credibility, string>> = {
  1: 'confirmed by independent sources',
  2: 'probably true',
  3: 'possibly true',
  4: 'doubtful',
  5: 'improbable',
  6: 'cannot be judged',
};

/**
 * A retrieved chunk with both grades attached.
 *
 * The grades travel with the chunk all the way to the finding. "A finding derived from B2
 * material and a finding derived from D4 material should not arrive looking alike, and at
 * present they do" (§E.2.1). This is also what makes the audit trail real for the
 * verification problem in Chapter Twenty-One: a non-specialist validator cannot evaluate
 * metallurgy, but can absolutely check whether a finding rests on A1 or E5 material.
 */
export interface GradedChunk {
  readonly id: string;
  readonly sourceId: string;
  readonly fieldId: string;
  readonly text: string;
  readonly reliability: Reliability;
  readonly credibility: Credibility;
  readonly situationTags: readonly string[];
}

/**
 * A situational query (Appendix A §A.12 step four).
 *
 * "Indexing by document is nearly useless. Index by situation type, by cue pattern, by
 * adversary technique, by system characteristic, by failure mode. The question the
 * retrieval layer must answer is not 'what documents mention this term' but 'what does the
 * field know about situations that look like this one.'"
 *
 * There is deliberately no free-text `query` field. A keyword string would let callers slip
 * back into document search, which is the thing this shape exists to prevent.
 */
export interface SituationQuery {
  readonly situationType: string;
  readonly cuePatterns?: readonly string[];
  readonly adversaryTechniques?: readonly string[];
  readonly systemCharacteristics?: readonly string[];
  readonly failureModes?: readonly string[];
}

/** Every tag a situation query implies, deduplicated and stably ordered. */
export function queryTags(query: SituationQuery): string[] {
  return [
    ...new Set([
      query.situationType,
      ...(query.cuePatterns ?? []),
      ...(query.adversaryTechniques ?? []),
      ...(query.systemCharacteristics ?? []),
      ...(query.failureModes ?? []),
    ]),
  ].sort();
}
