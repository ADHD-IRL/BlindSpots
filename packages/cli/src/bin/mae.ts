import { randomUUID } from 'node:crypto';
import { SEED_DOMAINS, SEED_REGISTRY, convene, verifyChain } from '@mae/core';
import {
  SpineRiskError,
  approvePanel,
  approveScenario,
  closePool,
  loadChain,
  loadPanel,
  migrate,
  openEvent,
  seedRegistry,
  withClient,
} from '@mae/store';
import { proposePanel } from '../commands.ts';

const USAGE = `mae — MAE panel engine operator CLI

  panel:propose --scenario <path>          Convene a panel from a scenario file
      [--persist --models a,b]             ...and open a Phase 0 event for it
  panel:show --panel <uuid>                Render a persisted panel and its approval state
  panel:approve --panel <uuid> --by <who>  Sign off the panel composition
  scenario:approve --scenario <uuid> --by <who>
                                           Sign off the scenario framing
  seed:registry [--archetypes a,b]         Write the seed registry to Postgres
  ledger:verify --event <uuid>             Walk an event's hash chain
  charter:check [--corpus <path>]          Run the validator over a corpus of findings
  fields:load --fixture <path>             Ingest a field fixture (states its own class)
  cassette:list [--dir <path>]             List the model cassettes and how they replay

Both signatures are required before any persona runs (Appendix B §B.11).
`;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function requireFlag(name: string): string {
  const value = flag(name);
  if (value === undefined) {
    console.error(`Missing --${name}\n\n${USAGE}`);
    process.exit(2);
  }
  return value;
}

const command = process.argv[2];

