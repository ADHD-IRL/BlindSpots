import type { Scenario } from '@mae/core';
import type { PersistedPanel } from '@mae/store';
import { describe, expect, it } from 'vitest';
import { renderApprovalConflict, renderPanel, renderPanelIndex } from '../src/render/panel.ts';

const scenario: Scenario = {
  id: '11111111-1111-1111-1111-111111111111',
  subject: 'Bonded composite primary structure qualification',
  lifecycleStage: 'qualification',
  missionFunction: 'primary load path',
  consequenceClasses: ['physical_failure_in_service'],
  informingDecision: 'qualification sign-off',
  subjectCharacteristics: ['bonded_primary_structure', 'composite_material'],
  adversarySet: ['supply_chain_insertion'],
  classification: 'unclassified',
  exclusions: [],
  authoredBy: 'human:sponsor',
};

function panel(overrides: Partial<PersistedPanel> = {}): PersistedPanel {
  return {
    eventId: '22222222-2222-2222-2222-222222222222',
    panelId: '33333333-3333-3333-3333-333333333333',
    scenarioId: scenario.id,
    scenarioApprovedBy: null,
    panelApprovedBy: null,
    members: [
      {
        personaId: 'materials.polymers_adhesives.principal',
        domainId: 'materials.polymers_adhesives',
        depth: 'full',
        personaClass: 'domain',
        modelId: 'claude-opus-5',
        provisional: false,
      },
    ],
    correlation: {
      nominalCount: 1,
      distinctModels: 1,
      rho: { kind: 'unmeasured' },
      statement: 'Agreement is uninterpretable: rho is unmeasured.',
      challengerIndependenceSatisfiable: false,
    },
    ...overrides,
  };
}

describe('the approval gate', () => {
  it('offers two separate sign-offs, never one', () => {
    // §B.11 lists scenario authorship and panel composition approval as two separate
    // non-delegable decisions. A single "approve" control would be an interface that
    // quietly merged them.
    const out = renderPanel(panel(), scenario).value;
    expect(out).toContain('action="/scenario/11111111-1111-1111-1111-111111111111/approve"');
    expect(out).toContain('action="/panel/33333333-3333-3333-3333-333333333333/approve"');
  });

  it('states plainly that no persona may run', () => {
    expect(renderPanel(panel(), scenario).value).toContain('No persona may run');
  });

  it('still blocks when only one signature is present', () => {
    const half = panel({ scenarioApprovedBy: 'human:lead' });
    const out = renderPanel(half, scenario).value;
    expect(out).toContain('No persona may run');
    // The given signature is shown, and the outstanding one is still offered.
    expect(out).toContain('human:lead');
    expect(out).toContain('action="/panel/33333333-3333-3333-3333-333333333333/approve"');
    expect(out).not.toContain('action="/scenario/');
  });

  it('withdraws both forms once signed, because an approved panel freezes', () => {
    const signed = panel({ scenarioApprovedBy: 'human:lead', panelApprovedBy: 'human:chief' });
    const out = renderPanel(signed, scenario).value;
    expect(out).not.toContain('<form');
    expect(out).toContain('frozen');
    expect(out).not.toContain('No persona may run');
  });

  it('requires a name on the form', () => {
    expect(renderPanel(panel(), scenario).value).toMatch(/name="by"[^>]*required/);
  });
});

describe('the correlation disclosure', () => {
  it('prints the statement verbatim rather than summarising it', () => {
    // §E.4.3's requirement is that an unmeasured correlation is stated as unmeasured. A
    // badge would undo that.
    expect(renderPanel(panel(), scenario).value).toContain(
      'Agreement is uninterpretable: rho is unmeasured.',
    );
  });

  it('warns when challenger independence cannot be satisfied at all', () => {
    expect(renderPanel(panel(), scenario).value).toContain(
      'Challenger independence is not satisfiable',
    );
  });

  it('says nothing when it can be', () => {
    const diverse = panel({
      correlation: { ...panel().correlation, distinctModels: 2, challengerIndependenceSatisfiable: true },
    });
    expect(renderPanel(diverse, scenario).value).not.toContain('not satisfiable');
  });
});

describe('members', () => {
  it('marks a provisional persona', () => {
    const p = panel({ members: [{ ...panel().members[0]!, provisional: true }] });
    expect(renderPanel(p, scenario).value).toContain('provisional');
  });

  it('escapes a hostile subject line', () => {
    const hostile = { ...scenario, subject: '<script>alert(1)</script>' };
    const out = renderPanel(panel(), hostile).value;
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

describe('the index', () => {
  it('says how to convene one when there are none', () => {
    expect(renderPanelIndex([]).value).toContain('panel:propose');
  });

  it('shows the two signatures as separate columns', () => {
    const out = renderPanelIndex([
      {
        panelId: panel().panelId,
        scenarioId: scenario.id,
        eventId: panel().eventId,
        subject: scenario.subject,
        lifecycleStage: 'qualification',
        informingDecision: 'qualification sign-off',
        phase: 0,
        openedAt: '2026-08-12T00:00:00.000Z',
        memberCount: 5,
        scenarioApprovedBy: 'human:lead',
        panelApprovedBy: null,
      },
    ]).value;

    expect(out).toContain('Scenario framing');
    expect(out).toContain('Panel composition');
    expect(out).toContain('human:lead');
    expect(out).toContain('unsigned');
  });
});

describe('signing something already signed', () => {
  const page = renderApprovalConflict(
    'scenario',
    'approval is write-once: scenarios was already approved by human:sponsor',
  );

  it('explains the freeze rather than reporting a fault', () => {
    // Reachable honestly: two operators can open the same panel and both press the button.
    expect(page.value).toContain('approval is write-once');
    expect(page.value).toContain('This is the freeze working, not a failure');
  });

  it('says what to do instead of inviting a retry', () => {
    expect(page.value).toContain('Convene a new panel');
    expect(page.value).not.toContain('<form');
  });
});
