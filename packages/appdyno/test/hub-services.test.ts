import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { must, noteClientCall } from '@appdyno/core';
import { BROWSER_CLIENTS, CLIENTS } from '@appdyno/cli';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubHttp, httpToken, renewHttpToken } from '../src/hub-http.js';
import { hubServices } from '../src/hub-services.js';
import { policyOf } from '../src/serve.js';

const fake = join(import.meta.dirname, 'fake-mcp.mjs');
/** Plain JSON, a key of `mcpServers`, and a file `install` may begin. */
const client = must(
  CLIENTS.find((c) => c.format === 'json' && !c.ownFile),
  'a client of plain JSON',
);
const other = must(
  CLIENTS.find((c) => c !== client && c.format === 'jsonc' && !c.ownFile),
  'a client of JSONC',
);

let home: string;
let file: string;
const told: Record<string, unknown>[] = [];
const services: ReturnType<typeof hubServices>[] = [];

function place(
  o: { mcpCommand?: string[]; dock?: boolean; policy?: ReturnType<typeof policyOf> } = {},
) {
  const made = hubServices({
    home,
    env: { PATH: process.env.PATH },
    mcpCommand: o.mcpCommand ?? [process.execPath, fake, 'http'],
    policy: o.policy ?? policyOf({}, {}),
    doctor: () => Promise.resolve([{ name: 'node', ok: true, detail: '22' }]),
  });
  services.push(made);
  return made;
}

type Said = {
  rows: { name: string; state: string }[];
  browser: string[];
  server: { address?: string };
  notes: unknown[];
  done: { backup: string };
  tested: { ok: boolean; said: string; line: string; next: string };
  token: string;
  doctor: unknown;
  preview: { lines: string[] };
};

const act = async (p: ReturnType<typeof hubServices>, what: string, more = {}) => {
  told.length = 0;
  await p.act({ do: what, client: client.name, ...more }, (said) => told.push(said));
  return told.at(-1) as Said;
};

