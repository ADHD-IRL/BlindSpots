import {
  CREDIBILITY_MEANING,
  RELIABILITY_MEANING,
  type StoredLedgerEntry,
  type VerifyResult,
} from '@mae/core';
import type { Cassette } from '@mae/runtime';
import { PROVENANCE_BY_ORIGIN } from '@mae/runtime';
import { type RawHtml, html } from './html.ts';

/**
 * The ledger view.
 *
 * This is the affordance Chapter Twenty-One actually leans on: a non-specialist validator
 * cannot evaluate metallurgy, but can check whether Phase 1 outputs existed before Phase 2
 * opened. So the verification result leads, and a divergence names the exact `seq` rather
 * than reporting that something, somewhere, is wrong.
 */
export function renderLedger(
  eventId: string,
  entries: readonly StoredLedgerEntry[],
  result: VerifyResult,
): RawHtml {
  return html`
    <h1>Ledger</h1>
    <p class="lede mono">event ${eventId}</p>

    ${result.ok
      ? html`
          <div class="card">
            <strong>Chain verifies clean across ${entries.length} entr${
              entries.length === 1 ? 'y' : 'ies'
            }.</strong>
            <p class="lede">
              Every entry's hash covers its predecessor, so the order shown is the order
              things happened in and no entry has been altered, removed, or moved here from
              another event.
            </p>
          </div>
        `
      : html`
          <div class="stop">
            <strong>Chain DIVERGES at seq ${result.firstDivergence.seq}
              — ${result.firstDivergence.reason}.</strong>
            <p>${result.firstDivergence.detail}</p>
          </div>
        `}

    <div class="scroll">
      <table>
        <thead>
          <tr><th>Seq</th><th>Phase</th><th>Kind</th><th>Actor</th><th>Hash</th></tr>
        </thead>
        <tbody>
          ${entries.map(
            (e) => html`
              <tr>
                <td class="mono">${e.seq}</td>
                <td>${e.phase}</td>
                <td>${e.kind}</td>
                <td class="mono">${e.actor}</td>
                <td class="mono" title="${e.hash}">${e.hash.slice(0, 12)}…</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
    ${entries.length === 0 ? html`<p class="empty">No entries for this event.</p>` : ''}
  `;
}

export interface FieldSourceRow {
  readonly fieldId: string;
  readonly uri: string;
  readonly reliability: keyof typeof RELIABILITY_MEANING;
  readonly contentClass: string;
  readonly gradedBy: string;
  readonly chunkCount: number;
}

/**
 * Sources with both Admiralty axes, kept apart.
 *
 * §E.2.2: "Collapsing the two into a single confidence figure destroys the distinction and
 * is the most common error in practice." So there is no combined column, no score, and no
 * colour ramp — a ramp is a scalar drawn in another notation, and B2 and D2 differ in a way
 * no single number preserves. The two columns carry their meanings in words instead.
 */
export function renderFields(rows: readonly FieldSourceRow[]): RawHtml {
  const synthetic = rows.filter((r) => r.contentClass === 'synthetic').length;

  return html`
    <h1>Field sources</h1>
    <p class="lede">
      Source reliability and information credibility are independent axes and are never
      combined here. A completely reliable source can report something doubtful; an
      unreliable one can report something independently confirmed.
      <span class="cite">Appendix E §E.2.2</span>
    </p>

    ${synthetic === 0
      ? ''
      : html`
          <div class="note">
            <strong>${synthetic} of ${rows.length} source(s) are SYNTHETIC.</strong>
            <p class="lede">
              Invented to exercise the engine, not curated expertise. They carry F/6 —
              "cannot be judged" on both axes — and charter rule CH012 caps any finding drawn
              from them at "considered" and requires it to declare a synthetic basis.
            </p>
          </div>
        `}

    ${rows.length === 0
      ? html`<p class="empty">No field sources ingested.</p>`
      : html`
          <div class="scroll">
            <table>
              <thead>
                <tr>
                  <th>Field</th><th>Source</th><th>Reliability</th>
                  <th>Class</th><th>Graded by</th><th>Chunks</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(
                  (r) => html`
                    <tr>
                      <td class="mono">${r.fieldId}</td>
                      <td class="mono">${r.uri}</td>
                      <td>
                        <strong>${r.reliability}</strong>
                        <span class="lede"> ${RELIABILITY_MEANING[r.reliability]}</span>
                      </td>
                      <td>
                        ${r.contentClass === 'synthetic'
                          ? html`<span class="tag alert">synthetic</span>`
                          : html`<span class="tag">curated</span>`}
                      </td>
                      <td class="mono">${r.gradedBy}</td>
                      <td>${r.chunkCount}</td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </div>
          <p class="lede">
            Credibility is graded per chunk, not per source, and is shown with the chunk:
            ${creditLegend()}
          </p>
        `}
  `;
}

function creditLegend(): RawHtml {
  return html`${Object.entries(CREDIBILITY_MEANING).map(
    ([grade, meaning]) => html`<span class="tag">${grade} ${meaning}</span> `,
  )}`;
}

/**
 * Cassette provenance.
 *
 * The column that matters is the last one. `authored` means no model produced that text,
 * and a reviewer reading a finding derived from one is reading something that has never
 * been near a model.
 */
export function renderCassettes(dir: string, cassettes: readonly Cassette[]): RawHtml {
  const authored = cassettes.filter((c) => c.origin === 'authored').length;

  return html`
    <h1>Model cassettes</h1>
    <p class="lede mono">${dir}</p>

    ${authored === 0
      ? ''
      : html`
          <div class="note">
            <strong>${authored} of ${cassettes.length} cassette(s) are AUTHORED.</strong>
            <p class="lede">
              A person wrote those responses so the runtime could be exercised without
              credentials. Replaying them shows the machinery works and shows nothing
              whatever about what a model would say.
            </p>
          </div>
        `}

    ${cassettes.length === 0
      ? html`<p class="empty">No cassettes.</p>`
      : html`
          <div class="scroll">
            <table>
              <thead>
                <tr>
                  <th>Purpose</th><th>Model</th><th>Stop</th>
                  <th>Captured by</th><th>Origin</th><th>Replays as</th>
                </tr>
              </thead>
              <tbody>
                ${cassettes.map(
                  (c) => html`
                    <tr>
                      <td>
                        <span class="mono">${c.request.purpose}</span>
                        ${c.note === undefined ? '' : html`<p class="lede">${c.note}</p>`}
                      </td>
                      <td class="mono">${c.request.model}</td>
                      <td>${c.response.stopReason}</td>
                      <td class="mono">${c.capturedBy}</td>
                      <td>
                        ${c.origin === 'authored'
                          ? html`<span class="tag alert">authored</span>`
                          : html`<span class="tag">recorded</span>`}
                      </td>
                      <td class="mono">${PROVENANCE_BY_ORIGIN[c.origin]}</td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </div>
        `}
  `;
}
