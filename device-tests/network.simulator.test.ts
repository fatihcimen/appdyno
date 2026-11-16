import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { checkedOps } from '@appdyno/testing/calls.js';
import { opCaller, SIM_FIXTURE, type Call } from './helpers.js';
import { Simctl, simulatorProvider, sleep } from './workspace.js';

/**
 * The network probe on a simulator (APPDYNO_IOS_UDID), through the `network` tool: headers and bodies kept and hidden,
 * a HAR that reads back, and nothing left once a capture ends.
 */
const udid = process.env.APPDYNO_IOS_UDID ?? '';
const APP = 'dev.appdyno.fixture';
const SECRET = 'gizli-kod-9911';

// the folder this suite's server runs in: a rule's file and a HAR are read and written inside it
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'appdyno-network-')));
const stateDir = join(dir, 'state');
process.env.APPDYNO_STATE_DIR = stateDir;

/** A server that counts what reaches it: JSON with a cookie on /json, the body back on /echo, 200 kB elsewhere. */
async function server(name: string) {
  const seen: string[] = [];
  const web = createServer((req, res) => {
    seen.push(`${req.method ?? ''} ${req.url ?? ''}`);
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.url?.startsWith('/big')) return res.end(Buffer.alloc(200_000, 7));
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Set-Cookie', 'session=server-cookie-55; Path=/');
      res.end(
        req.url?.startsWith('/echo')
          ? Buffer.concat(chunks)
          : JSON.stringify({ from: name, note: SECRET, api_key: 'server-key-0042' }),
      );
    });
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  const at = `127.0.0.1:${(web.address() as AddressInfo).port}`;
  return { at, seen, close: () => web.close() };
}

