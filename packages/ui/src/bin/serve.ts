import { createServer } from '../server.ts';

/**
 * The operator console.
 *
 *   DATABASE_URL=postgres://mae:mae@localhost:5432/mae pnpm ui
 *
 * Binds to loopback by default. This surface signs off panel composition under a named
 * human's name and writes that signature to the ledger; it has no authentication of its
 * own, so it must not be reachable from anywhere the operator is not sitting.
 */
const port = Number(process.env['PORT'] ?? 5173);
const host = process.env['HOST'] ?? '127.0.0.1';

if ((process.env['DATABASE_URL'] ?? '') === '') {
  console.error('DATABASE_URL is required: the console reads and signs persisted panels.');
  process.exit(2);
}

createServer().listen(port, host, () => {
  console.log(`MAE console on http://${host}:${port}`);
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.error(
      `WARNING: bound to ${host}, not loopback. This console records approvals under a ` +
        'named human and has no authentication of its own.',
    );
  }
});
