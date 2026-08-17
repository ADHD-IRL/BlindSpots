import { fileURLToPath } from 'node:url';
import { writeCassette } from '../cassette/library.ts';
import type { Cassette } from '../cassette/types.ts';
import { cassetteKey } from '../model/key.ts';
import type { ModelRequest, RecordedResponse } from '../model/types.ts';

/**
 * Regenerates the authored cassettes in `fixtures/cassettes/`.
 *
 * Committed rather than run once and forgotten, because the key over a request is exact: if
 * the request shape or its defaults ever change, every shipped cassette stops loading and
 * this is how they come back. That is the intended behaviour — a cassette that no longer
 * matches its request must fail, not quietly answer a prompt it was never given.
 *
 *   node --experimental-strip-types packages/runtime/src/bin/author-cassettes.ts
 *
 * Everything written here is AUTHORED: a human wrote the responses so the persona runtime
 * could be built and tested without model credentials. No model produced any of this text,
 * and `origin: "authored"` is what carries that fact to every consumer — the transport
 * stamps `provenance: "authored"` on replay, and it goes to the ledger.
 */

const OUT_DIR = fileURLToPath(new URL('../../../../fixtures/cassettes', import.meta.url));

const CAPTURED_BY = 'system:authored_fixture';
// Fixed, not `new Date()`: regenerating unchanged cassettes should produce no diff.
const CAPTURED_AT = '2026-08-11T00:00:00.000Z';

const MODEL = 'claude-opus-5';

/**
 * The persona brief.
 *
 * Deliberately thin. M4 builds the real one, and when it does these cassettes will not match
 * and must be re-authored. The charter is not restated here as instruction: it is enforced
 * by `validateFinding` after the response comes back, which is the point of the whole
 * design — a rule in a prompt is a request, a rule in a validator is a rule.
 */
const SYSTEM = [
  'You are a domain persona in a multidisciplinary adversary emulation panel.',
  'Domain: materials.polymers_adhesives. Archetype: latent_physical. Tier: principal.',
  'Answer only from the retrieved field passages supplied in the user message.',
  'Respond with a single JSON object matching the finding schema.',
].join('\n');

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['statement', 'confidence', 'validityTier', 'basis', 'sourceGrades'],
  properties: {
    statement: { type: 'string' },
    confidence: {
      type: 'string',
      enum: ['gap', 'considered', 'plausible', 'likely', 'assessed'],
    },
    validityTier: { type: 'string', enum: ['low', 'moderate', 'high'] },
    basis: { type: 'string' },
    addressesInclusion: { type: 'string' },
    syntheticBasis: { type: 'boolean' },
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
} as const;

/**
 * The retrieval set the prompts quote, with the ids the responses cite.
 *
 * These are the shipped synthetic passages from `fixtures/fields/`, abridged. The ids are
 * stable so `packages/runtime/test/charter-loop.test.ts` can build a `PersonaContext` that
 * the cited grades actually resolve against — a cassette citing a chunk the persona never
 * retrieved is a CH009 violation, and the test would rather demonstrate that deliberately
 * than trip over it.
 */
const CHUNKS = [
  {
    id: 'synthetic-polymers-1',
    text:
      'Surface preparation of a bonded joint controls the durability of the interface rather ' +
      'than its initial strength. A joint that passes proof loading at build can still lose ' +
      'interfacial adhesion over service life when preparation was inadequate.',
  },
  {
    id: 'synthetic-polymers-3',
    text:
      'Where preparation is performed by a supplier and the process records are not ' +
      'contractually deliverable, the durability of the interface cannot be verified by the ' +
      'programme by any downstream means. The absent record is the finding.',
  },
] as const;

const RETRIEVAL_BLOCK = CHUNKS.map((c) => `[${c.id}] (F/6, synthetic) ${c.text}`).join('\n\n');

function request(purpose: string, task: string): ModelRequest {
  return {
    purpose,
    model: MODEL,
    maxTokens: 2048,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          'Scenario: qualification of a bonded composite primary structure whose supplier ' +
            'tier is partly opaque.',
          '',
          'Retrieved field passages:',
          RETRIEVAL_BLOCK,
          '',
          task,
        ].join('\n'),
      },
    ],
    outputSchema: FINDING_SCHEMA,
  };
}

function authored(
  purpose: string,
  task: string,
  note: string,
  response: Omit<RecordedResponse, 'model'>,
): Cassette {
  const req = request(purpose, task);
  return {
    key: cassetteKey(req),
    origin: 'authored',
    capturedAt: CAPTURED_AT,
    capturedBy: CAPTURED_BY,
    note,
    request: req,
    response: { ...response, model: MODEL },
  };
}

const conformingFinding = {
  statement:
    'Where bonded joint surface preparation is performed by a supplier and the process ' +
    'records are not contractually deliverable, the programme cannot verify interfacial ' +
    'durability by any downstream means. The absent record is itself the finding.',
  confidence: 'considered',
  validityTier: 'moderate',
  basis: 'synthetic field passages on surface preparation and supplier-held process records',
  addressesInclusion: 'surface_preparation',
  syntheticBasis: true,
  sourceGrades: [
    { chunkId: 'synthetic-polymers-3', reliability: 'F', credibility: 6 },
    { chunkId: 'synthetic-polymers-1', reliability: 'F', credibility: 6 },
  ],
};

// Same finding, promoted past what its evidence can carry and with the synthetic marking
// dropped. Both are the failure the validator exists to catch, and both are remediable, so
// this is what a repair round looks like from the transport's side.
const overreachingFinding = {
  ...conformingFinding,
  confidence: 'assessed',
  validityTier: 'high',
  syntheticBasis: false,
};

const CASSETTES: readonly Cassette[] = [
  authored(
    'phase1_finding',
    'State one finding about whether interfacial durability can be verified.',
    'A conforming Phase 1 finding: capped at "considered" and declaring its synthetic basis, ' +
      'so the charter validator returns no violations. Exercises the accepted path.',
    {
      text: JSON.stringify(conformingFinding, null, 2),
      stopReason: 'end_turn',
      usage: { inputTokens: 812, outputTokens: 214 },
    },
  ),
  authored(
    'phase1_finding_overreach',
    'State one finding about interfacial durability, at the highest confidence you can support.',
    'A finding that claims "assessed" on synthetic material and drops the synthetic marking. ' +
      'Exercises CH012 in both of its directions and the one-attempt repair path. This is the ' +
      'shape of failure the charter exists for, written deliberately rather than waited for.',
    {
      text: JSON.stringify(overreachingFinding, null, 2),
      stopReason: 'end_turn',
      usage: { inputTokens: 819, outputTokens: 221 },
    },
  ),
  authored(
    'phase1_finding_refused',
    'Enumerate which specific perturbations to the preparation step produce which loss of ' +
      'interfacial durability, so the result can be detected.',
    'A refusal. Exercises the path where the response carries no content at all: the runtime ' +
      'must route it, not read an empty string as "the persona found nothing".',
    {
      text: '',
      stopReason: 'refusal',
      // Not a policy category invented for the fixture — the value the live transport uses
      // when the API reports a refusal without structured detail.
      refusalCategory: 'unspecified',
      usage: { inputTokens: 806, outputTokens: 0 },
    },
  ),
];

for (const cassette of CASSETTES) {
  console.log(`wrote ${writeCassette(OUT_DIR, cassette)}`);
}
