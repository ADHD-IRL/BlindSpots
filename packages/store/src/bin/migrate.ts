import { migrate } from '../migrate.ts';
import { closePool, withClient } from '../pool.ts';

const result = await withClient((client) => migrate(client));

for (const name of result.applied) console.log(`applied  ${name}`);
for (const name of result.skipped) console.log(`current  ${name}`);
if (result.applied.length === 0) console.log('Schema is up to date.');

await closePool();
