import type { StoredLedgerEntry } from '@mae/core';
import type { Cassette } from '@mae/runtime';
import { describe, expect, it } from 'vitest';
import { type FieldSourceRow, renderCassettes, renderFields, renderLedger } from '../src/render/audit.ts';

/**
 * Rendered prose wraps across source lines, so assertions about what a page *says* run
 * against its text content rather than its markup. Assertions about structure stay on the
 * markup, where they belong.
 */
function text(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const entry = (seq: number): StoredLedgerEntry => ({
  seq,
  eventId: '22222222-2222-2222-2222-222222222222',
  phase: 0,
  actor: 'system:convener',
  kind: 'panel_proposal',
  payload: { slots: [] },
  prevHash: '0'.repeat(64),
  hash: 'a'.repeat(64),
});

describe('the ledger view', () => {
  it('leads with a clean verification', () => {
    const out = text(renderLedger('e', [entry(1), entry(2)], { ok: true }).value);
    expect(out).toContain('verifies clean across 2 entries');
  });

  it('names the exact seq on divergence', () => {
    // A non-specialist validator cannot evaluate metallurgy but can check ordering, so a
    // divergence has to say where, not that something somewhere is wrong.
    const out = renderLedger('e', [entry(1)], {
      ok: false,
      firstDivergence: { seq: 7, reason: 'prev_hash_mismatch', detail: 'expected abc, found def' },
    }).value;
    expect(text(out)).toContain('DIVERGES at seq 7');
    expect(out).toContain('prev_hash_mismatch');
    expect(out).toContain('expected abc, found def');
  });

  it('handles an empty chain without claiming it verified something', () => {
    const out = renderLedger('e', [], { ok: true }).value;
    expect(out).toContain('No entries for this event');
  });
});

describe('the field sources view', () => {
  const row = (overrides: Partial<FieldSourceRow> = {}): FieldSourceRow => ({
    fieldId: 'materials.polymers_adhesives',
    uri: 'file://spec.pdf',
    reliability: 'B',
    contentClass: 'curated',
    gradedBy: 'human:curator',
    chunkCount: 4,
    ...overrides,
  });

  it('never combines the two Admiralty axes into one figure', () => {
    // §E.2.2: collapsing them destroys the distinction and is the most common error in
    // practice. Tested structurally rather than by scanning prose — the page's own
    // explanation contains the word "combined", and an assertion that trips on the
    // disclaimer would be checking the wrong thing.
    const out = renderFields([row({ reliability: 'B' })]).value;
    const headers = [...out.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]!.trim());

    expect(headers).toContain('Reliability');
    expect(headers).not.toContain('Grade');
    expect(headers).not.toContain('Score');
    expect(headers).not.toContain('Confidence');
    // No cell renders the two axes fused into one token, which is how B2 usually appears.
    expect(out).not.toMatch(/>\s*[A-F][1-6]\s*</);
    expect(out).toContain('usually reliable');
  });

  it('carries the reliability meaning in words, not just a letter', () => {
    expect(renderFields([row({ reliability: 'F' })]).value).toContain('cannot be judged');
  });

  it('warns in proportion to how much synthetic content there is', () => {
    const out = text(renderFields([row(), row({ contentClass: 'synthetic', reliability: 'F' })]).value);
    expect(out).toContain('1 of 2 source(s) are SYNTHETIC');
    expect(out).toContain('CH012');
  });

  it('says nothing about synthetic content when there is none', () => {
    expect(renderFields([row()]).value).not.toContain('SYNTHETIC');
  });

  it('handles an empty corpus', () => {
    expect(renderFields([]).value).toContain('No field sources ingested');
  });
});

describe('the cassette view', () => {
  const cassette = (origin: Cassette['origin']): Cassette => ({
    key: 'f'.repeat(64),
    origin,
    capturedAt: '2026-08-11T00:00:00.000Z',
    capturedBy: 'system:authored_fixture',
    ...(origin === 'authored' ? { note: 'exercises the accepted path' } : {}),
    request: {
      purpose: 'phase1_finding',
      model: 'claude-opus-5',
      maxTokens: 2048,
      system: 's',
      messages: [{ role: 'user', content: 'm' }],
    },
    response: {
      text: '{}',
      stopReason: 'end_turn',
      model: 'claude-opus-5',
      usage: { inputTokens: 1, outputTokens: 1 },
    },
  });

  it('shows what each cassette replays as', () => {
    expect(renderCassettes('d', [cassette('authored')]).value).toContain('authored');
    expect(renderCassettes('d', [cassette('recorded')]).value).toContain('replayed');
  });

  it('warns that authored content never came from a model', () => {
    const out = text(renderCassettes('d', [cassette('authored')]).value);
    expect(out).toContain('1 of 1 cassette(s) are AUTHORED');
    expect(out).toContain('shows nothing whatever about what a model would say');
  });

  it('does not warn about a library of real recordings', () => {
    expect(renderCassettes('d', [cassette('recorded')]).value).not.toContain('AUTHORED');
  });

  it('surfaces the note that distinguishes an invention from a capture', () => {
    expect(renderCassettes('d', [cassette('authored')]).value).toContain(
      'exercises the accepted path',
    );
  });
});
