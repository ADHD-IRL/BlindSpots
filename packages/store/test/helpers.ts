import { randomUUID } from 'node:crypto';
import { migrate } from '../src/migrate.ts';
import { closePool, getPool, withClient } from '../src/pool.ts';

/**
 * Database-backed tests skip cleanly when no DATABASE_URL is configured. Not every
 * environment has a Docker daemon, and `core` — where the constraint logic lives — is pure
 * precisely so that the always-run test suite covers the parts that carry correctness.
 * CI supplies a pgvector service container so these do execute there.
 */
export const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';

export async function setupSchema(): Promise<void> {
  await withClient((client) => migrate(client));
}

export async function teardown(): Promise<void> {
  await closePool();
}

/**
 * Creates the scenario, panel and event rows a ledger entry needs.
 *
 * `ledger.event_id` references `events` (migration 0009), so an entry can no longer be
 * written against an id nothing issued. Tests that only care about chain mechanics still
 * need a real event to hang them on.
 */
export async function openTestEvent(eventId: string = randomUUID()): Promise<string> {
  const scenarioId = randomUUID();
  const panelId = randomUUID();

  await withClient(async (client) => {
    await client.query(
      `INSERT INTO scenarios (
         id, subject, lifecycle_stage, mission_function, consequence_classes,
         informing_decision, adversary_set, classification, exclusions, authored_by
       ) VALUES ($1, 'test subject', 'qualification', 'test mission',
                 ARRAY['physical_failure_in_service'], 'test decision', ARRAY['test actor'],
                 'UNCLASSIFIED', '[]'::jsonb, 'human:test')`,
      [scenarioId],
    );
    await client.query('INSERT INTO panels (id, scenario_id) VALUES ($1, $2)', [
      panelId,
      scenarioId,
    ]);
    await client.query('INSERT INTO events (id, scenario_id, panel_id) VALUES ($1, $2, $3)', [
      eventId,
      scenarioId,
      panelId,
    ]);
  });

  return eventId;
}

export { getPool, withClient };
