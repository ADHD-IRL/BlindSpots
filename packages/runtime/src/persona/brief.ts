import {
  CONFIDENCE_TERMS,
  type CharterViolation,
  type GradedChunk,
  type PersonaContext,
  type Scenario,
  VALIDITY_TIERS,
} from '@mae/core';
import type { CanonicalObject, ModelRequest } from '../model/types.ts';

/**
 * Building the request a persona answers.
 *
 * The charter is a validator, not a prompt — but that principle is about *enforcement*, not
 * about silence. The brief below states the confidence vocabulary and the tracing rule
 * because a persona that does not know the vocabulary cannot emit a valid term at all, and
 * because first-pass conformance is what keeps the repair loop from running on every
 * finding. It states them to raise yield. It does not state them to enforce anything:
 * `validateFinding` runs over whatever comes back, and it does not care what the prompt said.
 *
 * What the brief must never contain is another persona's output. §B.7.1 makes Phase 1
 * independent analysis — the hidden-profile countermeasure in §D depends on each persona
 * committing to a position before it can see anyone else's — so the only evidence here is
 * this persona's own bound field.
 */

export const FINDING_SCHEMA: CanonicalObject = {
  type: 'object',
  additionalProperties: false,
  required: ['statement', 'confidence', 'validityTier', 'basis', 'sourceGrades'],
  properties: {
    statement: { type: 'string', minLength: 1 },
    confidence: { type: 'string', enum: [...CONFIDENCE_TERMS] },
    validityTier: { type: 'string', enum: [...VALIDITY_TIERS] },
    basis: { type: 'string' },
    addressesInclusion: { type: 'string' },
    syntheticBasis: { type: 'boolean' },
    samplingRate: { type: 'number' },
    falseNegativeRate: { type: 'number' },
    indicatorBaseRate: { type: 'number' },
    positivePredictiveValue: { type: 'number' },
    anchorsChain: { type: 'boolean' },
    claimedEvidenceClasses: { type: 'array', items: { type: 'string' } },
    sourceGrades: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['chunkId', 'reliability', 'credibility'],
        properties: {
          chunkId: { type: 'string' },
          reliability: { type: 'string' },
          credibility: { type: 'number' },
        },
      },
    },
  },
};

export interface BriefOptions {
  readonly model: string;
  readonly maxTokens?: number;
}

export function personaSystemPrompt(ctx: PersonaContext): string {
  const lines = [
    `You are the ${ctx.personaId} persona on a multidisciplinary adversary emulation panel.`,
    `Domain: ${ctx.domainId}. Archetype: ${ctx.archetype}. Persona class: ${ctx.personaClass}.`,
    '',
    'Your scope covers: ' + ctx.scopeInclusions.join(', ') + '.',
  ];

  if (ctx.scopeExclusions.length > 0) {
    lines.push(
      'Outside your scope, and owned by another persona: ' +
        ctx.scopeExclusions.map((e) => `${e.topic} (belongs to ${e.routeTo})`).join(', ') +
        '. Do not answer on these. Say that it is out of scope and name the owner.',
    );
  }

  lines.push(
    '',
    'Answer ONLY from the retrieved passages in the user message. You cannot see any other',
    "persona's work, and you are not meant to: this phase records what each domain concludes",
    'independently, before anyone is influenced by anyone else.',
    '',
    'Every identifier, value, version and date in your statement must appear in a retrieved',
    'passage. If the evidence you would need is not there, that absence is itself a finding:',
    'set confidence to "gap" and name the record you would need and who holds it. Do not',
    'estimate around a missing record.',
    '',
    `Confidence is one of: ${CONFIDENCE_TERMS.join(', ')}.`,
    `Validity tier is one of: ${VALIDITY_TIERS.join(', ')}.`,
    'Cite the passages you used by their chunk id, with the grades shown against them.',
    'Grades do not improve on their way into a finding.',
    '',
    'Return a single JSON object matching the finding schema. No prose outside it.',
  );

  return lines.join('\n');
}

export function personaUserPrompt(
  scenario: Scenario,
  ctx: PersonaContext,
  chunks: readonly GradedChunk[],
): string {
  const passages =
    chunks.length === 0
      ? '(none — the bound field returned nothing for this situation)'
      : chunks
          .map(
            (c) =>
              `[${c.id}] (${c.reliability}/${c.credibility}` +
              `${c.contentClass === 'synthetic' ? ', SYNTHETIC — invented, not evidence' : ''}) ` +
              `${c.text}`,
          )
          .join('\n\n');

  return [
    'SCENARIO',
    `Subject: ${scenario.subject}`,
    `Lifecycle stage: ${scenario.lifecycleStage}`,
    `Mission function: ${scenario.missionFunction}`,
    `Consequence classes: ${scenario.consequenceClasses.join(', ')}`,
    `Informing decision: ${scenario.informingDecision}`,
    `Subject characteristics: ${scenario.subjectCharacteristics.join(', ')}`,
    ...(scenario.exclusions.length === 0
      ? []
      : [
          'Explicitly out of assessment scope: ' +
            scenario.exclusions.map((e) => `${e.topic} (${e.rationale})`).join('; '),
        ]),
    '',
    'RETRIEVED PASSAGES FROM YOUR BOUND FIELD',
    passages,
    '',
    'TASK',
    `State one finding within ${ctx.domainId} that bears on the decision above.`,
  ].join('\n');
}

export function buildPersonaRequest(
  scenario: Scenario,
  ctx: PersonaContext,
  chunks: readonly GradedChunk[],
  options: BriefOptions,
): ModelRequest {
  return {
    purpose: `phase1_finding:${ctx.personaId}`,
    model: options.model,
    maxTokens: options.maxTokens ?? 2048,
    system: personaSystemPrompt(ctx),
    messages: [{ role: 'user', content: personaUserPrompt(scenario, ctx, chunks) }],
    outputSchema: FINDING_SCHEMA,
  };
}

/**
 * The repair request.
 *
 * One attempt, and it carries the violation codes verbatim. The persona is told what failed
 * rather than asked to try again, because "revise this" produces a rewrite of the prose
 * around the same defect — and several of these rules exist precisely to catch a defect that
 * survives rephrasing.
 *
 * Non-remediable violations never reach here: `nextRepairState` discards or routes them
 * first. An untraceable specific is struck rather than reworded, since offering a rewrite
 * would let the persona keep the invention and soften the sentence around it.
 */
export function buildRepairRequest(
  original: ModelRequest,
  priorResponse: string,
  violations: readonly CharterViolation[],
  options: BriefOptions,
): ModelRequest {
  return {
    ...original,
    purpose: `${original.purpose}:repair`,
    model: options.model,
    messages: [
      ...original.messages,
      { role: 'assistant', content: priorResponse },
      {
        role: 'user',
        content: [
          'That finding was rejected at the output boundary. The specific failures:',
          '',
          ...violations.map((v) => `- ${v.code}: ${v.detail}`),
          '',
          'Revise the finding so it conforms, or withdraw it by returning a finding with',
          'confidence "gap" naming what would be needed to support it. This is the only',
          'repair attempt; a second failure discards the finding and the discard is logged.',
        ].join('\n'),
      },
    ],
  };
}
