import { describe, expect, it } from 'vitest';
import { computeHash } from '../src/ledger/hash.ts';
import { GENESIS_PREV_HASH, type StoredLedgerEntry } from '../src/ledger/types.ts';
import { linkEntry, verifyChain } from '../src/ledger/verify.ts';

const EVENT = '11111111-1111-4111-8111-111111111111';

/** Builds a well-formed chain of `n` entries spanning a phase transition. */
function buildChain(n: number): StoredLedgerEntry[] {
  const out: StoredLedgerEntry[] = [];
  let prevHash = GENESIS_PREV_HASH;
  for (let i = 0; i < n; i++) {
    const linked = linkEntry(
      {
        eventId: EVENT,
        phase: i < n / 2 ? 1 : 2,
        actor: `materials.metallurgy.principal`,
        kind: 'persona_output',
        payload: { index: i, statement: `finding ${i}` },
      },
      prevHash,
      i + 1,
    );
    out.push(linked);
    prevHash = linked.hash;
  }
  return out;
}

describe('verifyChain', () => {
  it('accepts an empty chain', () => {
    expect(verifyChain([])).toEqual({ ok: true });
  });

  it('accepts a well-formed chain', () => {
    expect(verifyChain(buildChain(20))).toEqual({ ok: true });
  });

  it('requires the first entry to point at genesis', () => {
    const chain = buildChain(3);
    const [head, ...rest] = chain;
    const tampered = [{ ...head!, prevHash: 'f'.repeat(64) }, ...rest];

    const result = verifyChain(tampered);
    expect(result).toMatchObject({ ok: false, firstDivergence: { seq: 1, reason: 'genesis_prev_hash' } });
  });

  it('detects a mutated payload mid-chain and names the exact seq', () => {
    // The canonical tamper case: someone edits a finding after the fact. The entry's own
    // recorded hash no longer matches what its contents produce.
    const chain = buildChain(20);
    const target = 11;
    chain[target - 1] = {
      ...chain[target - 1]!,
      payload: { index: target - 1, statement: 'a materially different finding' },
    };

    const result = verifyChain(chain);
    expect(result).toMatchObject({ ok: false, firstDivergence: { seq: target, reason: 'hash_mismatch' } });
  });

  it.each([
    ['actor', { actor: 'materials.metallurgy.journeyman' }],
    ['kind', { kind: 'gap_declaration' as const }],
    ['phase', { phase: 6 }],
  ])('detects a mutated %s', (_field, patch) => {
    const chain = buildChain(6);
    chain[3] = { ...chain[3]!, ...patch };

    expect(verifyChain(chain)).toMatchObject({
      ok: false,
      firstDivergence: { seq: 4, reason: 'hash_mismatch' },
    });
  });

  it('detects a reordered chain', () => {
    const chain = buildChain(6);
    const swapped = [...chain];
    [swapped[2], swapped[3]] = [swapped[3]!, swapped[2]!];

    // seq still increases across the swap (1, 2, 4, 3 is caught only at the fourth entry),
    // so it is the prev_hash walk that catches this at seq 4 — the entry now sitting where
    // its recorded predecessor is not.
    expect(verifyChain(swapped)).toMatchObject({
      ok: false,
      firstDivergence: { seq: 4, reason: 'prev_hash_mismatch' },
    });
  });

  it('detects a chain whose seq runs backwards', () => {
    const chain = buildChain(4);
    chain[2] = { ...chain[2]!, seq: 1 };

    expect(verifyChain(chain)).toMatchObject({
      ok: false,
      firstDivergence: { seq: 1, reason: 'seq_not_increasing' },
    });
  });

  it('detects an excised entry', () => {
    // `seq` is allocated globally, so a gap in it is normal and proves nothing. Excision is
    // caught by the prev_hash walk: entry 4 points at a predecessor no longer present.
    const chain = buildChain(6);
    chain.splice(2, 1);

    expect(verifyChain(chain)).toMatchObject({
      ok: false,
      firstDivergence: { seq: 4, reason: 'prev_hash_mismatch' },
    });
  });

  it('accepts an event whose seq values are non-contiguous', () => {
    // The realistic case: two events interleave and each takes every other seq.
    const chain = buildChain(4).map((e, i) => ({ ...e, seq: (i + 1) * 2 }));
    expect(verifyChain(chain)).toEqual({ ok: true });
  });

  it('detects a prev_hash rewrite that preserves seq ordering', () => {
    const chain = buildChain(6);
    // Re-point entry 4 at entry 2, then re-hash it so its own hash is self-consistent.
    // Only the prev_hash walk catches this.
    const rewritten = { ...chain[3]!, prevHash: chain[1]!.hash };
    chain[3] = { ...rewritten, hash: computeHash(rewritten, rewritten.prevHash) };

    expect(verifyChain(chain)).toMatchObject({
      ok: false,
      firstDivergence: { seq: 4, reason: 'prev_hash_mismatch' },
    });
  });

  it('detects a duplicated entry', () => {
    // Two identical entries in a row: the second's prevHash would have to equal the first's
    // hash, which a replay cannot satisfy, so this surfaces before the duplicate check.
    const chain = buildChain(4);
    const dup = { ...chain[1]!, seq: 3 };
    chain[2] = dup;

    expect(verifyChain(chain).ok).toBe(false);
  });

  it('reports the FIRST divergence when a chain is damaged in several places', () => {
    const chain = buildChain(10);
    chain[7] = { ...chain[7]!, actor: 'tampered.late' };
    chain[3] = { ...chain[3]!, actor: 'tampered.early' };

    expect(verifyChain(chain)).toMatchObject({ ok: false, firstDivergence: { seq: 4 } });
  });
});

describe('computeHash', () => {
  it('is deterministic across key ordering in the payload', () => {
    const base = { eventId: EVENT, phase: 1, actor: 'a', kind: 'persona_output' as const };
    const a = computeHash({ ...base, payload: { x: 1, y: 2 } }, GENESIS_PREV_HASH);
    const b = computeHash({ ...base, payload: { y: 2, x: 1 } }, GENESIS_PREV_HASH);
    expect(a).toBe(b);
  });

  it('separates fields so content cannot shift across a boundary undetected', () => {
    // The invariant: no two distinct field decompositions share a preimage. An actor that
    // embeds the separator must not be able to impersonate a different field layout.
    const base = { eventId: EVENT, phase: 1, kind: 'persona_output' as const, payload: {} };
    const a = computeHash({ ...base, actor: 'ab' }, GENESIS_PREV_HASH);
    const b = computeHash({ ...base, actor: 'a\u001fb' }, GENESIS_PREV_HASH);
    expect(a).not.toBe(b);
  });

  it('produces a 64-character hex digest', () => {
    const hash = computeHash(
      { eventId: EVENT, phase: 0, actor: 'system', kind: 'phase_transition', payload: null },
      GENESIS_PREV_HASH,
    );
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
