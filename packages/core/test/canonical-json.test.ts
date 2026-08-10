import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CanonicalJsonError, canonicalJson } from '../src/ledger/canonical-json.ts';

describe('canonicalJson', () => {
  it('sorts object keys', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested object keys', () => {
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: 3 })).toBe('{"a":3,"z":{"x":2,"y":1}}');
  });

  it('preserves array order, which is semantic', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('emits no insignificant whitespace', () => {
    expect(canonicalJson({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}');
  });

  it('normalizes -0 to 0 so structurally equal payloads hash alike', () => {
    expect(canonicalJson(-0)).toBe(canonicalJson(0));
  });

  it('escapes quotes, backslashes, and named control characters', () => {
    expect(canonicalJson('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
  });

  it('escapes unnamed control characters as \\u sequences', () => {
    expect(canonicalJson('\u0001\u001f')).toBe('"\\u0001\\u001f"');
  });

  it('round-trips through JSON.parse', () => {
    const value = { a: [1, 'two', null, true], b: { c: -1.5 } };
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
  });

  describe('rejects values a ledger cannot afford to coerce silently', () => {
    it.each([
      ['undefined', undefined],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['a bigint', 1n],
      ['a function', () => 0],
      ['a symbol', Symbol('s')],
      ['a Date', new Date(0)],
      ['a Map', new Map()],
    ])('%s', (_label, value) => {
      expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
    });

    it('a cycle', () => {
      const a: Record<string, unknown> = {};
      a['self'] = a;
      expect(() => canonicalJson(a)).toThrow(/Cycle detected/);
    });

    it('undefined nested in an object, naming the path', () => {
      expect(() => canonicalJson({ a: { b: undefined } })).toThrow(/at a\.b/);
    });

    it('undefined nested in an array, naming the index', () => {
      expect(() => canonicalJson([1, undefined])).toThrow(/at \[1\]/);
    });
  });

  it('permits a value that legitimately repeats without being a cycle', () => {
    const shared = { x: 1 };
    expect(canonicalJson([shared, shared])).toBe('[{"x":1},{"x":1}]');
  });

  describe('property: key order cannot change the output', () => {
    it('holds for arbitrary flat records', () => {
      fc.assert(
        fc.property(
          fc.dictionary(fc.string(), fc.oneof(fc.integer(), fc.string(), fc.boolean())),
          (record) => {
            const shuffled = Object.fromEntries(
              Object.entries(record).sort(([a], [b]) => b.localeCompare(a)),
            );
            expect(canonicalJson(shuffled)).toBe(canonicalJson(record));
          },
        ),
      );
    });

    it('holds for arbitrary nested JSON values', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (value) => {
          // Reserializing a parsed canonical form must be a fixed point.
          const once = canonicalJson(value);
          expect(canonicalJson(JSON.parse(once))).toBe(once);
        }),
      );
    });
  });
});
