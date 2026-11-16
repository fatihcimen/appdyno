import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
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
 * a HAR that reads back, each kind of rule, the throttle, and nothing left once a capture or a session ends.
 */
const udid = process.env.APPDYNO_IOS_UDID ?? '';
const APP = 'dev.appdyno.fixture';
const SECRET = 'gizli-kod-9911';
/** An address whose certificate the system trusts, for the one case that is about trust: not held to where it does not answer. */
const TRUSTED =
  process.env.APPDYNO_TRUSTED_URL ?? 'https://www.apple.com/library/test/success.html';
const OUT = process.env.APPDYNO_NETWORK_OUT;
const out = (line: string) => OUT && appendFileSync(OUT, `${line}\n`);

// the folder this suite's server runs in: a rule's file and a HAR are read and written inside it
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'appdyno-network-')));
const stateDir = join(dir, 'state');
process.env.APPDYNO_STATE_DIR = stateDir;

/** A server that counts what reaches it: JSON with a cookie on /json, the body back on /echo, 200 kB elsewhere. */
async function server(name: string) {
  const seen: string[] = [];
  const held: (() => void)[] = [];
  /** The headers of each request to /headers, as the server got them. */
  const asked: Record<string, unknown>[] = [];
  const web = createServer((req, res) => {
    seen.push(`${req.method ?? ''} ${req.url ?? ''}`);
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.url?.startsWith('/big')) return res.end(Buffer.alloc(200_000, 7));
      // what it was asked with, how much it was sent, and an answer that comes too late for a hurried session
      if (req.url?.startsWith('/headers')) {
        asked.push(req.headers);
        return res.end('ok');
      }
      if (req.url?.startsWith('/size')) {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ got: Buffer.concat(chunks).length }));
      }
      // refused by the server itself, as a fault of its own
      if (req.url?.startsWith('/fail')) {
        res.statusCode = 500;
        return res.end('{"error":"boom"}');
      }
      if (req.url?.startsWith('/slow')) return void setTimeout(() => res.end('slow'), 5_000);
      // answered only when the test lets it go
      if (req.url?.startsWith('/hang')) return void held.push(() => res.end('late'));
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Set-Cookie', 'session=server-cookie-55; Path=/');
      res.end(
        req.url?.startsWith('/echo')
          ? Buffer.concat(chunks)
          : JSON.stringify({ from: name, note: SECRET, api_key: 'server-key-0042' }),
      );
    });
  });
  /** Each address a WebSocket task asked to be upgraded at: it is refused, as nothing here speaks it. */
  const upgrades: string[] = [];
  web.on('upgrade', (req, socket) => {
    upgrades.push(req.url ?? '');
    // the handshake a WebSocket asks for, then one text frame
    const accept = createHash('sha1')
      .update(`${String(req.headers['sec-websocket-key'])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.write(Buffer.concat([Buffer.from([0x81, 5]), Buffer.from('hello')]));
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  const at = `127.0.0.1:${(web.address() as AddressInfo).port}`;
  return { at, seen, held, asked, upgrades, close: () => web.close() };
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
  const send = async (
    url: string,
    button: 'fetch' | 'post' | 'upload' | 'config' | 'pin' = 'fetch',
  ) => {
    await ok('open_link', { url: 'appdyno-fixture://open/network' });
    await ok('type_text', { selector: { id: 'url_input' }, text: url, replace: true });
    await ok('tap', { selector: { id: button } });
    for (let i = 0; i < 40; i++) {
      // a label's own quotes come escaped
      const text = (await ok('screen')).text.replaceAll('\\"', '"');
      // a long failure is cut on the screen before its time
      const said = /(fetched (\d+) (\d+) in (\d+) ms|failed: [^\n"]*)/.exec(text);
      if (said)
        return {
          text,
          said: String(said[1]),
          status: Number(said[2]),
          ms: Number(said[4] ?? / in (\d+) ms/.exec(String(said[1]))?.[1]),
        };
      await sleep(500);
    }
    throw new Error(`no answer to ${url}`);
  };
  const rules = (...lines: string[]) => ok('capture_network', { action: 'mock', rules: lines });
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

  /** Whether the trusted address answers from this Mac: the simulator has the Mac's network. */
  const trusted = () =>
    fetch(TRUSTED).then(
      (r) => r.ok,
      () => false,
    );

  /** What the fixture's other ways of asking come to: with the probe in the app, or without. */
  const ways = async (label: string) => {
    const headers = await send(`http://${a.at}/headers`, 'config');
    const slow = await send(`http://${a.at}/slow`, 'config');
    const upload = await send(`http://${a.at}/size`, 'upload');
    const pin = await send(TRUSTED, 'pin');
    const got = a.asked.at(-1) ?? {};
    out(`WAYS ${label}: headers ${headers.said} ${JSON.stringify(got)}`);
    out(`WAYS ${label}: slow ${slow.said}`);
    out(`WAYS ${label}: upload ${upload.said} ${/\{"got":\d+\}/.exec(upload.text)?.[0] ?? ''}`);
    out(`WAYS ${label}: pin ${pin.said}`);
    return { headers: got, slow, upload, pin };
  };

  it('asks as an app does without the probe: its session adds headers and gives up, its delegate refuses a server', async () => {
    const { headers, slow, upload, pin } = await ways('without the probe');
    expect(headers).toMatchObject({
      'x-fixture-config': 'on',
      authorization: 'Bearer config-bearer-0123456789',
    });
    expect(slow.said).toMatch(/^failed: The request timed out/);
    expect(slow.ms).toBeLessThan(4_000);
    expect(upload.text).toContain('{"got":100000}');
    // a server the system trusts, refused by the app's own check
    if (await trusted()) expect(pin.said).toMatch(/^failed: cancelled/);
  }, 180_000);

  it('keeps headers and bodies when asked, with what names a credential hidden', async () => {
    await ok('capture_network', { action: 'start', via: 'probe', bodies: true });
    expect((await send(`http://${a.at}/echo?token=abc123`, 'post')).status).toBe(200);
    const list = await ok('capture_network', { action: 'read', method: 'POST' });
    console.log(list.text);
    const id = /^(\d+) POST http:\/\/127\.0\.0\.1:\d+\/echo\?token=••• 200 \d+ ms \d+ B$/m.exec(
      list.text,
    )?.[1];
    expect(id).toBeDefined();
    const one = await ok('capture_network', { action: 'read', id: Number(id) });
    console.log(one.text);
    expect(one.text).toMatch(/request headers:\n(.*\n)*? {2}Authorization: •••/);
    expect(one.text).toMatch(/request body \(47 B\):\n\{"user":"fixture","password":"•••"\}/);
    expect(one.text).toMatch(/response headers:\n(.*\n)*? {2}Set-Cookie: •••/);
    expect(one.text).toMatch(/response body \(47 B\):\n\{"user":"fixture","password":"•••"\}/);
    for (const hidden of ['fixture-bearer', 'fixture-pass-77', 'server-cookie-55', 'abc123'])
      expect(list.text + one.text).not.toContain(hidden);
    // what the server said with the policy's own secret in it, and a key by its name
    await send(`http://${a.at}/json`);
    const json = await ok('capture_network', { action: 'read', contains: '/json' });
    const last = Number(/^(\d+) GET/m.exec(json.text)?.[1]);
    const said = await ok('capture_network', { action: 'read', id: last });
    expect(said.text).toContain('"from":"a"');
    expect(said.text).not.toContain(SECRET);
    expect(said.text).not.toContain('server-key-0042');
    // a body that is no text is its size
    await send(`http://${a.at}/big`);
    const big = await ok('capture_network', { action: 'read', contains: '/big' });
    const bytes = await ok('capture_network', {
      action: 'read',
      id: Number(/^(\d+) GET/m.exec(big.text)?.[1]),
    });
    expect(bytes.text).toContain('response body: 200000 B, not text or not kept');
  }, 180_000);

  it("says what of an app's own session holds under the probe, and what does not", async () => {
    const { headers, slow, upload, pin } = await ways('with the probe');
    // the headers its configuration adds still reach the server, and its own time to give up still holds
    expect(headers).toMatchObject({
      'x-fixture-config': 'on',
      authorization: 'Bearer config-bearer-0123456789',
    });
    expect(slow.said).toMatch(/^failed: The request timed out/);
    expect(slow.ms).toBeLessThan(4_000);
    // an upload longer than what is kept goes on whole, and is not held to be kept
    expect(upload.text).toContain('{"got":100000}');
    const whole = async (part: string) => {
      const read = await ok('capture_network', { action: 'read', contains: part });
      const one = await ok('capture_network', {
        action: 'read',
        id: Number(/^(\d+) (GET|POST)/m.exec(read.text)?.[1]),
      });
      out(one.text);
      return one.text;
    };
    expect(await whole('/size')).toContain('request body: 100000 B, not text or not kept');
    // and the probe has those added headers with the request: it lists them, a credential hidden
    const asked = await whole('/headers');
    expect(asked).toContain('  X-Fixture-Config: on');
    expect(asked).toContain('  Authorization: •••');
    expect(asked).not.toContain('config-bearer');
    // the app's delegate refused this server before; under the probe it is not asked, and the request goes through
    if (await trusted()) expect(pin.said).toMatch(/^fetched 200/);
    const paths = await ok('capture_network', { action: 'paths' });
    expect(paths.text).toMatch(
      /^probe: .*the app's own check of a server's certificate \(pinning\) and its answers to a login or client-certificate challenge are not asked/m,
    );
  }, 180_000);

  it('shows a request that has not ended, and what the session measured of one that has', async () => {
    await ok('open_link', { url: 'appdyno-fixture://open/network' });
    await ok('type_text', {
      selector: { id: 'url_input' },
      text: `http://${a.at}/hang`,
      replace: true,
    });
    await ok('tap', { selector: { id: 'fetch' } });
    await sleep(1500);
    const during = await ok('capture_network', { action: 'read' });
    expect(during.text).toMatch(/\nin flight: 1 \(GET http:\/\/127\.0\.0\.1:\d+\/hang \d+ ms\)$/);
    a.held.splice(0).forEach((end) => end());
    await sleep(1000);
    const after = await ok('capture_network', { action: 'read', contains: '/hang' });
    expect(after.text).not.toContain('in flight');
    const id = Number(/^(\d+) GET .*\/hang 200 (\d+) ms 4 B$/m.exec(after.text)?.[1]);
    const one = await ok('capture_network', { action: 'read', id });
    expect(one.text.split('\n')[1]).toMatch(
      /^http\/1\.1, connection (reused|new), (dns \d+ ms, )?(connect \d+ ms, )?wait \d+ ms, receive \d+ ms, 4 B on the wire, 127\.0\.0\.1 \(the probe's own connection, not the app's\)$/,
    );
  }, 120_000);

  it('writes the capture as a HAR that reads back, as clean as an answer', async () => {
    const saved = await ok('capture_network', { action: 'read', save: 'capture.har' });
    expect(saved.text).toMatch(/saved \d+ requests as HAR 1\.2 in .*capture\.har/);
    const text = readFileSync(join(dir, 'appdyno-network/capture.har'), 'utf8');
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
    const again = await call('capture_network', { action: 'read', save: 'capture.har' });
    expect(again.text).toMatch(/exists: overwrite true replaces it/);
    const back = await ok('capture_network', {
      action: 'read',
      har: join(dir, 'appdyno-network/capture.har'),
    });
    console.log(back.text);
    expect(back.text).toMatch(/\n127\.0\.0\.1:\d+:\n {2}POST \/echo\?token 200/);
    expect(back.text).toMatch(/^(\d+) of \1 from/);
  });

  it('leaves no file once the capture stops, and the probe left in the app does nothing more', async () => {
    expect(kept()).toHaveLength(1);
    const stop = await ok('capture_network', { action: 'stop' });
    expect(stop.text).toMatch(/stays in the app until it next starts, and does nothing more there/);
    expect(kept()).toEqual([]);
    expect((await send(`http://${a.at}/json`)).status).toBe(200);
    expect(kept()).toEqual([]);
  });

  it('answers in place of the server by a rule, and says so', async () => {
    // a path is taken as it is written, a host in any case
    await rules(`${a.at}/JSON status=503`);
    expect((await send(`http://${a.at}/json`)).status).toBe(200);
    await rules(`${a.at.toUpperCase()}/json status=503 body="{\\"error\\":\\"down\\"}"`);
    const before = a.seen.length;
    const got = await send(`http://${a.at}/json`);
    expect(got.status).toBe(503);
    expect(got.text).toContain('{"error":"down"}');
    expect(a.seen.length).toBe(before);
    const read = await ok('capture_network', { action: 'read', status: '5xx' });
    console.log(read.text);
    expect(read.text).toMatch(/GET http:\/\/127\.0\.0\.1:\d+\/json 503 \d+ ms 16 B \[mocked\]/);
    expect(read.text).toMatch(/^rule 1: .* \(1 taken\)$/m);
  });

  it('takes a request by its method, its query and a pattern of its path, a file for its answer, and runs out', async () => {
    writeFileSync(join(dir, 'items.json'), '{"items":["from the file"]}');
    await rules(
      `${a.at}/json query="page=2" method=GET body=@items.json times=1`,
      `${a.at} regex="/v\\\\d+/items" status=201 body=made type=text/plain header="X-Rule: two"`,
    );
    expect((await send(`http://${a.at}/json?page=1`)).text).toContain('"from":"a"');
    expect((await send(`http://${a.at}/json?x=1&page=2`)).text).toContain('from the file');
    // once, as it says
    expect((await send(`http://${a.at}/json?page=2`)).text).toContain('"from":"a"');
    const made = await send(`http://${a.at}/v2/items`);
    expect(made.status).toBe(201);
    expect(made.text).toContain('made');
    const outside = await call('capture_network', {
      action: 'mock',
      rules: [`${a.at}/x body=@/etc/hosts`],
    });
    expect(outside.text).toMatch(/outside the folder this server runs in/);
    const none = await call('capture_network', { action: 'mock', rules: [`${a.at}/x`] });
    expect(none.text).toMatch(/say what it does/);
    const far = await call('capture_network', {
      action: 'mock',
      rules: [`${a.at} to=evil.example`],
    });
    expect(far.text).toMatch(/a rule sends requests only to this Mac or its own network/);
  }, 180_000);

  it('fails a request, sends one to another host, delays one, and leaves one that is off alone', async () => {
    await rules(
      `${a.at}/offline fail=offline`,
      // a bare localhost is this Mac in plain HTTP, whatever the app asked by
      `${a.at}/moved to=localhost:${String(b.at.split(':')[1])}`,
      `${a.at}/late delayMs=1500`,
      `${a.at}/json status=500 off`,
    );
    expect((await send(`http://${a.at}/offline`)).said).toMatch(/^failed: /);
    const moved = await send(`http://${a.at}/moved`);
    expect(moved.text).toContain('"from":"b"');
    expect(b.seen.at(-1)).toBe('GET /moved');
    const late = await send(`http://${a.at}/late`);
    expect(late.status).toBe(200);
    expect(late.ms).toBeGreaterThanOrEqual(1500);
    expect((await send(`http://${a.at}/json`)).status).toBe(200);
    const read = await ok('capture_network', { action: 'read' });
    console.log(read.text);
    expect(read.text).toMatch(/\/offline \d+ ms 0 B failed: .* \[failed by a rule\]/);
    expect(read.text).toMatch(/\/moved 200 .* \[sent to 127\.0\.0\.1\]/);
    expect(read.text).toMatch(/\/late 200 .* \[delayed by a rule\]/);
    expect(read.text).toMatch(/^rule 4 \(off\): .* \(0 taken\)$/m);
    // held back longer than the app's session waits: the app gives it up, and so does the log
    await rules(`${a.at}/headers delayMs=5000`);
    const given = await send(`http://${a.at}/headers`, 'config');
    expect(given.said).toMatch(/^failed: The request timed out/);
    const after = await ok('capture_network', {
      action: 'read',
      contains: '/headers',
      status: 'failed',
    });
    expect(after.text).not.toContain('in flight');
    expect(after.text).toMatch(/GET http:\/\/127\.0\.0\.1:\d+\/headers \d+ ms 0 B failed: /);
  }, 180_000);

  it('keeps its rules in the app started again, and adds to them', async () => {
    await rules(`${a.at}/json status=418 body=teapot`);
    await ok('launch_app', { restart: true });
    expect((await send(`http://${a.at}/json`)).status).toBe(418);
    await ok('capture_network', { action: 'mock', rules: [`${a.at}/more status=204`], add: true });
    const listed = await ok('capture_network', { action: 'mock' });
    console.log(listed.text);
    expect(listed.data.rules?.map((r) => r.hits)).toEqual([1, 0]);
    expect((await send(`http://${a.at}/more`)).status).toBe(204);
    await rules();
    expect((await send(`http://${a.at}/json`)).status).toBe(200);
  }, 180_000);

  it('slows the app: a wait before each request, a speed down, and requests lost', async () => {
    const quick = await send(`http://${a.at}/big`);
    console.log('full', quick.said);
    const waits = await ok('capture_network', { action: 'throttle', throttle: 'delayMs=800' });
    console.log(waits.text);
    expect((await send(`http://${a.at}/json`)).ms).toBeGreaterThanOrEqual(800);
    // 200 kB at 100 kB a second
    await ok('capture_network', { action: 'throttle', throttle: 'down=100000' });
    const paced = await send(`http://${a.at}/big`);
    console.log('100 kB/s', paced.said);
    expect(paced.ms).toBeGreaterThanOrEqual(1800);
    expect(paced.ms).toBeLessThan(4000);
    await ok('capture_network', { action: 'throttle', throttle: 'slow' });
    const slow = await send(`http://${a.at}/json`);
    console.log('slow', slow.said);
    expect(slow.ms).toBeGreaterThanOrEqual(40);
    await ok('capture_network', { action: 'throttle', throttle: 'loss=100' });
    expect((await send(`http://${a.at}/json`)).said).toMatch(/^failed: /);
    const read = await ok('capture_network', { action: 'read', status: 'failed', limit: 1 });
    expect(read.text).toMatch(/\[lost by the throttle\]\nthrottle: loss=100$/);
    expect((await ok('capture_network', { action: 'throttle' })).data.throttle).toBe('loss=100');
    await ok('capture_network', { action: 'throttle', throttle: 'full' });
    expect((await send(`http://${a.at}/json`)).status).toBe(200);
    const wrong = await call('capture_network', { action: 'throttle', throttle: 'warp' });
    expect(wrong.text).toMatch(/throttle is full, slow, gsm/);
    // a stop ends it with the capture: the probe left in the app waits no more
    await ok('capture_network', { action: 'throttle', throttle: 'delayMs=2000' });
    await ok('capture_network', { action: 'stop' });
    expect((await send(`http://${a.at}/json`)).ms).toBeLessThan(1500);
    expect(kept()).toEqual([]);
  }, 240_000);

  it('says a request that failed with the tap that made it, and under strict refuses the tap', async () => {
    await ok('network', { action: 'start', via: 'probe' });
    /** The fixture's Fetch pressed for an address, and the tap after it: what both answered. */
    const fetched = async (path: string) => {
      await ok('open_link', { url: 'appdyno-fixture://open/network' });
      await ok('type_text', {
        selector: { id: 'url_input' },
        text: `http://${a.at}${path}`,
        replace: true,
      });
      const tap = await call('tap', { selector: { id: 'fetch' } });
      await sleep(1_000);
      // an answer slower than the screen is told with the next action
      return [tap, await call('tap', { selector: { id: 'fetch_result' } })] as const;
    };
    const [tap, next] = await fetched('/fail');
    out(
      `FAILED tap: ${tap.text.split('\n').find((l) => l.startsWith('network:')) ?? 'not in its answer'}`,
    );
    expect(`${tap.text}\n${next.text}`).toMatch(
      /^network: GET 127\.0\.0\.1:\d+\/fail 500 \(id \d+(, before this action)?\)$/m,
    );
    expect(tap.error).toBe(false);
    // a request that went well costs the answer nothing
    const [well, after] = await fetched('/json?n=1');
    expect(`${well.text}${after.text}`).not.toContain('network:');
    const on = await ok('network', { action: 'mock', strict: true });
    expect(on.text).toMatch(/^strict on: /);
    const [refused, late] = await fetched('/fail?n=2');
    const strict = refused.error ? refused : late;
    out(`STRICT ${strict.text.replaceAll('\n', ' | ')}`);
    expect(strict.data.code).toBe('CHECK_FAILED');
    expect(strict.text).toMatch(
      /^tapped .*\nnetwork strict: GET 127\.0\.0\.1:\d+\/fail 500 \(id \d+/,
    );
    // one a rule of one's own made is said, and fails nothing
    await ok('network', { action: 'mock', rules: [`${a.at}/json status=503`] });
    const [mocked, then] = await fetched('/json');
    expect(mocked.error || then.error).toBe(false);
    expect(`${mocked.text}\n${then.text}`).toMatch(/\/json 503 \[mocked\] \(id \d+/);
    await ok('network', { action: 'stop' });
  }, 180_000);

  it('waits for a request and checks it, and says of a miss what came nearest', async () => {
    await ok('network', { action: 'start', via: 'probe', bodies: true });
    expect((await send(`http://${a.at}/echo`, 'post')).status).toBe(200);
    const found = await ok('network', {
      action: 'check',
      contains: '/echo',
      method: 'POST',
      status: '2xx',
      has: 'user=fixture',
    });
    out(`CHECK ${found.text}`);
    expect(found.text).toMatch(/^found: \d+ POST http:\/\/127\.0\.0\.1:\d+\/echo 200 \d+ ms 47 B$/);
    await ok('network', { action: 'check', contains: '/echo', has: 'response: user=fixture' });
    const miss = await call('network', {
      action: 'check',
      contains: '/echo',
      has: 'user=someone',
      timeoutMs: 500,
    });
    out(`CHECK miss: ${miss.text}`);
    expect(miss.data.code).toBe('CHECK_FAILED');
    expect(miss.text).toMatch(
      /nearest: POST 127\.0\.0\.1:\d+\/echo 200 \(id \d+\): its request body has \{"user":"fixture"\}$/,
    );
    const hidden = await call('network', {
      action: 'check',
      contains: '/echo',
      has: 'password=x',
      timeoutMs: 0,
    });
    expect(hidden.text).toMatch(/its request body has \{"password":"•••"\}$/);
    // one that has not ended when the check begins: the server answers it five seconds on
    const last = Number(/found: (\d+)/.exec(found.text)?.[1]);
    await ok('open_link', { url: 'appdyno-fixture://open/network' });
    await ok('type_text', {
      selector: { id: 'url_input' },
      text: `http://${a.at}/slow`,
      replace: true,
    });
    await ok('tap', { selector: { id: 'fetch' } });
    const began = Date.now();
    const waited = await ok('network', {
      action: 'check',
      contains: '/slow',
      status: '200',
      after: last,
      timeoutMs: 20_000,
    });
    out(`CHECK waited ${Date.now() - began} ms: ${waited.text}`);
    expect(Date.now() - began).toBeGreaterThan(1_000);
    await ok('network', { action: 'stop' });
  }, 180_000);

  it('takes a request by what its body holds and by a header it carries', async () => {
    await ok('network', { action: 'start', via: 'probe' });
    // the first that fits wins: the fixture posts {"user":"fixture","password":…} with an Authorization header
    await rules(
      `${a.at}/echo has=user=someone status=418`,
      `${a.at}/echo has=user=fixture has="\\"password\\"" status=202 body=matched`,
      `${a.at}/json when="Authorization: Bearer fixture-*" status=203`,
      `${a.at}/json when="Authorization: Basic *" status=418`,
    );
    const post = await send(`http://${a.at}/echo`, 'post');
    out(`HAS post ${post.said}`);
    expect(post.status).toBe(202);
    // with no body, and with no such header, the server answers
    expect((await send(`http://${a.at}/echo`)).status).toBe(200);
    expect((await send(`http://${a.at}/json`)).status).toBe(200);
    expect((await send(`http://${a.at}/json`, 'post')).status).toBe(203);
    const listed = await ok('network', { action: 'mock' });
    out(`HAS ${listed.text.replaceAll('\n', ' | ')}`);
    expect(listed.data.rules?.map((r) => r.hits)).toEqual([0, 1, 1, 0]);
    await ok('network', { action: 'stop' });
  }, 180_000);

  it('makes a rule of an answer it saw, replays a HAR it saved, and fails what no rule takes', async () => {
    await ok('network', { action: 'start', via: 'probe', bodies: true });
    expect((await send(`http://${a.at}/json`)).status).toBe(200);
    const seen = await ok('network', { action: 'read', contains: '/json' });
    const id = /^(\d+) GET/m.exec(seen.text)?.[1];
    const made = await ok('network', { action: 'mock', from: String(id) });
    out(`FROM ${made.text.replaceAll('\n', ' | ')}`);
    const file = /body=@(\S+\.json)/.exec(made.data.added?.[0] ?? '')?.[1] ?? '';
    // the answer as the server gave it, less what names a credential and the policy's own secret
    expect(readFileSync(file, 'utf8')).toBe('{"from":"a","note":"•••","api_key":"•••"}');
    const before = a.seen.length;
    const again = await send(`http://${a.at}/json`);
    expect(again.status).toBe(200);
    expect(again.text).toContain('{"from":"a","note":"•••"');
    expect(a.seen.length).toBe(before);
    // the capture kept as a file, and its answers given again from the file with the server left out
    await ok('network', { action: 'mock', rules: [] });
    await ok('network', { action: 'read', save: 'replay.har', contains: '/json' });
    const replay = await ok('network', {
      action: 'mock',
      from: 'replay.har',
      unmatched: 'fail',
      strict: true,
    });
    out(`FROM har: ${replay.text.replaceAll('\n', ' | ')}`);
    expect(replay.data.added).toHaveLength(1);
    expect((await send(`http://${a.at}/json`)).status).toBe(200);
    expect(a.seen.length).toBe(before);
    // what the recording lacks fails, is marked, and under strict fails the tap that asked for it
    await ok('open_link', { url: 'appdyno-fixture://open/network' });
    await ok('type_text', {
      selector: { id: 'url_input' },
      text: `http://${a.at}/headers`,
      replace: true,
    });
    const tap = await call('tap', { selector: { id: 'fetch' } });
    await sleep(1_000);
    const late = tap.error ? tap : await call('tap', { selector: { id: 'fetch_result' } });
    out(`UNMATCHED ${late.text.replaceAll('\n', ' | ')}`);
    expect(late.data.code).toBe('CHECK_FAILED');
    expect(late.text).toMatch(
      /network strict: GET 127\.0\.0\.1:\d+\/headers failed: .* \[failed: no rule took it\]/,
    );
    expect(a.seen.length).toBe(before);
    await ok('network', { action: 'mock', unmatched: 'pass', strict: false });
    expect((await send(`http://${a.at}/headers`)).status).toBe(200);
    await ok('network', { action: 'stop' });
  }, 240_000);

  it('reads a body in part: one value, its shape, and what differs between two requests', async () => {
    await ok('network', { action: 'start', via: 'probe', bodies: true });
    await send(`http://${a.at}/json`);
    await send(`http://${a.at}/json?n=2`);
    const read = async (args: Record<string, unknown>) =>
      (await ok('network', { action: 'read', ...args })).text.split('\n').slice(1);
    expect(await read({ id: 0, path: 'from' })).toEqual(['response from: "a"']);
    expect(await read({ id: 0, path: 'api_key' })).toEqual(['response api_key: •••']);
    const shape = await read({ id: 0, shape: true });
    out(`BODY shape: ${shape.join(' | ')}`);
    expect(shape).toEqual(['response body shape: {from: string, note: string, api_key: string}']);
    const diff = await read({ id: 1, diff: 0 });
    out(`BODY diff: ${diff.join(' | ')}`);
    expect(diff).toEqual(['0 → 1: 1 differ', 'request.query.n: none → "2"']);
    const whole = await ok('network', { action: 'read', id: 0 });
    out(`BODY sizes: whole ${whole.text.length}, shape ${shape.join('\n').length}, path 18`);
    await ok('network', { action: 'stop' });
  }, 180_000);

  it('says what the app made that it cannot see: a web view, a background session, a WebSocket task', async () => {
    /** The fixture's Others pressed: what its WebSocket task was sent, or how it failed. */
    const others = async () => {
      await ok('open_link', { url: 'appdyno-fixture://open/network' });
      await ok('type_text', {
        selector: { id: 'url_input' },
        text: `http://${a.at}/ws`,
        replace: true,
      });
      await ok('tap', { selector: { id: 'others' } });
      for (let i = 0; i < 30; i++) {
        const said = /socket (said|failed)[^"\n]*/.exec((await ok('screen')).text)?.[0];
        if (said) return said;
        await sleep(500);
      }
      return 'socket said nothing';
    };
    // as an app's own, with no probe in it
    await ok('launch_app', { restart: true });
    expect(await others()).toBe('socket said hello');
    await ok('network', { action: 'start', via: 'probe', bodies: true });
    expect((await send(`http://${a.at}/json`)).status).toBe(200);
    expect((await ok('network', { action: 'read' })).text).not.toContain('not seen here');
    const said = await others();
    const read = await ok('network', { action: 'read' });
    out(`UNSEEN with the probe: ${said}`);
    out(`UNSEEN ${read.text.replaceAll('\n', ' | ')}`);
    expect(read.text).toMatch(
      /\nnot seen here: 1 web view, 1 background session, 1 WebSocket task$/,
    );
    expect(read.data.unseen).toEqual({ webview: 1, background: 1, websocket: 1 });
    // left to the system, the socket opens as it does with no probe, and the list has no line of it
    expect(said).toBe('socket said hello');
    expect(read.text).not.toContain('/ws');
    await ok('network', { action: 'stop' });
  }, 180_000);

  it('starts a capture for a rule where none runs, and a session that ends takes it all back', async () => {
    await call('capture_network', { action: 'stop' });
    const set = await rules(`${a.at}/json status=500`);
    expect(set.text).toMatch(
      /^started a capture by the probe: dev\.appdyno\.fixture was restarted with it/,
    );
    expect((await send(`http://${a.at}/json`)).status).toBe(500);
    const done = await ctx.end();
    console.log(done);
    expect(kept()).toEqual([]);
    open();
    expect((await send(`http://${a.at}/json`)).status).toBe(200);
    expect(kept()).toEqual([]);
  }, 180_000);
});
