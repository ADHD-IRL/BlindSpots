import { describe, expect, it } from 'vitest';
import { RawHtml, document, escapeHtml, html, raw } from '../src/render/html.ts';

describe('escaping', () => {
  it.each([
    ['<script>', '&lt;script&gt;'],
    ['a & b', 'a &amp; b'],
    ['"quoted"', '&quot;quoted&quot;'],
    ["it's", 'it&#39;s'],
  ])('escapes %s', (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });

  it('escapes interpolated values by default', () => {
    // Scenario subjects, approver names and field passages are all text somebody else
    // wrote, and all of it lands in a page a reviewer reads. Escaping is the default so
    // that forgetting it is not possible; opting out requires naming `raw`.
    const subject = '<img src=x onerror="alert(1)">';
    expect(html`<h1>${subject}</h1>`.value).toBe(
      '<h1>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</h1>',
    );
  });

  it('escapes inside attribute values too', () => {
    const evil = '" onmouseover="steal()';
    const out = html`<a title="${evil}">x</a>`.value;
    expect(out).toContain('&quot; onmouseover=&quot;steal()');
    expect(out).not.toMatch(/onmouseover="steal/);
  });

  it('passes RawHtml through untouched', () => {
    expect(html`<p>${raw('<b>bold</b>')}</p>`.value).toBe('<p><b>bold</b></p>');
  });

  it('composes nested templates without double-escaping', () => {
    const inner = html`<em>${'a & b'}</em>`;
    expect(html`<p>${inner}</p>`.value).toBe('<p><em>a &amp; b</em></p>');
  });

  it('joins arrays, escaping each element', () => {
    expect(html`${['<a>', '<b>']}`.value).toBe('&lt;a&gt;&lt;b&gt;');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['false', false],
  ])('renders %s as nothing, so conditionals read cleanly', (_name, value) => {
    expect(html`<p>${value}</p>`.value).toBe('<p></p>');
  });

  it('renders numbers and zero', () => {
    // `false` is blank but `0` must not be: a panel with 0 distinct models is exactly the
    // case the correlation disclosure exists to report.
    expect(html`${0}`.value).toBe('0');
  });

  it('cannot be produced by a plain string masquerading as RawHtml', () => {
    const fake = { value: '<script>x</script>', toString: () => '<script>x</script>' };
    expect(html`${fake}`.value).not.toContain('<script>');
    expect(new RawHtml('<b>').value).toBe('<b>');
  });
});

describe('the document shell', () => {
  const page = document('Panels', html`<h1>Hi</h1>`);

  it('is a complete html document', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<html lang="en">');
    expect(page).toContain('<h1>Hi</h1>');
  });

  it('escapes the title', () => {
    expect(document('<script>', html``)).toContain('<title>&lt;script&gt;');
  });

  it('carries no script and no external asset', () => {
    // The pages are self-contained by construction; the CSP the server sends says so, and
    // this is the test that keeps the claim true.
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/src=|href="http/i);
  });
});
