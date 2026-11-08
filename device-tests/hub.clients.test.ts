import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';
import { hubServices } from '../packages/appdyno/src/hub-services.js';
import { CLIENTS, BROWSER_CLIENTS, type Client } from '../packages/cli/src/index.js';
import {
  noteClientCall,
  viewerBinary,
  ViewerProcess,
  type ViewerMessage,
} from '../packages/core/src/index.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { runHub } from '../packages/hub/src/index.js';
import { untilWithin } from './until.js';

/**
 * AI Clients and Help in the hub's real window, kept off every screen, every control pressed by a real click. Its home is a
 * folder of its own, so no client's real file is near it, and it may drive no device. APPDYNO_HUB_PLACES=1 runs it,
 * APPDYNO_HUB_LOOK and APPDYNO_HUB_LANGUAGE pick how, APPDYNO_HUB_KEY=1 draws it as the window in use, and APPDYNO_SHOTS
 * names a folder for pictures.
 */
const main = join(import.meta.dirname, '../packages/appdyno/dist/main.js');
const shots = process.env.APPDYNO_SHOTS;
const look = process.env.APPDYNO_HUB_LOOK ?? 'dark';
const language = process.env.APPDYNO_HUB_LANGUAGE ?? 'en';
const tag = `${look}-${language}${process.env.APPDYNO_HUB_KEY ? '-key' : ''}`;

const named = (name: string) => CLIENTS.find((c) => c.name === name);
/** The client of the table that `is` picks, which the table holds. */
const clientWhere = (is: (c: Client) => unknown) => {
  const client = CLIENTS.find(is);
  assert(client, 'a client');
  return client;
};
/** Each in a state of its own, so that a picture holds them all. */
const [connected, added, working, open, broken] = [
  clientWhere((c) => c.ownFile),
  clientWhere((c) => c.format === 'toml'),
  clientWhere((c) => c.format === 'jsonc' && c.key === 'mcpServers'),
  clientWhere((c) => c.format === 'json' && !c.ownFile),
  clientWhere((c) => c.key === 'context_servers'),
];
const fileIn = (home: string, client: Client) => {
  const [file] = client.files;
  assert(file, client.name);
  return join(home, file);
};
/** The address a message to the window shows the server at: none while it is off. */
const addressIn = (m: Record<string, unknown>) =>
  (m.server as { address?: string } | undefined)?.address;
const put = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

