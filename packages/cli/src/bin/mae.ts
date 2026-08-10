import { randomUUID } from 'node:crypto';
import { SEED_DOMAINS, verifyChain } from '@mae/core';
import { SpineRiskError, closePool, loadChain, migrate, seedRegistry, withClient } from '@mae/store';
import { proposePanel } from '../commands.ts';

const USAGE = `mae — MAE panel engine operator CLI

  panel:propose --scenario <path>   Convene a panel from a scenario file
  seed:registry [--archetypes a,b]  Write the seed registry to Postgres
  ledger:verify --event <uuid>      Walk an event's hash chain
  charter:check [--corpus <path>]   Run the validator over a corpus of findings
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
    console.log(proposePanel(requireFlag('scenario')));
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
    const { loadScenario } = await import('../commands.ts');
    const scenario = loadScenario(requireFlag('from'));
    console.log(JSON.stringify({ ...scenario, id: scenario.id || randomUUID() }, null, 2));
    break;
  }

  default:
    console.log(USAGE);
    process.exit(command === undefined ? 0 : 2);
}