const entryWith = (entry: object) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ theme: 'dark', [client.key]: { appdyno: entry } }, null, 2));
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'appdyno-services-'));
  file = join(home, must(client.files[0], 'its file'));
  mkdirSync(dirname(file), { recursive: true });
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-services-state-')));
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((p) => p.end()));
  rmSync(home, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('the list', () => {
  it('has every client of the list and each in a browser, with its state and how to check it', async () => {
    const { rows, browser } = await act(place(), 'list');
    const names = rows.map((r: { name: string }) => r.name);
    expect(names).toEqual([...CLIENTS, ...BROWSER_CLIENTS].map((c) => c.name));
    expect(browser).toEqual(BROWSER_CLIENTS.map((c) => c.name));
    expect(rows.find((r: { name: string }) => r.name === client.name)).toMatchObject({
      state: 'open',
      check: client.check,
    });
  });

  it('says how long ago a client called', async () => {
    entryWith({ command: 'x' });
    noteClientCall({ name: client.says.source }, 'stdio');
    const { rows } = await act(place(), 'list');
    expect(rows.find((r: { name: string }) => r.name === client.name)).toMatchObject({
      state: 'connected',
      lastSaid: expect.stringMatching(/seconds? ago$/) as unknown,
    });
  });

  it('carries each note a client has on a kind of prompt, in both languages', async () => {
    const { notes } = await act(place(), 'list');
    const noted = must(
      CLIENTS.find((c) => c.notes?.long),
      'a client with a note',
    );
    const long = must(noted.notes?.long, 'its note');
    expect(notes).toContainEqual({ client: noted.name, kind: 'long', ...long });
  });
});

describe('a change', () => {
  it('shows the exact lines first, and writes nothing for showing them', async () => {
    const p = place();
    await act(p, 'preview');
    const preview = must(
      told.find((m) => m.preview),
      'a preview',
    ).preview as Said['preview'];
    expect(preview).toMatchObject({ client: client.name, did: 'added', file, remove: false });
    expect(preview.lines.join('\n')).toContain('+');
    expect(preview.lines.join('\n')).toContain('npx');
    expect(existsSync(file)).toBe(false);
  });

  it('is taken back by Undo with all else as it was, and with a client having written since', async () => {
    writeFileSync(file, JSON.stringify({ theme: 'dark' }, null, 2));
    const p = place();
    const { done, rows } = await act(p, 'change');
    expect(done).toMatchObject({ client: client.name, did: 'added' });
    expect(done.backup).toContain('backup');
    expect(rows.find((r: { name: string }) => r.name === client.name)).toMatchObject({
      state: 'added',
      undo: true,
    });
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...written, since: 1 }, null, 2));
    await act(p, 'undo');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      theme: 'dark',
      [client.key]: {},
      since: 1,
    });
  });

  it('says an Undo did not happen when the file refused it, and offers it again', async () => {
    writeFileSync(file, JSON.stringify({ theme: 'dark' }, null, 2));
    const p = place();
    await act(p, 'change');
    const written = readFileSync(file, 'utf8');
    writeFileSync(file, '{ a person was editing this');
    const refused = await act(p, 'undo');
    expect(refused.done).toBeUndefined();
    expect(refused.tested).toMatchObject({ client: client.name, ok: false });
    // what keeps its Undo button on the window
    expect(refused.tested.line).toBe(refused.tested.said);
    expect(readFileSync(file, 'utf8')).toBe('{ a person was editing this');
    expect(refused.rows.find((r: { name: string }) => r.name === client.name)).toMatchObject({
      state: 'refused',
      undo: true,
    });
    writeFileSync(file, written);
    const again = await act(p, 'undo');
    expect(again.done).toMatchObject({ client: client.name, did: 'undone' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ theme: 'dark', [client.key]: {} });
  });

  it('says why an Undo did not happen where the row does not, as a file closed to writing', async () => {
    writeFileSync(file, JSON.stringify({ theme: 'dark' }, null, 2));
    const p = place();
    await act(p, 'change');
    const written = readFileSync(file, 'utf8');
    chmodSync(file, 0o444);
    const refused = await act(p, 'undo');
    expect(refused.done).toBeUndefined();
    expect(refused.tested).toMatchObject({
      ok: false,
      next: expect.stringMatching(/EACCES|denied/) as unknown,
    });
    expect(readFileSync(file, 'utf8')).toBe(written);
    chmodSync(file, 0o644);
    expect((await act(p, 'undo')).done).toMatchObject({ did: 'undone' });
  });

  it('takes out only its entry, and Undo puts back what was set by hand', async () => {
    entryWith({ command: 'mine', args: ['--flag'], env: { A: '1' } });
    const p = place();
    await act(p, 'change', { remove: true });
    const taken: unknown = JSON.parse(readFileSync(file, 'utf8'));
    expect(taken).toHaveProperty(client.key);
    expect(taken).not.toHaveProperty([client.key, 'appdyno']);
    await act(p, 'undo');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveProperty([client.key, 'appdyno'], {
      command: 'mine',
      args: ['--flag'],
      env: { A: '1' },
    });
  });

  it('starts a client over when it is taken out: an old call earns nothing', async () => {
    entryWith({ command: 'x' });
    noteClientCall({ name: client.says.source }, 'stdio');
    const p = place();
    await act(p, 'change', { remove: true });
    entryWith({ command: 'x' });
    const { rows } = await act(p, 'list');
    expect(rows.find((r) => r.name === client.name)?.state).toBe('added');
  });

  it('touches no other client, and reaches nothing for a name not on the list', async () => {
    const theirs = join(home, must(other.files[0], 'its file'));
    mkdirSync(dirname(theirs), { recursive: true });
    writeFileSync(theirs, '{ "theirs": true }\n');
    const p = place();
    await act(p, 'change');
    expect(readFileSync(theirs, 'utf8')).toBe('{ "theirs": true }\n');
    told.length = 0;
    await p.act({ do: 'change', client: '../../etc' }, (said) => told.push(said));
    expect(told.flatMap((m) => (m.done ? [m.done] : []))).toEqual([]);
  });
});

describe('Test', () => {
  const tried = async (p: ReturnType<typeof hubServices>, what = client.name) => {
    await act(p, 'test', { client: what });
    return (must(
      told.find((m) => m.tested),
      'a test',
    ).tested ?? {}) as Record<string, unknown>;
  };

  it('runs what the entry says, and reads the tools it lists', async () => {
    entryWith({ command: process.execPath, args: [fake] });
    expect(await tried(place())).toMatchObject({
      ok: true,
      said: 'It started, and lists 1 tools.',
      next: expect.stringContaining('Restart it') as unknown,
    });
  });

  it('counts as no call: a client earns its word by its own', async () => {
    entryWith({ command: process.execPath, args: [fake] });
    const p = place();
    await tried(p);
    const { rows } = await act(p, 'list');
    expect(rows.find((r) => r.name === client.name)?.state).toBe('added');
  });

  it('says what to do when the command is not there', async () => {
    entryWith({ command: '/no/such/program', args: [] });
    expect(await tried(place())).toMatchObject({
      ok: false,
      said: 'It could not find /no/such/program.',
      next: expect.stringContaining('full path') as unknown,
    });
  });

  it('knows the registry has no such package', async () => {
    entryWith({
      command: process.execPath,
      args: ['-e', 'console.error("npm error code E404"); process.exit(1)'],
    });
    expect(await tried(place())).toMatchObject({
      ok: false,
      said: "npm's registry has no appdyno.",
      next: expect.stringContaining('npm config get registry') as unknown,
    });
  });

  it('shows what a server said as it stopped', async () => {
    entryWith({
      command: process.execPath,
      args: ['-e', 'console.error("boom"); process.exit(3)'],
    });
    expect(await tried(place())).toMatchObject({
      ok: false,
      said: 'It stopped before it answered.',
      tail: 'boom',
    });
  });

  it('wants a running server for a client in a browser', async () => {
    expect(
      await tried(place(), must(BROWSER_CLIENTS[0], 'a client in a browser').name),
    ).toMatchObject({
      ok: false,
      said: 'The server is not running.',
    });
  });

  it('tries a client from the Dock with what the Dock gives it', async () => {
    const dock = must(
      CLIENTS.find((c) => c.dock),
      'a client from the Dock',
    );
    const entry = join(home, must(dock.files[0], 'its file'));
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, JSON.stringify({ [dock.key]: { appdyno: { command: 'npx', args: [] } } }));
    expect(await tried(place(), dock.name)).toMatchObject({
      ok: false,
      said: 'It could not find npx.',
    });
  });
});