describe.runIf(process.env.APPDYNO_HUB_PLACES)('AI Clients and Help', () => {
  const heard: ViewerMessage[] = [];
  const sent: Record<string, unknown>[] = [];
  let home: string;
  let link: ViewerProcess;
  let done: Promise<number>;

  const quiet = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = untilWithin(30_000);
  /** Clicks a control as a mouse does: the window's own events, through its hit testing. */
  const click = async (name: string) => {
    heard.length = 0;
    link.send({ op: 'poke', clickOn: name });
    await until(`click on ${name}`, () => heard.some((m) => m.op === 'clicked'));
    const clicked = heard.find((m) => m.op === 'clicked');
    expect(clicked).toMatchObject({ found: true, isIt: 1, name });
  };
  const clickRow = async (title: string) => {
    heard.length = 0;
    link.send({ op: 'poke', clickRow: title });
    await until(`row ${title}`, () => heard.some((m) => m.op === 'clicked'));
    expect(heard.find((m) => m.op === 'clicked')).toMatchObject({ found: true });
  };
  const answer = async (key: string, ms?: number) => {
    await until(`answer ${key}`, () => sent.some((m) => m[key] !== undefined), ms);
    const m = sent.find((x) => x[key] !== undefined);
    assert(m, key);
    return m[key] as Record<string, unknown>;
  };
  const picture = async (name: string) => {
    if (!shots) return;
    await quiet(350);
    const file = join(shots, `${name}-${tag}.png`);
    heard.length = 0;
    link.send({ op: 'snapshot', file });
    await until('picture', () => heard.some((m) => m.op === 'snapped'));
    const snapped = heard.find((m) => m.op === 'snapped');
    assert(snapped, 'snapped');
    const { parts } = snapped;
    writeFileSync(file.replace('.png', '.json'), JSON.stringify(parts));
  };
  const board = async () => {
    heard.length = 0;
    link.send({ op: 'poke', board: true });
    await until('the pasteboard', () => heard.some((m) => m.op === 'board'));
    const said = heard.find((m) => m.op === 'board');
    assert(said, 'board');
    return String(said.text);
  };

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'appdyno-hub-services-'));
    process.env.APPDYNO_STATE_DIR = join(home, 'state');
    const entries = (client: Client, entry: object) =>
      client.format === 'toml'
        ? `[${client.key}.appdyno]\ncommand = "npx"\nargs = ["-y", "appdyno", "mcp"]\n`
        : JSON.stringify({ [client.key]: { appdyno: entry } }, null, 2);
    put(
      fileIn(home, connected),
      entries(connected, { command: process.execPath, args: [main, 'mcp'] }),
    );
    noteClientCall({ name: connected.says.source }, 'stdio');
    put(fileIn(home, added), entries(added, {}));
    put(
      fileIn(home, working),
      entries(working, { command: process.execPath, args: [main, 'mcp'] }),
    );
    mkdirSync(dirname(fileIn(home, open)), { recursive: true });
    put(fileIn(home, broken), '{ "theirs": 1, ');
    const binary = await viewerBinary();
    const ctx = new ServerContext({ ...DEFAULT_POLICY, devices: /^none$/ }, []);
    done = runHub(ctx, {
      focus: false,
      behind: true,
      log: () => undefined,
      services: hubServices({
        home,
        env: { ...process.env, HOME: home },
        mcpCommand: [process.execPath, main, 'mcp'],
        doctor: () =>
          Promise.resolve([
            { name: 'node', ok: true, detail: process.versions.node },
            {
              name: 'adb',
              ok: false,
              detail: 'not found',
              fix: 'accept the USB debugging prompt on the phone',
            },
          ]),
      }),
      viewer: () => {
        link = new ViewerProcess(binary, [
          '--hub',
          '--behind',
          '--appearance',
          look,
          ...(process.env.APPDYNO_HUB_KEY ? [] : ['--not-key']),
          ...(language === 'tr' ? ['-AppleLanguages', '(tr)'] : []),
        ]);
        link.onMessage((m) => heard.push(m));
        const send = link.send.bind(link);
        link.send = (m) => {
          sent.push(m);
          send(m);
        };
        return link;
      },
    });
    await until('the hub', () => sent.some((m) => m.op === 'hub'));
  });

  afterAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- unset where beforeAll failed
    link?.send({ op: 'quit' });
    await done;
    rmSync(home, { recursive: true, force: true });
  });

  it('shows every client as it truly stands, and leaves their files as they were', async () => {
    const before = readFileSync(fileIn(home, broken), 'utf8');
    await clickRow('AI Clients');
    const { rows } = (await until('rows', () => sent.some((m) => m.rows)),
    sent.find((m) => m.rows)) as {
      rows: { name: string; state: string }[];
    };
    const states = Object.fromEntries(rows.map((r) => [r.name, r.state]));
    expect(states[connected.name]).toBe('connected');
    expect(states[added.name]).toBe('added');
    expect(states[open.name]).toBe('open');
    expect(states[broken.name]).toBe('refused');
    const [browser] = BROWSER_CLIENTS;
    assert(browser);
    expect(states[browser.name]).toBe('browser');
    expect(Object.values(states)).toContain('absent');
    expect(readFileSync(fileIn(home, broken), 'utf8')).toBe(before);
    await picture('clients');
  });

  it('shows the exact change first, makes it on a click, and takes it back', async () => {
    const file = fileIn(home, open);
    await click(`add:${open.name}`);
    expect(await answer('preview')).toMatchObject({ client: open.name, did: 'added', file });
    await picture('clients-preview');
    await click(`cancel:${open.name}`);
    await quiet(200);
    sent.length = 0;
    await click(`add:${open.name}`);
    await answer('preview');
    await quiet(200);
    await click(`apply:${open.name}`);
    expect(await answer('done')).toMatchObject({ client: open.name, did: 'added' });
    expect(readFileSync(file, 'utf8')).toContain('appdyno');
    await picture('clients-added');
    sent.length = 0;
    await click(`undo:${open.name}`);
    await answer('done');
    expect(readFileSync(file, 'utf8')).not.toContain('appdyno');
  });

  it('takes an entry out on a click, and Undo puts it back as it was', async () => {
    const file = fileIn(home, working);
    const before = readFileSync(file, 'utf8');
    sent.length = 0;
    await click(`remove:${working.name}`);
    expect(await answer('preview')).toMatchObject({ remove: true, did: 'removed' });
    await quiet(200);
    await click(`apply:${working.name}`);
    expect(await answer('done')).toMatchObject({ did: 'removed' });
    expect(readFileSync(file, 'utf8')).not.toContain(main);
    sent.length = 0;
    await click(`undo:${working.name}`);
    await answer('done');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(before));
    await quiet(200);
  });

  it('tests what an entry runs, and says what to do when it fails', async () => {
    sent.length = 0;
    await click(`test:${working.name}`);
    expect(await answer('tested', 60_000)).toMatchObject({ client: working.name, ok: true });
    await picture('clients-tested');
    sent.length = 0;
    await click(`test:${added.name}`);
    const failed = await answer('tested', 90_000);
    expect(failed).toMatchObject({ client: added.name, ok: false });
    expect(failed.next).toBeTruthy();
    await picture('clients-failed');
  });

  it('starts the server, keeps its token hidden until asked, and copies what it should', async () => {
    const [first] = BROWSER_CLIENTS;
    assert(first);
    const browser = first.name;
    sent.length = 0;
    await click(`test:${browser}`);
    expect(await answer('tested')).toMatchObject({ ok: false, said: 'The server is not running.' });
    sent.length = 0;
    await click('serverPower');
    await until('the address', () => sent.some(addressIn));
    const shown = sent.find(addressIn);
    assert(shown);
    expect(JSON.stringify(sent)).not.toMatch(/"token"/);
    const address = (shown.server as { address: string }).address;
    expect(await fetch(address, { method: 'POST' }).then((r) => r.status)).toBe(401);
    await picture('clients-server');
    await click('copyAddress');
    await quiet(200);
    expect(await board()).toBe(address);
    sent.length = 0;
    await click(`test:${browser}`);
    expect(await answer('tested', 60_000)).toMatchObject({ ok: true });
    sent.length = 0;
    await click('showToken');
    const token = (await answer('token')) as unknown as string;
    expect(token).toMatch(/^[\w.~-]{32,}$/);
    expect(
      await fetch(address, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}',
      }).then((r) => r.status),
    ).not.toBe(401);
    await picture('clients-token');
    await click('showToken');
    sent.length = 0;
    await click('copyToken');
    await answer('copy');
    await quiet(200);
    expect(await board()).toBe(token);
    sent.length = 0;
    await click('newToken');
    await until('a new token', () => sent.some((m) => m.rows && addressIn(m)));
    await click('showToken');
    await until('the token', () => sent.some((m) => m.token));
    const told = sent.find((m) => m.token);
    assert(told);
    expect(told.token).not.toBe(token);
    await click('showToken');
    await click('serverPower');
    await until('the server stopped', () => {
      const last = sent.at(-1);
      return last?.server !== undefined && !addressIn(last);
    });
    await expect(fetch(address, { method: 'POST' })).rejects.toThrow();
  });

  it('holds what Help says, fills its prompts, and copies each', async () => {
    await clickRow('Help');
    await until('the notes', () => sent.some((m) => m.notes));
    await picture('help');
    for (let card = 0; card < 5; card++) {
      await click(`copyPrompt:${card}`);
      await quiet(150);
      expect((await board()).length).toBeGreaterThan(30);
    }
    await picture('help-prompts');
    await click('runDoctor');
    await until('doctor', () => sent.some((m) => m.doctor));
    await picture('help-doctor');
  });

  it('comes to AI Clients and back by the sidebar, as often as a person does', async () => {
    await clickRow('AI Clients');
    await quiet(200);
    await clickRow('Help');
    await quiet(200);
    await clickRow('AI Clients');
    await picture('clients-again');
    expect(named(connected.name)).toBeDefined();
  });
});