describe.skipIf(!udid)('the network probe on a simulator', () => {
  let ctx: ServerContext;
  let ok: Call;
  let call: Call;
  let a: Awaited<ReturnType<typeof server>>;
  let b: Awaited<ReturnType<typeof server>>;
  const cwd = process.cwd();

  const open = () => {
    ctx = new ServerContext({ ...DEFAULT_POLICY, secrets: [SECRET] }, [simulatorProvider()], {
      device: udid,
      app: APP,
    });
    call = opCaller(checkedOps(ctx));
    ok = async (name, args = {}) => {
      const r = await call(name, args);
      expect(r.error ? r.text : '').toBe('');
      return r;
    };
  };

  /** A request from the fixture's Network screen: what the screen then says of it. */
  const send = async (url: string, button: 'fetch' | 'post' = 'fetch') => {
    await ok('open_link', { url: 'appdyno-fixture://open/network' });
    await ok('type_text', { selector: { id: 'url_input' }, text: url, replace: true });
    await ok('tap', { selector: { id: button } });
    for (let i = 0; i < 40; i++) {
      // a label's own quotes come escaped
      const text = (await ok('screen')).text.replaceAll('\\"', '"');
      const said = /(fetched (\d+) (\d+) in (\d+) ms|failed: [^\n"]*)/.exec(text);
      if (said)
        return { text, said: String(said[1]), status: Number(said[2]), ms: Number(said[4]) };
      await sleep(500);
    }
    throw new Error(`no answer to ${url}`);
  };
  /** The folders of captures: the state of the one that runs is a file beside them. */
  const kept = () =>
    existsSync(join(stateDir, 'network'))
      ? readdirSync(join(stateDir, 'network')).filter((f) => !f.endsWith('.json'))
      : [];

  beforeAll(async () => {
    process.chdir(dir);
    [a, b] = await Promise.all([server('a'), server('b')]);
    await new Simctl().install(udid, SIM_FIXTURE);
    open();
    await ok('launch_app');
    return async () => {
      process.chdir(cwd);
      await ok('terminate_app').catch(() => undefined);
      ctx.close();
      a.close();
      b.close();
    };
  }, 240_000);

  it('keeps headers and bodies when asked, with what names a credential hidden', async () => {
    await ok('network', { action: 'start', via: 'probe', bodies: true });
    expect((await send(`http://${a.at}/echo?token=abc123`, 'post')).status).toBe(200);
    const list = await ok('network', { action: 'read', method: 'POST' });
    console.log(list.text);
    const id = /^(\d+) POST http:\/\/127\.0\.0\.1:\d+\/echo\?token=••• 200 \d+ ms \d+ B$/m.exec(
      list.text,
    )?.[1];
    expect(id).toBeDefined();
    const one = await ok('network', { action: 'read', id: Number(id) });
    console.log(one.text);
    expect(one.text).toMatch(/request headers:\n(.*\n)*? {2}Authorization: •••/);
    expect(one.text).toMatch(/request body \(47 B\):\n\{"user":"fixture","password":"•••"\}/);
    expect(one.text).toMatch(/response headers:\n(.*\n)*? {2}Set-Cookie: •••/);
    expect(one.text).toMatch(/response body \(47 B\):\n\{"user":"fixture","password":"•••"\}/);
    for (const hidden of ['fixture-bearer', 'fixture-pass-77', 'server-cookie-55', 'abc123'])
      expect(list.text + one.text).not.toContain(hidden);
    // what the server said with the policy's own secret in it, and a key by its name
    await send(`http://${a.at}/json`);
    const json = await ok('network', { action: 'read', contains: '/json' });
    const last = Number(/^(\d+) GET/m.exec(json.text)?.[1]);
    const said = await ok('network', { action: 'read', id: last });
    expect(said.text).toContain('"from":"a"');
    expect(said.text).not.toContain(SECRET);
    expect(said.text).not.toContain('server-key-0042');
    // a body that is no text is its size
    await send(`http://${a.at}/big`);
    const big = await ok('network', { action: 'read', contains: '/big' });
    const bytes = await ok('network', {
      action: 'read',
      id: Number(/^(\d+) GET/m.exec(big.text)?.[1]),
    });
    expect(bytes.text).toContain('response body: 200000 B, not text or not kept');
  }, 180_000);

  it('writes the capture as a HAR that reads back, as clean as an answer', async () => {
    const saved = await ok('network', { action: 'read', save: 'capture.har' });
    expect(saved.text).toMatch(/saved 3 requests as HAR 1\.2 in .*capture\.har/);
    const text = readFileSync(join(dir, 'capture.har'), 'utf8');
    const har = JSON.parse(text) as {
      log: {
        version: string;
        entries: {
          request: { method: string; postData?: { text: string } };
          response: { content: { text?: string } };
        }[];
      };
    };
    expect(har.log.version).toBe('1.2');
    const post = har.log.entries.find((e) => e.request.method === 'POST');
    expect(post?.request.postData?.text).toBe('{"user":"fixture","password":"•••"}');
    expect(post?.response.content.text).toContain('"user":"fixture"');
    for (const hidden of [
      'fixture-bearer',
      'fixture-pass-77',
      'server-cookie-55',
      'abc123',
      SECRET,
    ])
      expect(text).not.toContain(hidden);
    const again = await call('network', { action: 'read', save: 'capture.har' });
    expect(again.text).toMatch(/exists: overwrite true replaces it/);
    const back = await ok('network', { action: 'read', har: join(dir, 'capture.har') });
    console.log(back.text);
    expect(back.text).toMatch(/POST http:\/\/127\.0\.0\.1:\d+\/echo\?token=••• 200/);
    expect(back.text).toContain('3 of 3 from');
  });

  it('leaves no file once the capture stops, and the probe left in the app does nothing more', async () => {
    expect(kept()).toHaveLength(1);
    const stop = await ok('network', { action: 'stop' });
    expect(stop.text).toMatch(/stays in the app until it next starts, and does nothing more there/);
    expect(kept()).toEqual([]);
    expect((await send(`http://${a.at}/json`)).status).toBe(200);
    expect(kept()).toEqual([]);
  });
});
