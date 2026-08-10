/**
 * Deterministic JSON serialization.
 *
 * The ledger's integrity claim reduces to this function: two structurally equal payloads
 * must serialize to identical bytes, or hashes diverge for reasons that have nothing to do
 * with tampering. Object key order is therefore normalized, and every value that JSON
 * cannot round-trip faithfully is rejected rather than silently coerced.
 *
 * Shaped after RFC 8785 (JCS) for object ordering and string escaping. Number formatting
 * uses JavaScript's own shortest round-trip representation, which is sufficient here
 * because both the writer and the verifier are this same implementation.
 */

export class CanonicalJsonError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} (at ${path === '' ? '<root>' : path})`);
    this.name = 'CanonicalJsonError';
  }
}

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

/**
 * Serializes a value to its canonical form.
 *
 * @throws {CanonicalJsonError} on `undefined`, non-finite numbers, functions, symbols,
 * bigints, or a cycle. Each of these would otherwise produce output that either fails to
 * parse back or silently loses information, and a ledger cannot afford either.
 */
export function canonicalJson(value: unknown): string {
  return write(value, '', new Set());
}

function write(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`Non-finite number ${String(value)} is not serializable`, path);
      }
      // Normalize -0 to 0: they are `===` equal but format differently.
      return Object.is(value, -0) ? '0' : String(value);

    case 'string':
      return quote(value);

    case 'undefined':
      throw new CanonicalJsonError('undefined is not serializable', path);

    case 'bigint':
      throw new CanonicalJsonError('bigint is not serializable; convert to string first', path);

    case 'function':
    case 'symbol':
      throw new CanonicalJsonError(`${typeof value} is not serializable`, path);

    case 'object':
      break;
  }

  const obj = value as object;
  if (seen.has(obj)) {
    throw new CanonicalJsonError('Cycle detected', path);
  }
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const items = obj.map((item, i) => write(item, `${path}[${i}]`, seen));
      return `[${items.join(',')}]`;
    }

    if (Object.getPrototypeOf(obj) !== Object.prototype && Object.getPrototypeOf(obj) !== null) {
      throw new CanonicalJsonError(
        `Only plain objects are serializable, received ${obj.constructor?.name ?? 'unknown'}`,
        path,
      );
    }

    // Sort by UTF-16 code unit, matching RFC 8785. `Array.prototype.sort` on strings
    // already compares this way, so no collator is involved and no locale can affect it.
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const members = keys.map((key) => {
      const entry = (obj as Record<string, unknown>)[key];
      return `${quote(key)}:${write(entry, path === '' ? key : `${path}.${key}`, seen)}`;
    });
    return `{${members.join(',')}}`;
  } finally {
    seen.delete(obj);
  }
}

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

function quote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const escape = ESCAPES[ch];
    if (escape !== undefined) {
      out += escape;
    } else if (ch < ' ') {
      out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
}
