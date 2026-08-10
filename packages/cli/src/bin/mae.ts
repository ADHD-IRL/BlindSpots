import { randomUUID } from 'node:crypto';
import { SEED_DOMAINS, verifyChain } from '@mae/core';
import { closePool, loadChain, migrate, withClient } from '@mae/store';
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
    // §C.8 stage 1 wants a first stage drawn from at least two archetypes: seeding from one
    // builds a spine that later stages must fight.
    const requested = flag('archetypes')?.split(',').map((a) => a.trim()).filter(Boolean);
    const domains =
      requested === undefined
        ? SEED_DOMAINS
        : SEED_DOMAINS.filter((d) => requested.includes(d.archetype));

    const archetypes = new Set(domains.map((d) => d.archetype));
    if (archetypes.size < 2) {
      console.error(
        `Refusing to seed from ${archetypes.size} archetype(s). Appendix C §C.8 stage 1 ` +
          `requires at least two: a registry seeded from one builds the spine the ` +
          `architecture exists to prevent, and the golden scenario tests will not catch it.`,
      );
      process.exit(1);
    }

    await withClient(async (client) => {
      await migrate(client);
      await client.query('BEGIN');
      try {
        // Parents first, so parent_domain references resolve.
        for (const domain of [...domains].sort((a, b) => (a.parentDomain === undefined ? -1 : 1) - (b.parentDomain === undefined ? -1 : 1))) {
          await client.query(
            `INSERT INTO domains (id, display_name, archetype, scope_inclusions, scope_exclusions, status)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [
              domain.id,
              domain.displayName,
              domain.archetype,
              domain.scopeInclusions,
              JSON.stringify(domain.scopeExclusions),
              domain.status,
            ],
          );
          for (const predicate of domain.predicates) {
            await client.query(
              `INSERT INTO relevance_predicates (domain_id, kind, value, weight)
               VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
              [domain.id, predicate.kind, predicate.value, predicate.weight],
            );
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    console.log(`Seeded ${domains.length} domains across ${archetypes.size} archetypes.`);
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
