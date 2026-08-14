import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { verifyChain } from '@mae/core';
import {
  approvePanel,
  approveScenario,
  listPanels,
  loadChain,
  loadPanel,
  loadScenario,
  withClient,
} from '@mae/store';
import { loadCassetteLibrary } from '@mae/runtime';
import { document, html } from './render/html.ts';
import { renderCassettes, renderFields, renderLedger, type FieldSourceRow } from './render/audit.ts';
import { renderApprovalConflict, renderPanel, renderPanelIndex } from './render/panel.ts';

export interface ServerOptions {
  readonly cassetteDir?: string;
}

const UUID = '[0-9a-fA-F-]{36}';
const ROUTES = {
  panel: new RegExp(`^/panel/(${UUID})$`),
  approvePanel: new RegExp(`^/panel/(${UUID})/approve$`),
  approveScenario: new RegExp(`^/scenario/(${UUID})/approve$`),
  ledger: new RegExp(`^/event/(${UUID})/ledger$`),
};

export function createServer(options: ServerOptions = {}): Server {
  const cassetteDir = options.cassetteDir ?? 'fixtures/cassettes';

  return createHttpServer((req, res) => {
    handle(req, res, cassetteDir).catch((error: unknown) => {
      send(res, 500, document('Error', html`
        <h1>Server error</h1>
        <div class="stop"><p class="mono">${(error as Error).message}</p></div>
      `));
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, cassetteDir: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // Signing off is a state change that gets written to the hash-chained ledger under a named
  // human's name. It is POST-only and never routed from a GET, so a link cannot produce a
  // signature that a person did not knowingly give.
  if (method === 'POST') {
    const panelMatch = ROUTES.approvePanel.exec(path);
    if (panelMatch !== null) return signOff(req, res, 'panel', panelMatch[1]!);

    const scenarioMatch = ROUTES.approveScenario.exec(path);
    if (scenarioMatch !== null) return signOff(req, res, 'scenario', scenarioMatch[1]!);

    return send(res, 405, document('Not allowed', html`<h1>405 — method not allowed</h1>`));
  }

  if (method !== 'GET') {
    return send(res, 405, document('Not allowed', html`<h1>405 — method not allowed</h1>`));
  }

  if (path === '/') {
    const panels = await withClient(listPanels);
    return send(res, 200, document('Panels', renderPanelIndex(panels)));
  }

  const panelMatch = ROUTES.panel.exec(path);
  if (panelMatch !== null) {
    const panelId = panelMatch[1]!;
    const { panel, scenario } = await withClient(async (client) => {
      const loaded = await loadPanel(client, panelId);
      return { panel: loaded, scenario: await loadScenario(client, loaded.scenarioId) };
    });
    const flash = url.searchParams.get('signed');
    return send(
      res,
      200,
      document(
        scenario.subject,
        renderPanel(panel, scenario, flash === null ? undefined : `Signature recorded: ${flash}.`),
      ),
    );
  }

  const ledgerMatch = ROUTES.ledger.exec(path);
  if (ledgerMatch !== null) {
    const eventId = ledgerMatch[1]!;
    const entries = await withClient((client) => loadChain(client, eventId));
    return send(res, 200, document('Ledger', renderLedger(eventId, entries, verifyChain(entries))));
  }

  if (path === '/fields') {
    const rows = await withClient(loadFieldSources);
    return send(res, 200, document('Field sources', renderFields(rows)));
  }

  if (path === '/cassettes') {
    const cassettes = loadCassetteLibrary(cassetteDir);
    return send(res, 200, document('Cassettes', renderCassettes(cassetteDir, cassettes)));
  }

  send(res, 404, document('Not found', html`<h1>404 — no such page</h1>`));
}

async function signOff(
  req: IncomingMessage,
  res: ServerResponse,
  kind: 'panel' | 'scenario',
  id: string,
): Promise<void> {
  const by = (await readForm(req)).get('by')?.trim() ?? '';
  if (by === '') {
    return send(
      res,
      400,
      document('Signature required', html`
        <h1>A signature needs a name</h1>
        <div class="stop">
          <p>
            Accountability attaches to a named human (§B.11). An unnamed approval records
            that the decision was made without recording who made it, which is the part that
            matters.
          </p>
        </div>
      `),
    );
  }

  let panelId: string | null;
  try {
    panelId = await withClient(async (client) => {
      if (kind === 'panel') {
        await approvePanel(client, id, by);
        return id;
      }
      await approveScenario(client, id, by);
      const { rows } = await client.query<{ id: string }>(
        'SELECT id FROM panels WHERE scenario_id = $1 ORDER BY id LIMIT 1',
        [id],
      );
      return rows[0]?.id ?? null;
    });
  } catch (error) {
    // The write-once trigger refusing is an expected outcome, not a fault: two operators can
    // open the same panel and both press the button. Anything else is a real error and is
    // left to the 500 handler.
    const message = (error as Error).message;
    if (!message.includes('approval is write-once')) throw error;
    return send(res, 409, document('Already signed', renderApprovalConflict(kind, message)));
  }

  // POST then redirect, so a reload cannot resubmit a signature.
  res.writeHead(303, {
    Location: panelId === null ? '/' : `/panel/${panelId}?signed=${encodeURIComponent(by)}`,
  });
  res.end();
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A signature form carries one short name. Anything larger is not one.
    if (size > 8_192) throw new Error('Form body too large');
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

async function loadFieldSources(client: {
  query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
}): Promise<FieldSourceRow[]> {
  const { rows } = await client.query(
    `SELECT s.field_id, s.uri, s.reliability, s.content_class, s.graded_by,
            (SELECT count(*) FROM field_chunks c WHERE c.source_id = s.id) AS chunk_count
       FROM field_sources s
      ORDER BY s.content_class DESC, s.field_id, s.uri`,
  );

  return rows.map((r) => ({
    fieldId: String(r['field_id']),
    uri: String(r['uri']),
    reliability: String(r['reliability']) as FieldSourceRow['reliability'],
    contentClass: String(r['content_class']),
    gradedBy: String(r['graded_by']),
    chunkCount: Number(r['chunk_count']),
  }));
}

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    // No external assets, no inline script, no framing. The pages are self-contained, so
    // the policy that describes them is also the policy that constrains them.
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}
