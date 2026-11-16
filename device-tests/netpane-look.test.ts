import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { viewerTestBinary, ViewerProcess, type ViewerMessage } from '../packages/core/src/index.js';
import { simulatorProvider } from '../packages/driver-apple/src/index.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { runHub } from '../packages/hub/src/index.js';
import { checkedOps } from '@appdyno/testing/calls.js';
import { opCaller, SIM_FIXTURE, type Call } from './helpers.js';
import { Simctl } from './workspace.js';
import { untilWithin } from './until.js';

/**
 * How the Network pane looks, for a person to judge: the hub's real window kept off every screen, on a simulator
 * (APPDYNO_NETPANE_SIM) with the fixture's own requests in it, a picture of each state into the folder APPDYNO_NETPANE_SHOTS
 * names. APPDYNO_HUB_LOOK and APPDYNO_HUB_LANGUAGE say how it is drawn, and name each file. The window is the test
 * build's, which alone chooses a row by a message. Beside each picture stands every word it shows and where.
 *
 * Nothing here opens a menu: one would open on a person's screen. No request is copied: that is the pasteboard's.
 */
const udid = process.env.APPDYNO_NETPANE_SIM ?? '';
const shots = process.env.APPDYNO_NETPANE_SHOTS ?? '';
const look = process.env.APPDYNO_HUB_LOOK ?? 'light';
const language = process.env.APPDYNO_HUB_LANGUAGE ?? 'en';
const APP = 'dev.appdyno.fixture';
const main = join(import.meta.dirname, '../packages/appdyno/dist/main.js');
/** An address whose certificate the system trusts, for a host that is not this Mac. */
const TRUSTED = 'https://www.apple.com/library/test/success.html';
const LIVE_MS = 180_000;

const until = untilWithin(60_000);
const quiet = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Entry = {
  id: number;
  url?: string;
  status?: number;
  how?: string;
  error?: string;
  inFlight?: boolean;
};

