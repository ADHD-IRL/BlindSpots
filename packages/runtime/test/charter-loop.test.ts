import { fileURLToPath } from 'node:url';
import {
  type FindingDraft,
  type GradedChunk,
  type PersonaContext,
  nextRepairState,
  validateFinding,
} from '@mae/core';
import { describe, expect, it } from 'vitest';
import { loadCassetteLibrary } from '../src/cassette/library.ts';
import { ModelRefusalError, assertUsable } from '../src/model/types.ts';
import { RecordedTransport } from '../src/transport/recorded.ts';

/**
 * What the transport is actually for.
 *
 * The persona runtime (M4) is a loop: build a request, call a transport, parse the response,
 * run `validateFinding`, and hand the violations to `nextRepairState`. Every part of that
 * except the call is deterministic and already built. These tests wire the recorded transport
 * into the rest of it and check the three outcomes end to end — accepted, returned for
 * repair, and refused — without a model, a key, or a network.
 *
 * What this does NOT show, stated plainly because the green tick would otherwise imply it:
 * every response below was written by a human. `provenance: 'authored'` is asserted on each
 * one for that reason. This demonstrates that the machinery handles a response of this
 * shape. It demonstrates nothing about what a model would say.
 */

const CASSETTE_DIR = fileURLToPath(new URL('../../../fixtures/cassettes', import.meta.url));
const library = loadCassetteLibrary(CASSETTE_DIR);
const transport = new RecordedTransport(library, { label: CASSETTE_DIR });

function cassetteFor(purpose: string) {
  const found = library.find((c) => c.request.purpose === purpose);
  if (found === undefined) throw new Error(`no shipped cassette for purpose ${purpose}`);
  return found;
}

/** The retrieval set the shipped cassettes quote, as it reaches the validator. */
const chunk = (id: string, text: string): GradedChunk => ({
  id,
  sourceId: 'synthetic://composite-qualification/polymers_adhesives',
  fieldId: 'materials.polymers_adhesives.synthetic',
  text,
  reliability: 'F',
  credibility: 6,
  situationTags: ['surface_preparation'],
  contentClass: 'synthetic',
});

const ctx: PersonaContext = {
  personaId: 'materials.polymers_adhesives.principal',
  domainId: 'materials.polymers_adhesives',
  archetype: 'latent_physical',
  personaClass: 'domain',
  status: 'registered',
  retrievedChunks: [
    chunk(
      'synthetic-polymers-1',
      'Surface preparation of a bonded joint controls the durability of the interface rather ' +
        'than its initial strength. A joint that passes proof loading at build can still lose ' +
        'interfacial adhesion over service life when preparation was inadequate.',
    ),
    chunk(
      'synthetic-polymers-3',
      'Where preparation is performed by a supplier and the process records are not ' +
        'contractually deliverable, the durability of the interface cannot be verified by the ' +
        'programme by any downstream means. The absent record is the finding.',
    ),
  ],
  scopeInclusions: ['adhesive_bonding', 'polymer_matrix_composites', 'surface_preparation'],
  scopeExclusions: [{ topic: 'metallic_fastening', routeTo: 'materials.metallurgy' }],
};

function parseFinding(text: string): FindingDraft {
  return { personaId: ctx.personaId, ...(JSON.parse(text) as Omit<FindingDraft, 'personaId'>) };
}

describe('the shipped cassette library', () => {
  it('loads, which means every key still matches its request', () => {
    // A cassette whose request drifted stops loading. That is the intended behaviour: it must
    // fail rather than quietly answer a prompt it was never given. Regenerate with
    // `node --experimental-strip-types packages/runtime/src/bin/author-cassettes.ts`.
    expect(library.length).toBeGreaterThan(0);
  });

  it('is entirely authored, and says so on every replay', async () => {
    for (const cassette of library) {
      expect(cassette.origin, cassette.request.purpose).toBe('authored');
      expect(cassette.note, cassette.request.purpose).toBeTruthy();
      const response = await transport.complete(cassette.request);
      expect(response.provenance, cassette.request.purpose).toBe('authored');
    }
  });

  it('replays deterministically', async () => {
    const request = cassetteFor('phase1_finding').request;
    const first = await transport.complete(request);
    const second = await transport.complete(request);
    expect(second).toEqual(first);
  });
});

describe('the charter loop over a replayed response', () => {
  it('accepts a finding that stays inside what synthetic content can carry', async () => {
    const response = assertUsable(await transport.complete(cassetteFor('phase1_finding').request));
    const finding = parseFinding(response.text);

    expect(finding.confidence).toBe('considered');
    expect(finding.syntheticBasis).toBe(true);

    const violations = validateFinding(finding, ctx);
    expect(violations).toEqual([]);
    expect(nextRepairState(violations)).toEqual({ kind: 'accepted' });
  });

  it('returns an overreaching finding for repair, on both counts', async () => {
    const response = assertUsable(
      await transport.complete(cassetteFor('phase1_finding_overreach').request),
    );
    const finding = parseFinding(response.text);

    const violations = validateFinding(finding, ctx);
    expect(violations.map((v) => v.code)).toEqual([
      'CH012_SYNTHETIC_BASIS',
      'CH012_SYNTHETIC_BASIS',
    ]);
    // Both directions of the rule: the marking was dropped, and the claim outran its basis.
    expect(violations[0]!.detail).toMatch(/must\s+declare syntheticBasis/);
    expect(violations[1]!.detail).toMatch(/cannot exceed "considered"/);

    expect(nextRepairState(violations, 0)).toMatchObject({ kind: 'awaiting_repair' });
    // One attempt, then the finding is discarded and the discard is logged. It is never
    // silently accepted, which is the whole point of the validator sitting after the call.
    expect(nextRepairState(violations, 1)).toMatchObject({
      kind: 'discarded',
      reason: 'repair_failed',
    });
  });

  it('treats a refusal as a refusal, not as an empty finding', async () => {
    const response = await transport.complete(cassetteFor('phase1_finding_refused').request);
    expect(response.text).toBe('');
    expect(() => assertUsable(response)).toThrow(ModelRefusalError);
  });

  it('would not silently pass a refusal into the validator', () => {
    // The failure this guards against: `""` parsed as an empty answer, producing a finding
    // with no statement that trips nothing and reads as a persona with nothing to say.
    expect(() => parseFinding('')).toThrow();
  });
});