describe('the HTTP server', () => {
  it('starts, says its address, keeps its token out of what it lists, and stops', async () => {
    const p = place();
    expect((await act(p, 'list')).server).toEqual({});
    const started = await act(p, 'start');
    expect(started.server.address).toBe('http://127.0.0.1:8765/mcp');
    expect(JSON.stringify(started)).not.toContain(httpToken());
    expect((await act(p, 'stop')).server).toEqual({});
  });

  it('gives the token only when asked, whole, and for a copy marks it so', async () => {
    const p = place();
    expect((await act(p, 'token')).token).toBe(httpToken());
    expect(await act(p, 'copyToken')).toEqual({ copy: httpToken(), concealed: true });
  });

  it('keeps one token across starts, as a saved connector holds it, and makes a new one when told', async () => {
    const first = httpToken();
    expect(httpToken()).toBe(first);
    const p = place();
    await act(p, 'renewToken');
    expect(httpToken()).not.toBe(first);
    expect(httpToken()).toMatch(/^[\w.~-]{32,}$/);
    expect(renewHttpToken()).toBe(httpToken());
  });

  it('keeps the token out of its arguments, where `ps` would show it', async () => {
    const args = join(home, 'args');
    vi.stubEnv('FAKE_ARGS', args);
    const http = new HubHttp([process.execPath, fake, 'http']);
    await http.start();
    await vi.waitFor(() => expect(existsSync(args)).toBe(true));
    await http.stop();
    expect(readFileSync(args, 'utf8')).not.toContain(httpToken());
    expect(readFileSync(args, 'utf8')).toContain('--end-with-parent');
  });

  it("keeps the server to the hub's own devices and apps, by flag, which no server takes by itself", async () => {
    const args = join(home, 'args');
    vi.stubEnv('FAKE_ARGS', args);
    const policy = policyOf({ 'allow-devices': '^emulator-5554$', 'allow-apps': 'a.b, c.d' }, {});
    expect((await act(place({ policy }), 'start')).server.address).toBeDefined();
    await vi.waitFor(() => expect(existsSync(args)).toBe(true));
    expect(readFileSync(args, 'utf8')).toContain(
      'http --allow-devices ^emulator-5554$ --allow-apps a.b,c.d --http',
    );
  });

  it('starts once however often it is asked, and says it is on its way', async () => {
    const http = new HubHttp([process.execPath, fake, 'http']);
    const asked = [http.start(), http.start()];
    expect(http.state).toEqual({ starting: true });
    await Promise.all(asked);
    expect(http.state).toEqual({ address: 'http://127.0.0.1:8765/mcp' });
    await http.stop();
  });

  it('takes the next port when one is taken', async () => {
    vi.stubEnv('FAKE_TAKEN', '8765');
    const http = new HubHttp([process.execPath, fake, 'http']);
    await http.start();
    expect(http.address).toBe('http://127.0.0.1:8766/mcp');
    await http.stop();
    expect(http.address).toBeUndefined();
  });

  it('says why when it cannot start', async () => {
    const p = place({
      mcpCommand: [process.execPath, '-e', 'console.error("no"); process.exit(1)', '--'],
    });
    await act(p, 'start');
    expect(told.find((m) => m.serverFailed)).toMatchObject({ serverFailed: 'no' });
  });

  it('forgets a server that ended by itself', async () => {
    const http = new HubHttp([process.execPath, fake, 'http']);
    await http.start();
    const running = http as unknown as { child: { kill(): void } };
    running.child.kill();
    await vi.waitFor(() => expect(http.address).toBeUndefined());
  });

  it('goes with the hub', async () => {
    const p = place();
    await act(p, 'start');
    await p.end();
    expect((await act(p, 'list')).server).toEqual({});
  });
});

describe('Doctor', () => {
  it('gives its checks as they are', async () => {
    expect((await act(place(), 'doctor')).doctor).toEqual([
      { name: 'node', ok: true, detail: '22' },
    ]);
  });
});
