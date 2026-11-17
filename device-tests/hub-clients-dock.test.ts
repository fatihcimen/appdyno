import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hubServices } from '../packages/appdyno/src/hub-services.js';
import {
  appCommand,
  CLIENTS,
  DOCK_PATH,
  personPath,
  type Client,
} from '../packages/cli/src/index.js';
import { DEFAULT_POLICY } from '../packages/ops/src/index.js';

/**
 * Every client of AI Clients, end to end, as the app opened from the Dock has it: launchd's environment, its PATH the
 * Dock's, then the person's as the hub asks their login shell for it. Each is found, added, tested and taken off again in a
 * home of the run's own, so no client's real file is near it; then the two entries that failed before 1.3.1: a terminal's
 * client running `npx` by name, and a client opened from the Dock doing the same. APPDYNO_APP names a built Appdyno.app,
 * whose own command each entry runs, and APPDYNO_CLIENTS_TABLE a file for what each did.
 */
const app = process.env.APPDYNO_APP ?? '';
const table = process.env.APPDYNO_CLIENTS_TABLE;
const PROBE_MS = 90_000;

type Said = Record<string, unknown>;

describe.runIf(app)('every client, in the Dock’s environment', () => {
  let home: string;
  let services: ReturnType<typeof hubServices>;
  const rows: Record<string, string>[] = [];

  const act = async (what: string, client: Client, more: Said = {}) => {
    const told: Said[] = [];
    await services.act({ do: what, client: client.name, ...more }, (said) => told.push(said));
    return told.at(-1) ?? {};
  };
  const stateOf = async (client: Client) =>
    ((await act('list', client)).rows as { name: string; state: string }[]).find(
      (r) => r.name === client.name,
    )?.state;
  const tested = async (client: Client) =>
    (await act('test', client)).tested as {
      ok: boolean;
      said: string;
      next: string;
      fix?: boolean;
    };
  /** Where a client keeps its servers, with nothing in it yet: it is on this Mac. */
  const begun = (client: Client) => {
    const file = join(home, client.files[0] ?? '');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, client.format === 'toml' ? '' : '{}\n');
    return file;
  };

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'appdyno-clients-dock-'));
    // what launchd gives an app opened from the Dock, as the hub of the app is started
    const dock = {
      HOME: home,
      USER: userInfo().username,
      SHELL: process.env.SHELL ?? '/bin/zsh',
      PATH: DOCK_PATH,
    };
    const env = {
      ...dock,
      PATH: await personPath(dock),
      APPDYNO_HELPERS: join(app, 'Contents/Helpers/Appdyno Window.app/Contents/MacOS'),
    };
    services = hubServices({
      home,
      env,
      server: { command: appCommand(app), args: ['mcp'] },
      mcpCommand: [appCommand(app), 'mcp'],
      policy: DEFAULT_POLICY,
      doctor: () => Promise.resolve([]),
    });
  }, 60_000);

  afterAll(async () => {
    await services.end();
    rmSync(home, { recursive: true, force: true });
    if (table) writeFileSync(table, JSON.stringify(rows, null, 1));
  });

  it.each(CLIENTS.map((c) => [c.name, c] as const))(
    '%s is found, added, tested and taken off',
    async (_, client) => {
      // absent, or open where another client's folder holds its own, as one client's folder holds another's
      expect(['absent', 'open']).toContain(await stateOf(client));
      begun(client);
      const found = await stateOf(client);
      await act('change', client);
      const added = await stateOf(client);
      const test = await tested(client);
      await act('change', client, { remove: true });
      const after = await stateOf(client);
      rows.push({
        client: client.name,
        found: String(found),
        added: String(added),
        test: test.said,
        removed: String(after),
      });
      expect([found, added, after]).toEqual(['open', 'added', 'open']);
      expect(test.ok, `${test.said} ${test.next}`).toBe(true);
    },
    PROBE_MS,
  );

  it(
    'tries a terminal’s client running npx by name with the person’s PATH, as its terminal would',
    async () => {
      const claude = CLIENTS.find((c) => c.ownFile && !c.dock);
      if (!claude) throw new Error('no client a terminal starts');
      const file = begun(claude);
      writeFileSync(
        file,
        JSON.stringify({
          mcpServers: { appdyno: { command: 'npx', args: ['-y', 'appdyno', 'mcp'] } },
        }),
      );
      const test = await tested(claude);
      rows.push({ client: `${claude.name}, npx by name`, test: test.said });
      expect(test.ok, `${test.said} ${test.next}`).toBe(true);
    },
    PROBE_MS,
  );

  it(
    'says a client opened from the Dock cannot run npx by name, and Update makes it work',
    async () => {
      const desktop = CLIENTS.find((c) => c.dock);
      if (!desktop) throw new Error('no client opened from the Dock');
      const file = begun(desktop);
      writeFileSync(
        file,
        JSON.stringify({
          mcpServers: { appdyno: { command: 'npx', args: ['-y', 'appdyno', 'mcp'] } },
        }),
      );
      const before = await tested(desktop);
      expect(before).toMatchObject({ ok: false, fix: true });
      await act('change', desktop);
      const after = await tested(desktop);
      rows.push({ client: `${desktop.name}, npx by name`, test: before.said, fixed: after.said });
      expect(after.ok, `${after.said} ${after.next}`).toBe(true);
    },
    PROBE_MS,
  );
});
