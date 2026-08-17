/**
 * HTML construction, escaped by default.
 *
 * Everything this UI renders is attacker-reachable in the only sense that matters here:
 * scenario subjects, approver names, field passages and model output are all text somebody
 * else wrote, and all of it ends up in a page a reviewer reads. So interpolation escapes
 * unless the caller explicitly says otherwise, rather than the other way round. A helper
 * that escapes on request is a helper that will be forgotten exactly once.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/**
 * Markup that has already been escaped, or was never user input.
 *
 * A class rather than a branded string so it cannot be produced by accident: passing a
 * plain string to `html` escapes it, and the only way to opt out is to name `raw`.
 */
export class RawHtml {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

/** Opt out of escaping. Every call site is a place to check by hand. */
export function raw(value: string): RawHtml {
  return new RawHtml(value);
}

function interpolate(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof RawHtml) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join('');
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += interpolate(values[i]) + (strings[i + 1] ?? '');
  }
  return new RawHtml(out);
}

/** Renders a document to the string that goes on the wire. */
export function document(title: string, body: RawHtml): string {
  return `<!doctype html>\n${html`<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} — MAE panel engine</title>
    <style>${raw(STYLES)}</style>
  </head>
  <body>
    <header class="masthead">
      <a class="wordmark" href="/">MAE panel engine</a>
      <nav>
        <a href="/">Panels</a>
        <a href="/fields">Fields</a>
        <a href="/cassettes">Cassettes</a>
      </nav>
    </header>
    <main>${body}</main>
  </body>
</html>`.value}\n`;
}

/**
 * No build step, no external assets, no script.
 *
 * The forms here change signed, ledger-recorded state, and this is a tool for reading
 * evidence. Both are better served by a page that works with scripting off than by anything
 * a bundler would buy.
 */
const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #fbfbfa; --fg: #1a1a18; --muted: #6b6b64; --line: #d8d8d2;
  --card: #ffffff; --accent: #2b5f8a; --warn-bg: #fdf6e3; --warn-line: #d9c48a;
  --stop-bg: #fbeceb; --stop-line: #d99a94;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16161a; --fg: #e6e6e1; --muted: #9a9a92; --line: #33333a;
    --card: #1d1d22; --accent: #7fb0d8; --warn-bg: #2c2718; --warn-line: #6b5c2e;
    --stop-bg: #2e1c1a; --stop-line: #7a3f38;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { max-width: 68rem; margin: 0 auto; padding: 1.5rem 1.25rem 5rem; }
.masthead {
  display: flex; gap: 1.5rem; align-items: baseline; flex-wrap: wrap;
  padding: .85rem 1.25rem; border-bottom: 1px solid var(--line); background: var(--card);
}
.wordmark { font-weight: 650; letter-spacing: -.01em; text-decoration: none; color: var(--fg); }
nav { display: flex; gap: 1rem; }
a { color: var(--accent); }
h1 { font-size: 1.4rem; margin: 1.2rem 0 .3rem; letter-spacing: -.01em; }
h2 { font-size: 1.05rem; margin: 2rem 0 .6rem; letter-spacing: -.005em; }
h2 .cite { font-weight: 400; color: var(--muted); font-size: .85rem; margin-left: .4rem; }
p.lede { color: var(--muted); margin: .2rem 0 1rem; }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
.scroll { overflow-x: auto; }
th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; }
code, .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .86em; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1.1rem; margin: .8rem 0; }
.note { background: var(--warn-bg); border: 1px solid var(--warn-line); border-radius: 8px; padding: .8rem 1rem; margin: .8rem 0; }
.stop { background: var(--stop-bg); border: 1px solid var(--stop-line); border-radius: 8px; padding: .8rem 1rem; margin: .8rem 0; }
.tag {
  display: inline-block; padding: .08rem .4rem; border: 1px solid var(--line);
  border-radius: 4px; font-size: .74rem; letter-spacing: .03em; color: var(--muted);
  text-transform: uppercase; white-space: nowrap;
}
.tag.alert { border-color: var(--stop-line); color: inherit; background: var(--stop-bg); }
.tag.hold { border-color: var(--warn-line); color: inherit; background: var(--warn-bg); }
form.signoff { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; margin-top: .6rem; }
input[type=text] {
  flex: 1 1 16rem; padding: .45rem .6rem; border: 1px solid var(--line);
  border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit;
}
button {
  padding: .45rem .9rem; border: 1px solid var(--accent); border-radius: 6px;
  background: var(--accent); color: var(--card); font: inherit; cursor: pointer;
}
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: .3rem .9rem; margin: 0; }
dl.facts dt { color: var(--muted); font-size: .82rem; }
dl.facts dd { margin: 0; }
.empty { color: var(--muted); font-style: italic; padding: 1rem 0; }
`;