describe.runIf(udid && shots)('the Network pane, looked at', () => {
  const told: ViewerMessage[] = [];
  const sent: Record<string, unknown>[] = [];
  /** Answers held until the run lets them go: a request stays in flight meanwhile. */
  const held: (() => void)[] = [];
  const web = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = req.url ?? '';
      if (path.startsWith('/v1/feed')) return void held.push(() => res.end('late'));
      if (path.startsWith('/v1/pay')) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        return res.end('{"error":"card_declined","retry":false}');
      }
      if (path.startsWith('/assets')) return res.end(Buffer.alloc(200_000, 7));
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Set-Cookie', 'session=server-cookie-55; Path=/');
      res.end(
        path.startsWith('/v1/login')
          ? Buffer.concat(chunks)
          : JSON.stringify({ items: [{ id: 7, name: 'Ada' }], api_key: 'server-key-0042' }),
      );
    });
  });
  let port = 0;
  let link: ViewerProcess;
  let done: Promise<number>;
  let ctx: ServerContext;
  let call: Call;

  const ok: Call = async (name, args = {}) => {
    const r = await call(name, args);
    expect(r.error ? r.text : '').toBe('');
    return r;
  };
  const poke = (m: Record<string, unknown>) => link.send({ op: 'poke', stage: udid, ...m });
  /** A real click on a control of the window, by its name: it must be found, and be what stands there. */
  const click = async (name: string) => {
    const from = told.length;
    poke({ clickOn: name });
    await until(`a click on ${name}`, () => told.slice(from).some((m) => m.op === 'clicked'));
    expect(told.slice(from).find((m) => m.op === 'clicked')?.found, name).toBeTruthy();
    await quiet(500);
  };
  const choose = async (row: string) => {
    const from = told.length;
    poke({ row });
    await until(`the row ${row}`, () => told.slice(from).some((m) => m.op === 'clicked'));
    expect(told.slice(from).find((m) => m.op === 'clicked')?.found, row).toBeTruthy();
    await quiet(1_500);
  };
  const network = (more: (m: Record<string, unknown>) => boolean = () => true) =>
    sent.filter((m) => m.op === 'network' && m.stage === udid && more(m));
  /** The requests the pane was last told of. */
  const entries = () => (network((m) => Array.isArray(m.entries)).at(-1)?.entries ?? []) as Entry[];
  const listed = (what: string, test: (e: Entry) => boolean) =>
    until(what, () => entries().some(test));
  /** The whole window, and every word it shows, as `<state>-<look>-<language>`. */
  const looked = async (state: string) => {
    await quiet(1_500);
    const file = join(shots, `${state}-${look}-${language}.png`);
    const from = told.length;
    link.send({ op: 'snapshot', file });
    await until('a picture', () => told.slice(from).some((m) => m.op === 'snapped'));
    const snapped = told.slice(from).find((m) => m.op === 'snapped') as unknown as {
      ok: boolean;
      parts: unknown;
    };
    expect(snapped.ok).toBe(true);
    writeFileSync(file.replace('.png', '.json'), JSON.stringify(snapped.parts));
  };
  /** A request from the fixture's Network screen, by the button that makes it; the screen is not waited for. */
  const send = async (url: string, button: 'fetch' | 'post' = 'fetch') => {
    await ok('type_text', { selector: { id: 'url_input' }, text: url, replace: true });
    await ok('tap', { selector: { id: button } });
  };

  beforeAll(async () => {
    mkdirSync(shots, { recursive: true });
    // a state of its own: another hub on this Mac keeps its captures, and this one's go with the folder
    process.env.APPDYNO_STATE_DIR = join(mkdtempSync(join(tmpdir(), 'appdyno-netpane-')), 'state');
    await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
    ({ port } = web.address() as AddressInfo);
    await new Simctl().install(udid, SIM_FIXTURE);
    const binary = await viewerTestBinary();
    const policy = { ...DEFAULT_POLICY, devices: new RegExp(`^${udid}$`) };
    ctx = new ServerContext(policy, [simulatorProvider()], {
      mirrorCommand: [process.execPath, main, 'mirror'],
      device: udid,
      app: APP,
    });
    call = opCaller(checkedOps(ctx));
    done = runHub(ctx, {
      focus: false,
      behind: true,
      log: () => undefined,
      viewer: () => {
        link = new ViewerProcess(binary, [
          '--hub',
          '--behind',
          '--appearance',
          look,
          ...(language === 'en' ? [] : ['-AppleLanguages', `(${language})`]),
        ]);
        link.onMessage((m) => told.push(m));
        const tell = link.send.bind(link);
        link.send = (m) => {
          sent.push(m);
          tell(m);
        };
        return link;
      },
    });
  }, 240_000);

  afterAll(async () => {
    for (const answer of held) answer();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- unset where beforeAll failed
    link?.send({ op: 'quit' });
    await done;
    web.close();
    ctx.close();
  }, 120_000);

  it(
    'shows each state of the pane, a picture of each',
    async () => {
      const live = () => told.some((m) => m.op === 'first' && m.stage === udid);
      for (let tries = 0; !live() && tries < 18; tries++) {
        link.send({ op: 'poke', id: udid });
        await quiet(10_000);
      }
      await until('the simulator live in the hub', live, LIVE_MS);
      await ok('launch_app');
      await ok('open_link', { url: 'appdyno-fixture://open/network' });
      await click('tabNetwork');
      await until('the ways it has', () => network((m) => Array.isArray(m.ways)).length > 0);
      await looked('empty');

      await click('networkBodies');
      await click('networkGo');
      await until(
        'a capture by the probe',
        () => network((m) => m.capturing === 'probe').length > 0,
        120_000,
      );
      // the probe restarted the app, which opens on its first screen
      await ok('open_link', { url: 'appdyno-fixture://open/network' });
      await looked('capturing-none');

      const here = `http://127.0.0.1:${port}`;
      const named = `http://localhost:${port}`;
      await send(`${here}/v1/items?page=2&token=s3cr3t`);
      await send(`${here}/v1/login`, 'post');
      await send(`${here}/assets/hero.png`);
      await send(`${named}/v1/pay`, 'post');
      await send(TRUSTED);
      // a port nothing listens on: refused on its way
      await send('http://127.0.0.1:9/v1/health');
      await ok('network', {
        action: 'mock',
        rules: [
          `"localhost:${port}/v1/profile" status=200 type="application/json" body="{\\"name\\":\\"Grace\\",\\"plan\\":\\"pro\\"}"`,
          `"localhost:${port}/v1/ads*" fail=offline`,
          `"127.0.0.1:${port}/v1/search*" delayMs=800 off`,
        ],
      });
      await send(`${named}/v1/profile`);
      await send(`${named}/v1/ads/banner`);
      await send(`${here}/v1/feed`);
      await listed('a request in flight', (e) => e.inFlight === true);
      await listed('one the server refused', (e) => e.status === 500);
      await listed('one that failed on its way', (e) => !!e.error && !e.how);
      await listed('one a rule answered', (e) => e.how === 'mocked');
      await listed('one a rule failed', (e) => e.how === 'failed');
      expect(new Set(entries().map((e) => new URL(e.url ?? '').host)).size).toBeGreaterThan(2);
      await looked('list');

      await choose('POST /v1/pay');
      await looked('failed');
      await choose('GET /v1/health');
      await looked('failed-on-its-way');
      await choose('GET /v1/profile');
      await looked('mocked');
      await choose('POST /v1/login');
      await until('its headers and bodies', () => network((m) => !!m.detail).length > 0);
      await looked('detail');
      await click('networkReal');
      await quiet(1_500);
      await looked('detail-real');
      await click('networkReal');

      await choose('POST /v1/pay');
      await click('networkMockFrom');
      await until(
        'a rule of its answer',
        () => network((m) => typeof m.rule === 'string').length > 0,
      );
      await looked('rules-line');
      // the first rule, as the op wrote its line
      const { rules } = network((m) => Array.isArray(m.rules)).at(-1) as {
        rules: { rule: string }[];
      };
      await choose(String(rules[0]?.rule));
      await click('networkRuleFields');
      await looked('rules-fields');
      await click('networkRuleFields');

      await click('networkShowRequests');
      await ok('network', { action: 'throttle', throttle: '3g' });
      await until('the speed set', () => network((m) => m.throttle === '3g').length > 0);
      await looked('speed');

      for (const answer of held.splice(0)) answer();
      await ok('network', { action: 'throttle', throttle: 'full' });
      const before = sent.length;
      await click('networkGo');
      await until('the capture to stop', () =>
        sent.slice(before).some((m) => m.op === 'network' && m.capturing === false),
      );
      await looked('stopped');
    },
    6 * LIVE_MS,
  );
});
