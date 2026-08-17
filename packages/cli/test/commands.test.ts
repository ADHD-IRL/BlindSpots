import { fileURLToPath } from 'node:url';
import { loadCassetteLibrary } from '@mae/runtime';
import { describe, expect, it } from 'vitest';
import { renderCassetteLibrary } from '../src/commands.ts';

const CASSETTE_DIR = fileURLToPath(new URL('../../../fixtures/cassettes', import.meta.url));

describe('cassette:list', () => {
  const cassettes = loadCassetteLibrary(CASSETTE_DIR);
  const rendered = renderCassetteLibrary(CASSETTE_DIR, cassettes);

  it('reports how many cassettes were found, and where', () => {
    expect(rendered).toContain(`${cassettes.length} cassette(s) in ${CASSETTE_DIR}`);
  });

  it('shows every cassette with its origin and the provenance it replays as', () => {
    for (const cassette of cassettes) {
      expect(rendered).toContain(cassette.request.purpose);
      expect(rendered).toContain(cassette.key.slice(0, 12));
    }
    expect(rendered).toContain('authored -> replays as authored');
  });

  it('surfaces the note, which is the only thing distinguishing an invention from a capture', () => {
    for (const cassette of cassettes) {
      if (cassette.note !== undefined) expect(rendered).toContain(cassette.note);
    }
  });

  it('warns about authored content, in proportion to how much of it there is', () => {
    const authored = cassettes.filter((c) => c.origin === 'authored').length;
    expect(rendered).toContain(`${authored} of these are AUTHORED`);
    expect(rendered).toMatch(/shows nothing whatever about what a model would say/);
  });

  it('says nothing about authored content when there is none', () => {
    // The warning has to be earned or it becomes furniture people stop reading.
    const recordedOnly = cassettes
      .slice(0, 1)
      .map((c) => ({ ...c, origin: 'recorded' as const }));
    const output = renderCassetteLibrary('somewhere', recordedOnly);
    expect(output).not.toContain('AUTHORED');
    expect(output).toContain('recorded -> replays as replayed');
  });

  it('renders an empty library without claiming anything about it', () => {
    const output = renderCassetteLibrary('somewhere', []);
    expect(output).toContain('0 cassette(s) in somewhere');
    expect(output).not.toContain('AUTHORED');
  });
});