switch (command) {
  case 'panel:propose': {
    const scenarioPath = requireFlag('scenario');

    if (!process.argv.includes('--persist')) {
      console.log(proposePanel(scenarioPath));
      break;
    }

    const { readScenarioFile, renderPersistedPanel } = await import('../commands.ts');
    const scenario = readScenarioFile(scenarioPath);
    const proposal = convene(scenario, SEED_REGISTRY);

    // §B.7.2 ranks heterogeneous base models as the strongest mitigation for correlated
    // error, so the roster is an explicit operator decision rather than a default.
    const modelRoster = (flag('models') ?? '').split(',').map((m) => m.trim()).filter(Boolean);
    if (modelRoster.length === 0) {
      console.error('--persist requires --models a,b (see Appendix B §B.7.2)');
      process.exit(2);
    }

    const persisted = await withClient(async (client) => {
      await migrate(client);
      return openEvent(client, scenario, proposal, SEED_REGISTRY, { modelRoster });
    });

    console.log(proposePanel(scenarioPath));
    console.log(renderPersistedPanel(persisted));
    console.log('');
    console.log('Panel is NOT approved. Both signatures are required before any persona runs:');
    console.log(`  pnpm cli scenario:approve --scenario ${persisted.scenarioId} --by "human:<name>"`);
    console.log(`  pnpm cli panel:approve --panel ${persisted.panelId} --by "human:<name>"`);

    await closePool();
    break;
  }

  case 'panel:show': {
    const { renderPersistedPanel } = await import('../commands.ts');
    const panel = await withClient((client) => loadPanel(client, requireFlag('panel')));
    console.log(renderPersistedPanel(panel));
    await closePool();
    break;
  }

  case 'panel:approve': {
    const panelId = requireFlag('panel');
    const by = requireFlag('by');
    await withClient((client) => approvePanel(client, panelId, by));
    console.log(`Panel ${panelId} composition approved by ${by}.`);
    await closePool();
    break;
  }

  case 'scenario:approve': {
    const scenarioId = requireFlag('scenario');
    const by = requireFlag('by');
    await withClient((client) => approveScenario(client, scenarioId, by));
    console.log(`Scenario ${scenarioId} framing approved by ${by}.`);
    await closePool();
    break;
  }

  case 'seed:registry': {
    const requested = flag('archetypes')?.split(',').map((a) => a.trim()).filter(Boolean);
    const domains =
      requested === undefined
        ? SEED_DOMAINS
        : SEED_DOMAINS.filter((d) => requested.includes(d.archetype));

    try {
      const result = await withClient(async (client) => {
        await migrate(client);
        return seedRegistry(client, domains);
      });
      console.log(
        `Seeded ${result.domains} domains and ${result.predicates} relevance predicates ` +
          `across ${result.archetypes.length} archetypes: ${result.archetypes.join(', ')}.`,
      );
    } catch (error) {
      if (error instanceof SpineRiskError) {
        console.error(error.message);
        await closePool();
        process.exit(1);
      }
      throw error;
    }

    await closePool();
    break;
  }

  case 'fields:load': {
    const { DeterministicEmbedder, EMBEDDING_DIMENSIONS, loadFieldFixture, readFieldFixture } =
      await import('@mae/fields');

    const fixture = readFieldFixture(requireFlag('fixture'));
    const result = await withClient(async (client) => {
      await migrate(client);
      return loadFieldFixture(client, fixture, new DeterministicEmbedder(EMBEDDING_DIMENSIONS));
    });

    console.log(
      `Loaded ${result.sources} source(s), ${result.chunks} chunk(s) into ` +
        `${result.fieldIds.length} field(s) as ${result.contentClass.toUpperCase()}.`,
    );

    if (result.contentClass === 'synthetic') {
      console.log('');
      console.log('  This content is SYNTHETIC. It was invented to exercise the engine and is');
      console.log('  not curated expertise. Every source carries Admiralty F/6 ("cannot be');
      console.log('  judged"), and charter rule CH012 caps any finding drawn from these fields');
      console.log('  at "considered" and requires it to declare a synthetic basis.');
      console.log('');
      console.log(`  Fields: ${result.fieldIds.join(', ')}`);
    }

    await closePool();
    break;
  }

  case 'cassette:list': {
    const { loadCassetteLibrary } = await import('@mae/runtime');
    const { renderCassetteLibrary } = await import('../commands.ts');
    const dir = flag('dir') ?? 'fixtures/cassettes';
    console.log(renderCassetteLibrary(dir, loadCassetteLibrary(dir)));
    break;
  }

  case 'ledger:verify': {
    const eventId = requireFlag('event');
    const result = await withClient(async (client) => verifyChain(await loadChain(client, eventId)));
    await closePool();

    if (result.ok) {
      console.log(`Chain for event ${eventId} verifies clean.`);
    } else {
      const { seq, reason, detail } = result.firstDivergence;
      console.error(`Chain for event ${eventId} DIVERGES at seq ${seq}: ${reason}\n  ${detail}`);
      process.exit(1);
    }
    break;
  }

  case 'charter:check': {
    const { checkCharter } = await import('../commands.ts');
    const corpus = flag('corpus') ?? 'fixtures/charter/non-conforming.json';
    console.log(
      checkCharter(
        corpus,
        {
          personaId: 'materials.polymers_adhesives.principal',
          statement: '',
          confidence: 'considered',
          validityTier: 'moderate',
          basis: 'field schema',
          sourceGrades: [],
        },
        {
          personaId: 'materials.polymers_adhesives.principal',
          domainId: 'materials.polymers_adhesives',
          archetype: 'latent_physical',
          personaClass: 'domain',
          status: 'registered',
          retrievedChunks: [],
          scopeInclusions: ['surface_preparation'],
          scopeExclusions: [{ topic: 'vendor_ownership', routeTo: 'supply_chain.vendor_intent' }],
        },
      ),
    );
    break;
  }

  case 'scenario:new': {
    // Phase 0 is human-led: this only assigns an id and echoes the artifact back. The
    // scenario and panel become the charter everything downstream traces to, and §B.11
    // makes scenario authorship non-delegable.
    const { readScenarioFile } = await import('../commands.ts');
    const scenario = readScenarioFile(requireFlag('from'));
    console.log(JSON.stringify({ ...scenario, id: scenario.id || randomUUID() }, null, 2));
    break;
  }

  default:
    console.log(USAGE);
    process.exit(command === undefined ? 0 : 2);
}
