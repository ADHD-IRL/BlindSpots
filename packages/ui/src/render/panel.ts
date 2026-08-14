import type { Scenario } from '@mae/core';
import type { PanelSummary, PersistedPanel } from '@mae/store';
import { type RawHtml, html } from './html.ts';

export function renderPanelIndex(panels: readonly PanelSummary[]): RawHtml {
  if (panels.length === 0) {
    return html`
      <h1>Panels</h1>
      <p class="empty">
        No panel has been convened. Open one with
        <code>pnpm cli panel:propose --scenario &lt;path&gt; --persist --models &lt;a,b&gt;</code>.
      </p>
    `;
  }

  return html`
    <h1>Panels</h1>
    <p class="lede">
      Both signatures are required before any persona runs. They are separate decisions and
      neither substitutes for the other.
    </p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>Subject</th><th>Stage</th><th>Members</th>
            <th>Scenario framing</th><th>Panel composition</th><th>Phase</th>
          </tr>
        </thead>
        <tbody>
          ${panels.map(
            (p) => html`
              <tr>
                <td><a href="/panel/${p.panelId}">${p.subject}</a></td>
                <td>${p.lifecycleStage}</td>
                <td>${p.memberCount}</td>
                <td>${signatureCell(p.scenarioApprovedBy)}</td>
                <td>${signatureCell(p.panelApprovedBy)}</td>
                <td>${p.phase === null ? html`<span class="tag">no event</span>` : p.phase}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

function signatureCell(approvedBy: string | null): RawHtml {
  return approvedBy === null
    ? html`<span class="tag hold">unsigned</span>`
    : html`<span class="mono">${approvedBy}</span>`;
}

/**
 * Signing something already signed.
 *
 * Not a server error — it is the freeze rule refusing, and it is reachable honestly: two
 * operators can open the same panel and both press the button. A stack trace would read as
 * a broken tool and invite a retry; this says what happened and who holds the signature.
 */
export function renderApprovalConflict(kind: 'scenario' | 'panel', detail: string): RawHtml {
  return html`
    <h1>Already signed</h1>
    <div class="stop">
      <p>
        The ${kind === 'scenario' ? 'scenario framing' : 'panel composition'} carries a
        signature already, and approval is write-once.
      </p>
      <p class="mono">${detail}</p>
    </div>
    <p class="lede">
      This is the freeze working, not a failure. The composition <em>is</em> the charter that
      every downstream finding traces back to, so a signature that could be overwritten would
      make the trace unverifiable. Convene a new panel if the composition needs to change.
    </p>
    <p><a href="/">Back to panels</a></p>
  `;
}

export function renderPanel(
  panel: PersistedPanel,
  scenario: Scenario,
  flash?: string,
): RawHtml {
  const bothSigned = panel.scenarioApprovedBy !== null && panel.panelApprovedBy !== null;

  return html`
    <h1>${scenario.subject}</h1>
    <p class="lede">${scenario.lifecycleStage} · ${scenario.missionFunction}</p>

    ${flash === undefined ? '' : html`<div class="note">${flash}</div>`}

    <div class="card">
      <dl class="facts">
        <dt>Informing decision</dt><dd>${scenario.informingDecision}</dd>
        <dt>Consequence classes</dt><dd>${scenario.consequenceClasses.join(', ')}</dd>
        <dt>Subject characteristics</dt>
        <dd>${(scenario.subjectCharacteristics ?? []).join(', ') || '—'}</dd>
        <dt>Panel</dt><dd class="mono">${panel.panelId}</dd>
        <dt>Event</dt>
        <dd class="mono">
          ${panel.eventId === null
            ? '—'
            : html`<a href="/event/${panel.eventId}/ledger">${panel.eventId}</a>`}
        </dd>
      </dl>
    </div>

    ${renderApproval(panel, bothSigned)}
    ${renderMembers(panel)}
    ${renderCorrelation(panel)}
  `;
}

/**
 * The §B.11 gate.
 *
 * Two forms, never one. Scenario authorship and panel composition approval are listed as
 * two separate non-delegable decisions, so a single "approve" control would be a interface
 * that quietly merged them. Each requires a typed name because accountability attaches to a
 * named human, and neither is offered again once given: an approved panel freezes, enforced
 * by a database trigger, and a form that implied otherwise would be lying about the system.
 */
function renderApproval(panel: PersistedPanel, bothSigned: boolean): RawHtml {
  return html`
    <h2>Approval <span class="cite">Appendix B §B.11</span></h2>

    ${bothSigned
      ? html`
          <div class="card">
            <p>
              Signed off by
              <span class="mono">${panel.scenarioApprovedBy}</span> (framing) and
              <span class="mono">${panel.panelApprovedBy}</span> (composition).
            </p>
            <p class="lede">
              The composition is now frozen. Membership cannot be edited and the signatures
              cannot be rewritten — the composition <em>is</em> the charter every downstream
              finding traces to, and editing it after signature would break that trace.
            </p>
          </div>
        `
      : html`
          <div class="stop">
            <strong>This panel is not approved. No persona may run.</strong>
            <p class="lede">
              Both signatures are required and they are separate decisions. One does not
              satisfy the other.
            </p>
          </div>
        `}

    ${signoffBlock(
      'Scenario framing',
      `/scenario/${panel.scenarioId}/approve`,
      panel.scenarioApprovedBy,
      'Who is accountable for the framing — the subject, the decision it informs, and what was left out.',
    )}
    ${signoffBlock(
      'Panel composition',
      `/panel/${panel.panelId}/approve`,
      panel.panelApprovedBy,
      'Who is accountable for which domains were convened, at what depth, and which were not.',
    )}
  `;
}

function signoffBlock(
  label: string,
  action: string,
  approvedBy: string | null,
  explanation: string,
): RawHtml {
  return html`
    <div class="card">
      <strong>${label}</strong>
      <p class="lede">${explanation}</p>
      ${approvedBy === null
        ? html`
            <form class="signoff" method="post" action="${action}">
              <input
                type="text"
                name="by"
                required
                placeholder="human:name"
                aria-label="${label} — approver name"
              />
              <button type="submit">Sign off</button>
            </form>
          `
        : html`<p>Signed by <span class="mono">${approvedBy}</span>.</p>`}
    </div>
  `;
}

function renderMembers(panel: PersistedPanel): RawHtml {
  return html`
    <h2>Members <span class="cite">§B.4, §B.5</span></h2>
    <div class="scroll">
      <table>
        <thead>
          <tr><th>Persona</th><th>Depth</th><th>Class</th><th>Model</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${panel.members.map(
            (m) => html`
              <tr>
                <td class="mono">${m.personaId}</td>
                <td>${m.depth}</td>
                <td>${m.personaClass}</td>
                <td class="mono">${m.modelId}</td>
                <td>
                  ${m.provisional
                    ? html`<span class="tag hold">provisional</span>`
                    : html`<span class="tag">registered</span>`}
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * The disclosure is printed verbatim.
 *
 * §E.4.3's requirement is that an unmeasured correlation is *stated* as unmeasured rather
 * than defaulted to zero. Summarising the sentence into a badge would undo that, so the
 * sentence the store composed is what appears.
 */
function renderCorrelation(panel: PersistedPanel): RawHtml {
  return html`
    <h2>Correlation disclosure <span class="cite">Appendix E §E.4.3</span></h2>
    <div class="card">
      <p>${panel.correlation.statement}</p>
      <dl class="facts">
        <dt>Nominal panel size</dt><dd>${panel.correlation.nominalCount}</dd>
        <dt>Distinct models</dt><dd>${panel.correlation.distinctModels}</dd>
      </dl>
    </div>
    ${panel.correlation.challengerIndependenceSatisfiable
      ? ''
      : html`
          <div class="note">
            <strong>Challenger independence is not satisfiable by this panel.</strong>
            <p class="lede">
              §B.9 requires that a Challenger not share a base model with the persona it
              attacks. Every member here runs on the same model, so that requirement cannot
              be met by any assignment — it is a property of the roster, not a runtime detail.
            </p>
          </div>
        `}
  `;
}
