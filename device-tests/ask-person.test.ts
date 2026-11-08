import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type ElicitResult } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REVISIONS } from '../packages/ops/test/helpers.js';
import { toolCaller } from './helpers.js';

/**
 * The built MCP server over stdio, as a client starts it, asks the person before `app clear`: a client that shows the
 * question and says yes, one that says no, and one that cannot ask, on the simulator APPDYNO_IOS_UDID names with the
 * fixture installed. A file the fixture keeps says whether its data went.
 */
const SIMULATOR = process.env.APPDYNO_IOS_UDID ?? '';
const APP = 'dev.appdyno.fixture';
const MAIN = fileURLToPath(new URL('../packages/appdyno/dist/main.js', import.meta.url));

const kept = () =>
  join(
    execFileSync('xcrun', ['simctl', 'get_app_container', SIMULATOR, APP, 'data'], {
      encoding: 'utf8',
    }).trim(),
    'Documents/kept-by-a-person.txt',
  );

describe.skipIf(!SIMULATOR).each(REVISIONS)('what loses data, over stdio, on %s', (revision) => {
  const clients: Client[] = [];
  const asked: string[] = [];

  /** A server for one client: `answer` is the person's, shown by a client that declares it can ask. */
  async function connect(answer?: ElicitResult['action'], flags: string[] = []) {
    const client = new Client(
      { name: 'ask-person-test', version: '0' },
      {
        ...(answer && { capabilities: { elicitation: {} } }),
        ...(revision === '2026-07-28' && { versionNegotiation: { mode: { pin: revision } } }),
      },
    );
    if (answer)
      client.setRequestHandler('elicitation/create', (r) => {
        asked.push(r.params.message);
        return { action: answer };
      });
    const args = [MAIN, 'mcp', '--device', SIMULATOR, '--allow-devices', `^${SIMULATOR}$`];
    // the flag is what the test gives, never the shell's
    const { APPDYNO_ALLOW_DATA_LOSS: _, ...env } = process.env as Record<string, string>;
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [...args, ...flags], env }),
    );
    clients.push(client);
    return toolCaller(() => client);
  }

  beforeEach(() => {
    asked.length = 0;
    mkdirSync(dirname(kept()), { recursive: true });
    writeFileSync(kept(), 'mine');
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
  });

  it('leaves the data on a no, never says a person declined, and says how a person allows it ahead', async () => {
    const r = await (await connect('decline'))('app', { action: 'clear', app: APP });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(
      new RegExp(
        `^PERMISSION_REQUIRED: app clear on .*${SIMULATOR}.* was not allowed: its question got no yes, and nothing was done\\nhint: a client may answer no by itself, with no person shown the question; a person allows it ahead in this server's own command line: --allow-data-loss virtual`,
      ),
    );
    expect(asked).toEqual([
      expect.stringMatching(
        new RegExp(
          `^Clear the data of ${APP} on .*${SIMULATOR}.*\\? All it keeps there is lost for good\\.$`,
        ),
      ),
    ]);
    expect(existsSync(kept())).toBe(true);
  }, 120_000);

  it('leaves the data where the client cannot ask, and says how a person allows it', async () => {
    const r = await (await connect())('app', { action: 'clear', app: APP });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(
      /^PERMISSION_REQUIRED: app clear asks the person first, and this client cannot ask: nothing was done\nhint: a person allows it ahead in this server's own command line: --allow-data-loss virtual/,
    );
    expect(existsSync(kept())).toBe(true);
  }, 120_000);

  it('clears it on the yes of the person the client asked', async () => {
    const r = await (await connect('accept'))('app', { action: 'clear', app: APP });
    expect(r.error ? r.text : '').toBe('');
    expect(r.text).toBe(`cleared the data of ${APP}`);
    expect(asked).toHaveLength(1);
    expect(existsSync(kept())).toBe(false);
  }, 120_000);

  it('clears it with nothing asked on a server a person started with --allow-data-loss virtual', async () => {
    const r = await (
      await connect('decline', ['--allow-data-loss', 'virtual'])
    )('app', {
      action: 'clear',
      app: APP,
    });
    expect(r.error ? r.text : '').toBe('');
    expect(asked).toEqual([]);
    expect(existsSync(kept())).toBe(false);
  }, 120_000);
});
