import { readFileSync } from 'node:fs';
import {
  SEED_REGISTRY,
  type PanelProposal,
  type PersonaContext,
  type Scenario,
  convene,
  validateFinding,
} from '@mae/core';
import type { FindingDraft, ViolationCode } from '@mae/core';

export interface ScenarioFixture {
  readonly scenario: Scenario;
  readonly expectedPanel?: unknown;
}

export function loadScenario(path: string): Scenario {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ScenarioFixture | Scenario;
  return 'scenario' in parsed ? parsed.scenario : parsed;
}

/** Renders a panel proposal for a human adjudicator (Appendix B §B.6 steps 5 and 6). */
export function renderProposal(proposal: PanelProposal): string {
  const lines: string[] = [];

  lines.push(`Scenario ${proposal.scenarioId}`);
  lines.push(`Implicated archetypes: ${proposal.implicatedArchetypes.join(', ')}`);
  lines.push('');

  for (const wanted of ['full', 'screening'] as const) {
    const slots = proposal.slots.filter((s) => s.depth === wanted);
    lines.push(`${wanted.toUpperCase()} DEPTH (${slots.length})`);
    if (slots.length === 0) lines.push('  (none)');
    for (const slot of slots) {
      const reasons = slot.matchedPredicates
        .map((p) => `${p.value} (${p.kind === 'consequence_class' ? 'cc' : 'subj'}, w${p.weight})`)
        .join('; ');
      const flag = slot.archetypeImplicated ? '' : '  [archetype not implicated]';
      lines.push(`  ${slot.domainId}  score ${slot.score}  ${slot.archetype}${flag}`);
      lines.push(`    matched: ${reasons}`);
    }
    lines.push('');
  }

  if (proposal.governanceGates.length > 0) {
    lines.push('GOVERNANCE GATES');
    for (const gate of proposal.governanceGates) {
      lines.push(`  ${gate.archetype}  implied by ${gate.impliedBy.join(', ')}`);
      lines.push(`    ${gate.reason}`);
    }
    lines.push('');
  }

  if (proposal.routingHints.length > 0) {
    lines.push('ROUTED OUT');
    for (const hint of proposal.routingHints) {
      lines.push(`  ${hint.domainId}  ${hint.topic} -> ${hint.routeTo}`);
    }
    lines.push('');
  }

  if (proposal.warnings.length > 0) {
    lines.push('WARNINGS (advisory; the human lead adjudicates)');
    for (const warning of proposal.warnings) lines.push(`  - ${warning}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function proposePanel(scenarioPath: string): string {
  return renderProposal(convene(loadScenario(scenarioPath), SEED_REGISTRY));
}

export interface CharterCase {
  readonly name: string;
  readonly context: Partial<PersonaContext>;
  readonly finding: Partial<FindingDraft>;
  readonly expectedCodes: readonly ViolationCode[];
}

/** Runs the charter validator over a corpus file and renders the outcome per case. */
export function checkCharter(
  corpusPath: string,
  baseFinding: FindingDraft,
  baseContext: PersonaContext,
): string {
  const { cases } = JSON.parse(readFileSync(corpusPath, 'utf8')) as { cases: CharterCase[] };
  const lines: string[] = [];

  for (const testCase of cases) {
    const ctx: PersonaContext = { ...baseContext, ...testCase.context };
    const finding: FindingDraft = {
      ...baseFinding,
      ...testCase.finding,
      personaId: ctx.personaId,
      // The corpus writes SELF for the self-corroboration case so the fixture stays readable
      // without hardcoding a persona id. Resolved the same way the test harness resolves it.
      ...resolveSelfCitation(testCase.finding, ctx.personaId),
    };
    const violations = validateFinding(finding, ctx);
    const routed = violations.find((v) => v.routeTo !== undefined);

    lines.push(`${testCase.name}`);
    for (const violation of violations) {
      const disposition = violation.routeTo !== undefined
        ? `ROUTED -> ${violation.routeTo}`
        : violation.remediable
          ? 'repairable'
          : 'NON-REMEDIABLE, struck';
      lines.push(`  ${violation.code}  [${disposition}]`);
    }
    if (violations.length === 0) lines.push('  (accepted)');
    if (routed !== undefined) lines.push('  no partial output produced');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Resolves the `SELF` placeholder the charter corpus uses for self-citation cases.
 * Returns an empty object when the case declares no corroborating findings, so the key is
 * absent rather than explicitly undefined.
 */
function resolveSelfCitation(
  finding: Partial<FindingDraft>,
  personaId: string,
): Pick<FindingDraft, 'corroboratingFindings'> | Record<string, never> {
  const corroborating = finding.corroboratingFindings;
  if (corroborating === undefined) return {};
  return {
    corroboratingFindings: corroborating.map((c) => ({
      ...c,
      personaId: c.personaId === 'SELF' ? personaId : c.personaId,
    })),
  };
}
