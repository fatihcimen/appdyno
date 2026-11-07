import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir, networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { checkedOps } from '../packages/ops/test/helpers.js';
import { opCaller, type Call } from './helpers.js';
import {
  Adb,
  androidProvider,
  iphoneProvider,
  simulatorProvider,
  decodePng,
  Devicectl,
  PERFETTO,
} from './workspace.js';
import { untilWithin } from './until.js';

/**
 * Evidence on real devices, through the operations an agent calls and, where a recording must outlive its
 * process, the built command line: one suite per platform, each on the device its variable names.
 */
const APP = 'dev.appdyno.fixture';
const CLI = fileURLToPath(new URL('../packages/appdyno/dist/main.js', import.meta.url));
const LONG_MS = 300_000;

const dir = mkdtempSync(join(tmpdir(), 'appdyno-evidence-'));
const stateDir = join(dir, 'state');
// the suite has a state folder of its own, the tools downloaded for this machine stay in theirs
const tools = join(
  homedir(),
  `Library/Caches/appdyno/tools/perfetto-${PERFETTO.version}/mac-arm64/trace_processor_shell`,
);
if (existsSync(tools)) process.env.APPDYNO_TRACE_PROCESSOR ??= tools;
process.env.APPDYNO_STATE_DIR = stateDir;

const ffprobe = (() => {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** Plays the file through a real decoder where one is here; every frame decodes or this throws. */
function assertPlayable(file: string, minSeconds = 0) {
  expect(existsSync(file), file).toBe(true);
  expect(statSync(file).size).toBeGreaterThan(0);
  if (ffprobe) {
    const out = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-count_frames',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,nb_read_frames:format=duration',
        '-of',
        'json',
        file,
      ],
      { encoding: 'utf8' },
    );
    const j = JSON.parse(out) as {
      streams: { codec_name: string; nb_read_frames: string }[];
      format: { duration: string };
    };
    expect(j.streams[0]!.codec_name).toBe('h264');
    expect(Number(j.streams[0]!.nb_read_frames)).toBeGreaterThan(0);
    expect(Number(j.format.duration)).toBeGreaterThanOrEqual(minSeconds);
    return j;
  }
  const out = execFileSync('mdls', ['-name', 'kMDItemDurationSeconds', '-raw', file], {
    encoding: 'utf8',
  });
  expect(Number(out)).toBeGreaterThanOrEqual(minSeconds);
  return undefined;
}

function harness(serial: string, provider: ConstructorParameters<typeof ServerContext>[1][number]) {
  const ctx = new ServerContext({ ...DEFAULT_POLICY, secrets: ['gizli-kod-9911'] }, [provider], {
    device: serial,
    app: APP,
    share: true,
  });
  const call = opCaller(checkedOps(ctx));
  const ok: Call = async (name, args = {}) => {
    const r = await call(name, args);
    expect(r.error ? r.text : '').toBe('');
    return r;
  };
  return { ctx, call, ok };
}

/** A runner's start says how far it has got on stderr: anything else there is a fault. */
const faults = (err: string) =>
  err
    .split('\n')
    .filter((l) => l && !l.startsWith('{"runner"'))
    .join('\n');

const cli = (serial: string, ...args: string[]) =>
  new Promise<{ code: number; out: string; err: string }>((resolve) => {
    execFile(
      process.execPath,
      [CLI, args[0]!, ...args.slice(1), '--device', serial, '--share'],
      {
        env: { ...process.env, APPDYNO_STATE_DIR: stateDir },
        timeout: LONG_MS,
        maxBuffer: 1 << 24,
      },
      (e, out, err) => resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out, err }),
    );
  });

/** What makes the screen change for a moment: a simulator writes frames only then. */
const stir = async (ok: ReturnType<typeof harness>['ok'], rounds = 3) => {
  for (let i = 0; i < rounds; i++) {
    await ok('open_link', { url: 'appdyno-fixture://open/ticker' });
    await ok('wait_for', { text: 'Ticker', timeoutMs: 1_000 }).catch(() => undefined);
    await ok('press_key', { key: 'home' }).catch(() => undefined);
    await ok('launch_app');
  }
};

const android = process.env.APPDYNO_ANDROID_SERIAL;
const simulator = process.env.APPDYNO_IOS_UDID;
const iphone = process.env.APPDYNO_IPHONE_FIXTURE_APP ? process.env.APPDYNO_IPHONE_UDID : undefined;
const targets = [
  { platform: 'android', serial: android, provider: () => androidProvider(new Adb()) },
  { platform: 'ios', serial: simulator, provider: () => simulatorProvider() },
  { platform: 'iphone', serial: iphone, provider: () => iphoneProvider() },
];

afterAll(() => rmSync(dir, { recursive: true, force: true }));

for (const { platform, serial, provider } of targets)
  describe.skipIf(!serial)(`evidence on ${platform}`, () => {
    let h: ReturnType<typeof harness>;
    const file = (name: string) => join(dir, `${platform}-${name}`);

    beforeAll(async () => {
      if (platform === 'iphone')
        await new Devicectl(serial!).install(process.env.APPDYNO_IPHONE_FIXTURE_APP!);
      h = harness(serial!, provider());
      await h.ok('launch_app');
    }, 240_000);
    afterAll(() => h?.ctx.close());

    // devicectl offers no recording on some phones (an iPhone 13 Pro Max on iOS 27.0.1): then it says so, with what to do
    let noRecorder = false;

    describe('record', () => {
      it('records a video that plays, and refuses a second one', async (ctx) => {
        const to = file(platform === 'ios' ? 'one.mov' : 'one.mp4');
        const first = await h.call('record', { action: 'start', file: to });
        if (platform === 'iphone' && first.error) {
          expect(first.data.code).toBe('UNSUPPORTED');
          expect(first.text).toMatch(/Screen Recording/);
          noRecorder = true;
          return ctx.skip();
        }
        const started = first;
        expect(started.text).toContain(to);
        const again = await h.call('record', { action: 'start', file: file('two.mp4') });
        expect(again.error).toBe(true);
        expect(again.text).toMatch(/stop it first/);
        await stir(h.ok);
        const stopped = await h.ok('record', { action: 'stop' });
        expect(stopped.data.files).toEqual([to]);
        expect(stopped.data.frames).toBeGreaterThan(1);
        assertPlayable(to, 0.1);
        expect((await h.call('record', { action: 'stop' })).text).toMatch(/no recording runs/);
      }, 120_000);

      it('starts in one process and stops in another', async (ctx) => {
        if (noRecorder) return ctx.skip();
        const to = file(platform === 'ios' ? 'cli.mov' : 'cli.mp4');
        const start = await cli(serial!, 'record', 'start', '--file', to);
        expect(faults(start.err)).toBe('');
        expect(start.code).toBe(0);
        // the starter is gone; only the recording remains
        await stir(h.ok, 2);
        const stop = await cli(serial!, 'record', 'stop');
        expect(faults(stop.err)).toBe('');
        expect(stop.out).toContain(to);
        assertPlayable(to, 0.1);
      }, 180_000);

      it('ends by itself at its limit, and stop still finds the video', async (ctx) => {
        if (noRecorder) return ctx.skip();
        const to = file(platform === 'ios' ? 'limit.mov' : 'limit.mp4');
        await h.ok('record', { action: 'start', file: to, maxSeconds: 2 });
        await stir(h.ok, 1);
        // past the limit, whatever the stirring took
        await new Promise((r) => setTimeout(r, 3_000));
        const stopped = await h.ok('record', { action: 'stop' });
        expect(stopped.data.files).toEqual([to]);
        assertPlayable(to, 0.05);
        expect(Number(stopped.data.durationMs)).toBeLessThan(3_500);
      }, 120_000);

      it('says a recording failed when its file cannot be written', async () => {
        const r = await h.call('record', { action: 'start', file: '/dev/null/x/video.mp4' });
        expect(r.error).toBe(true);
        expect(r.text).toMatch(/cannot write|did not start/);
        expect((await h.call('record', { action: 'stop' })).text).toMatch(/no recording runs/);
      });
    });

    describe('report', () => {
      const SECRET = 'gizli-kod-9911';
      const PASSWORD = 'p4ss-w0rd-7788';

      it('is one folder with the steps, a screen and an image after each, and hides secrets', async () => {
        const folder = file('report');
        await h.ok('report', { action: 'start', dir: folder });
        await h.ok('open_link', { url: 'appdyno-fixture://open/form' });
        await h.ok('type_text', { selector: { id: 'name_input' }, text: SECRET });
        await h.ok('type_text', { selector: { id: 'password_input' }, text: PASSWORD });
        await h.ok('keyboard', { action: 'dismiss' }).catch(() => undefined);
        const fg = await h.call('perf_snapshot');
        if (!noRecorder) await h.ok('record', { action: 'start' });
        await stir(h.ok, 1);
        if (!noRecorder) await h.ok('record', { action: 'stop' });
        const done = await h.ok('report', { action: 'stop' });
        expect(done.data.file).toBe(join(folder, 'index.html'));

        const html = readFileSync(join(folder, 'index.html'), 'utf8');
        const journal = readFileSync(join(folder, 'steps.jsonl'), 'utf8');
        for (const text of [html, journal]) {
          expect(text).not.toContain(SECRET);
          expect(text).not.toContain(PASSWORD);
        }
        // nothing on the network: no script, no remote image; the only addresses are in the text
        expect(html).not.toMatch(/<script|<link|<iframe/i);
        expect(html).not.toMatch(/(src|href)="https?:/i);
        expect(html).toMatch(/type_text/);
        expect(html).toContain('<h2>Log</h2>');
        expect(html).toContain('<h2>Crashes</h2>');
        if (!fg.error) expect(html).toMatch(/Measurements \([1-9]/);

        // every image it names is there, and is one
        const shots = [...html.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1]!);
        expect(shots.length).toBeGreaterThan(2);
        for (const shot of shots) expect(statSync(join(folder, shot)).size).toBeGreaterThan(100);

        // the steps that show the secret: an image painted over where the secret stands
        const painted = shots.filter((s) => s.endsWith('.png'));
        expect(painted.length, 'an image with the secret in it').toBeGreaterThan(0);
        const img = decodePng(readFileSync(join(folder, painted[0]!)))!;
        expect(img).not.toBeNull();
        const blacks = img.data.filter(
          (_, i) => i % img.channels === 0 && img.data[i] === 0,
        ).length;
        expect(blacks / (img.width * img.height)).toBeGreaterThan(0.005);

        // the video is in the folder, and plays
        const video = /<video controls src="([^"]+)"/.exec(html)?.[1];
        if (noRecorder) return;
        expect(video).toBeDefined();
        assertPlayable(join(folder, video!), 0.05);
      }, 240_000);

      it('works from the command line, one process per step', async () => {
        const folder = file('report-cli');
        // an iPhone opens a link in the selected app
        expect((await cli(serial!, 'use-device', '--app', APP)).code).toBe(0);
        expect((await cli(serial!, 'report', 'start', '--dir', folder)).code).toBe(0);
        const open = await cli(serial!, 'open-link', '--url', 'appdyno-fixture://open/list');
        expect(faults(open.err)).toBe('');
        const r = await cli(serial!, 'report', 'stop');
        expect(faults(r.err)).toBe('');
        expect(r.out).toContain('1 steps');
        expect(readFileSync(join(folder, 'index.html'), 'utf8')).toMatch(/1\. open_link/);
      }, 120_000);
    });
  });

/** A local web server and a forward proxy with a list it writes as HAR, as Charles or mitmproxy would. */
async function localWeb() {
  const web = createServer((req, res) => res.end(Buffer.alloc(200_000, 7)));
  await new Promise<void>((r) => web.listen(0, '0.0.0.0', r));
  const entries: unknown[] = [];
  const proxy = createServer((req, res) => {
    const body = 'through the proxy';
    entries.push({
      startedDateTime: new Date().toISOString(),
      time: 5,
      request: { method: req.method, url: req.url },
      response: { status: 200, content: { size: body.length, text: body } },
    });
    res.end(body);
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const port = (s: typeof web) => (s.address() as AddressInfo).port;
  return {
    webPort: port(web),
    proxyPort: port(proxy),
    har: () => JSON.stringify({ log: { version: '1.2', entries } }),
    close: () => {
      web.close();
      proxy.close();
    },
  };
}

const fetchIn = async (ok: ReturnType<typeof harness>['ok'], url: string) => {
  await ok('open_link', { url: 'appdyno-fixture://open/network' });
  await ok('type_text', { selector: { id: 'url_input' }, text: url, replace: true });
  await ok('tap', { selector: { id: 'fetch' } });
  const r = await ok('wait_for', { text: 'fetched', timeoutMs: 15_000 });
  expect(r.data.met).toBe(true);
};

describe.skipIf(!android)('network on Android', () => {
  let h: ReturnType<typeof harness>;
  let web: Awaited<ReturnType<typeof localWeb>>;
  const adb = new Adb();
  // no proxy reads either way: a device that once had one keeps `:0`
  const proxySetting = async () =>
    (await adb.exec(android!, 'settings get global http_proxy')).trim().replace(/^:0$/, 'null');
  // the count needs real traffic, not `adb reverse`: an emulator reaches this Mac at 10.0.2.2, a phone at its address
  const macHost = () =>
    android!.startsWith('emulator-')
      ? '10.0.2.2'
      : Object.values(networkInterfaces())
          .flat()
          .find((a) => a?.family === 'IPv4' && !a.internal)?.address;
  beforeAll(async () => {
    web = await localWeb();
    h = harness(android!, androidProvider(adb));
    await h.ok('launch_app');
  }, 240_000);
  afterAll(async () => {
    // a test that failed half way must not leave the device on a proxy that is about to close
    await h?.ctx.end();
    h?.ctx.close();
    web?.close();
  });

  it('says what each way sees', async () => {
    const r = await h.ok('network', { action: 'paths' });
    expect(r.text).toMatch(/^proxy: .*Now: none/m);
    expect(r.text).toMatch(/^bytes: .*no URLs, no bodies/m);
    // a `user` build has no packet source, and says so
    expect(r.text).toMatch(/^packets: (.*no URLs, no bodies|no: this build does not register)/m);
    expect(r.text).toMatch(/^probe: no:/m);
  });

  it('refuses a proxy nothing listens on, leaving the device as it was', async () => {
    const r = await h.call('network', { action: 'start', via: 'proxy', proxy: '127.0.0.1:1' });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/nothing listens/);
    expect(await proxySetting()).toBe('null');
  });

  // never on a phone: a person's proxy is no test's to change, and a run that dies would leave their traffic pointing here
  it.runIf(android?.startsWith('emulator-'))(
    'sends an app through a proxy on this Mac, lists it from the export and puts it back',
    async () => {
      const proxy = `127.0.0.1:${web.proxyPort}`;
      await h.ok('network', { action: 'start', via: 'proxy', proxy });
      expect(await proxySetting()).toBe(proxy);
      expect((await h.call('network', { action: 'start', via: 'bytes' })).text).toMatch(
        /stop it first/,
      );
      await fetchIn(h.ok, 'http://proxied.test/hello?token=abc123');
      const har = join(dir, 'proxy.har');
      writeFileSync(har, web.har());
      // a proxy on the device takes every app's traffic, the system's own checks too
      const read = await h.ok('network', { action: 'read', har, contains: 'proxied.test' });
      expect(read.text).toMatch(/GET http:\/\/proxied\.test\/hello\?token=••• 200/);
      expect(read.text).not.toContain('abc123');
      expect(read.text).toMatch(/bodies: 1 of 1 in the export/);
      const none = await h.call('network', { action: 'read' });
      expect(none.error).toBe(true);
      expect(none.text).toMatch(/export it as HAR/);
      await h.ok('network', { action: 'stop' });
      expect(await proxySetting()).toBe('null');
      expect(await adb.run(['-s', android!, 'reverse', '--list'])).not.toContain(
        `${web.proxyPort}`,
      );
    },
    120_000,
  );

  it('counts an app by its bytes, with no URL and no body', async () => {
    await h.ok('network', { action: 'start', via: 'bytes' });
    await fetchIn(h.ok, `http://${macHost()}:${web.webPort}/big`);
    const r = await h.ok('network', { action: 'stop' });
    const got = r.data.entries!.find((e) => e.direction === 'Received')!;
    expect(got.bytes).toBeGreaterThan(200_000);
    expect(r.text).toMatch(/bodies: not by this way/);
  }, 120_000);

  it('traces an app by its packets, read at the end', async () => {
    const started = await h.call('network', { action: 'start', via: 'packets' });
    // a Xiaomi's user build has no packet source, and says so before it records
    if (started.error && !android!.startsWith('emulator-'))
      return expect(started.text).toMatch(/does not register android.network_packets/);
    await fetchIn(h.ok, `http://${macHost()}:${web.webPort}/big`);
    expect((await h.ok('network', { action: 'read' })).text).toMatch(/can be read when it ends/);
    const r = await h.ok('network', { action: 'stop' });
    const port = r.data.entries!.find(
      (e) => e.direction === 'Received' && e.host === `TCP port ${web.webPort}`,
    );
    expect(port?.bytes).toBeGreaterThan(200_000);
    expect(r.text).toMatch(/bodies: not by this way/);
  }, 120_000);

  it('works from the command line, one process per step', async () => {
    const start = await cli(android!, 'network', 'start', '--via', 'bytes', '--app', APP);
    expect(faults(start.err)).toBe('');
    const read = await cli(android!, 'network', 'read');
    expect(read.err).toBe('');
    expect(read.out).toMatch(/Received uid \d+/);
    expect((await cli(android!, 'network', 'stop')).code).toBe(0);
  }, 120_000);
});

describe.skipIf(!simulator)('network on a simulator', () => {
  let h: ReturnType<typeof harness>;
  let web: Awaited<ReturnType<typeof localWeb>>;
  beforeAll(async () => {
    web = await localWeb();
    h = harness(simulator!, simulatorProvider());
    await h.ok('launch_app');
  }, 240_000);
  afterAll(() => {
    h?.ctx.close();
    web?.close();
  });

  it('says what each way sees and what it follows', async () => {
    const r = await h.ok('network', { action: 'paths' });
    expect(r.text).toMatch(/^proxy: .*Now: /m);
    expect(r.text).toMatch(/^probe: .*Not background sessions, WKWebView or Network.framework/m);
    expect(r.text).toMatch(/^packets: no:/m);
    expect(r.text).toMatch(/^bytes: no:/m);
  });

  it("will not change the Mac's proxy", async () => {
    const r = await h.call('network', {
      action: 'start',
      via: 'proxy',
      proxy: `127.0.0.1:${web.proxyPort}`,
    });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/follows the Mac's proxy/);
  });

  it('lists the requests of an app with the probe in it', async () => {
    await h.ok('network', { action: 'start', via: 'probe' });
    await fetchIn(h.ok, `http://127.0.0.1:${web.webPort}/seen?token=abc123`);
    const read = await h.ok('network', { action: 'read' });
    expect(read.text).toMatch(/GET http:\/\/127\.0\.0\.1:\d+\/seen\?token=••• 200 \d+ ms 200000 B/);
    expect(read.text).not.toContain('abc123');
    const stop = await h.ok('network', { action: 'stop' });
    expect(stop.text).toMatch(/stays in the app until it next starts/);
    await h.ok('terminate_app');
    await h.ok('launch_app');
  }, 180_000);
});

for (const { platform, serial, provider, pageId, other } of [
  { ...targets[0]!, pageId: 'webview_devtools_remote_\\d+/\\S+', other: 'com.android.settings' },
  { ...targets[1]!, pageId: 'PID:\\d+/\\d+', other: 'com.apple.Preferences' },
])
  describe.skipIf(!serial)(`web views on ${platform}`, () => {
    let h: ReturnType<typeof harness>;
    beforeAll(async () => {
      h = harness(serial!, provider());
      await h.ok('terminate_app');
      await h.ok('launch_app');
      await h.ok('open_link', { url: 'appdyno-fixture://open/web' });
      await h.ok('wait_for', { text: 'Web content' });
    }, 240_000);
    afterAll(() => h?.ctx.close());

    it('marks what a web view shows in the screen', async () => {
      const s = await h.ok('screen');
      expect(s.text).toMatch(/button "Pay" \d+,\d+ clickable( focused)? web/);
      expect(s.text).toMatch(/"Web content" \d+,\d+ .*web/);
    });

    it('lists the page of a debuggable app, and none of an app that is not', async () => {
      const r = await h.ok('webview', { action: 'pages' });
      expect(r.text).toMatch(
        new RegExp(`${pageId} "Fixture web" .* in dev\\.appdyno\\.fixture \\(showing\\)`),
      );
      const none = await h.call('webview', { action: 'elements', app: other });
      expect(none.error).toBe(true);
      expect(none.text).toMatch(/no web page to inspect in /);
    }, 60_000);

    it('reads the DOM as elements where the accessibility tree sees them', async () => {
      const r = await h.ok('webview', { action: 'elements' });
      expect(r.text).toMatch(/^"Fixture web" /);
      expect(r.text).toMatch(/button "Pay" \d+,\d+ #pay/);
      expect(r.text).toMatch(/input "Card" \d+,\d+ #card/);
      const pay = r.data.elements!.find((e) => e.text === 'Pay')!;
      const found = await h.ok('find', { text: 'Pay' });
      const inTree = found.data.matches[0]!;
      expect(Math.abs(pay.x - inTree.x)).toBeLessThan(40);
      expect(Math.abs(pay.y - inTree.y)).toBeLessThan(40);
    }, 60_000);

    it('clicks by selector and evaluates a script', async () => {
      const paid = "document.getElementById('paid').textContent";
      expect((await h.ok('webview', { action: 'eval', js: paid })).text).toBe('""');
      const click = await h.ok('webview', { action: 'click', selector: '#pay' });
      expect(click.text).toBe('clicked button "Pay"');
      expect((await h.ok('webview', { action: 'eval', js: paid })).text).toBe('"Paid"');
      expect((await h.ok('wait_for', { text: 'Paid' })).data.met).toBe(true);

      const none = await h.call('webview', { action: 'click', selector: '#nothing' });
      expect(none.error).toBe(true);
      expect(none.text).toMatch(/nothing on the page matches/);
      const thrown = await h.call('webview', { action: 'eval', js: 'no.such.thing' });
      expect(thrown.error).toBe(true);
      expect(thrown.text).toMatch(/the script threw: ReferenceError/);
    }, 60_000);

    it('brings back a long answer whole', async () => {
      const r = await h.ok('webview', { action: 'eval', js: "'x'.repeat(100000)" });
      // an answer stops at 20,000 characters; the socket's framing is what this reads across
      expect(r.text).toHaveLength(20_000);
    }, 60_000);

    it('a page coordinate takes a real touch', async () => {
      await h.ok('webview', {
        action: 'eval',
        js: "document.getElementById('paid').textContent = ''",
      });
      const r = await h.ok('webview', { action: 'elements' });
      const pay = r.data.elements!.find((e) => e.text === 'Pay')!;
      await h.ok('tap', { x: pay.x, y: pay.y });
      expect((await h.ok('wait_for', { text: 'Paid' })).data.met).toBe(true);
    }, 60_000);

    it('adds to the screen what the tree does not hold', async () => {
      await h.ok('webview', {
        action: 'eval',
        js: "const b = document.createElement('button'); b.id = 'silent'; b.setAttribute('aria-hidden', 'true'); b.textContent = 'Hidden from readers'; document.body.appendChild(b); true",
      });
      const s = await h.ok('screen');
      expect(s.text).toMatch(
        // a phone's web view may name less than an emulator's: other lines can come first
        /not in the accessibility tree:\n(?:web .*\n)*web button "Hidden from readers" \d+,\d+ #silent/,
      );
    }, 60_000);

    it('works from the command line', async () => {
      const r = await cli(serial!, 'webview', 'pages', '--app', APP);
      expect(faults(r.err)).toBe('');
      expect(r.out).toContain('"Fixture web"');
    }, 60_000);
  });

for (const { platform, serial, provider } of targets)
  describe.skipIf(!serial)(`visual comparison on ${platform}`, () => {
    let h: ReturnType<typeof harness>;
    const baselines = join(dir, `baselines-${platform}`);
    const open = async (screen: string, label: string) => {
      await h.ok('open_link', { url: `appdyno-fixture://open/${screen}` });
      await h.ok('wait_for', { text: label });
    };
    beforeAll(async () => {
      h = harness(serial!, provider());
      await h.ok('terminate_app');
      await h.ok('launch_app');
      await open('dialog', 'Open dialog');
    }, 240_000);
    afterAll(() => h?.ctx.close());

    it('finds a screen the same as its baseline', async () => {
      const saved = await h.ok('visual', { action: 'baseline', name: 'dialog', dir: baselines });
      expect(saved.text).toMatch(/saved .*dialog\.png \(\d+x\d+\)/);
      const r = await h.ok('visual', { action: 'compare', name: 'dialog', dir: baselines });
      expect(r.data.same).toBe(true);
      expect(existsSync(join(baselines, 'dialog.diff.png'))).toBe(false);
    }, 60_000);

    it('refuses what has changed, with a diff image a person can open', async () => {
      await open('list', 'Product 1');
      const r = await h.call('visual', { action: 'compare', name: 'dialog', dir: baselines });
      expect(r.error).toBe(true);
      expect(r.data.code).toBe('CHECK_FAILED');
      expect(r.text).toMatch(/[\d.]+ percent of pixels differ .* tolerance 0\.1: diff /);
      const diff = decodePng(readFileSync(join(baselines, 'dialog.diff.png')))!;
      expect(diff).not.toBeNull();
      const red = diff.data.filter(
        (_, i) => i % 3 === 0 && diff.data[i] === 230 && diff.data[i + 1] === 30,
      ).length;
      expect(red).toBeGreaterThan(1_000);
      expect(existsSync(join(baselines, 'dialog.actual.png'))).toBe(true);
      // the file a person opens is one any viewer takes
      if (ffprobe)
        expect(
          execFileSync(
            'ffprobe',
            [
              '-v',
              'error',
              '-show_entries',
              'stream=codec_name',
              '-of',
              'csv=p=0',
              join(baselines, 'dialog.diff.png'),
            ],
            { encoding: 'utf8' },
          ).trim(),
        ).toBe('png');
    }, 60_000);

    it('takes a bigger tolerance, a mask by selector and one by rect', async () => {
      await open('dialog', 'Open dialog');
      const full = await h.ok('visual', { action: 'baseline', name: 'masked', dir: baselines });
      expect(full.error).toBe(false);
      await h.ok('tap', { selector: { id: 'open_dialog' } });
      const seen = await h.call('visual', { action: 'compare', name: 'masked', dir: baselines });
      expect(seen.error).toBe(true);
      const percent = Number(/([\d.]+) percent/.exec(seen.text)![1]);
      const loose = await h.ok('visual', {
        action: 'compare',
        name: 'masked',
        dir: baselines,
        tolerance: Math.min(100, percent + 1),
      });
      expect(loose.data.same).toBe(true);
      const window = await h.ok('device_info');
      const size = window.data.screen;
      const masked = await h.ok('visual', {
        action: 'compare',
        name: 'masked',
        dir: baselines,
        tolerance: 0,
        masks: [{ x: 0, y: 0, w: size.w, h: size.h }],
      });
      expect(masked.data.percent).toBe(0);
      const none = await h.call('visual', {
        action: 'compare',
        name: 'masked',
        dir: baselines,
        masks: [{ text: 'nothing like this' }],
      });
      expect(none.text).toMatch(/nothing to mask/);
    }, 90_000);

    it('says when there is no baseline, and from the command line', async () => {
      const r = await h.call('visual', { action: 'compare', name: 'never', dir: baselines });
      expect(r.error).toBe(true);
      expect(r.text).toMatch(/no baseline/);
      const c = await cli(serial!, 'visual', 'compare', '--name', 'never', '--dir', baselines);
      expect(c.code).toBe(1);
      expect(c.err).toMatch(/no baseline/);
    }, 60_000);
  });

describe.skipIf(!android)('visual comparison leaves the status bar out', () => {
  it('holds when only the clock moves', async () => {
    const adb = new Adb();
    const h = harness(android!, androidProvider(adb));
    const demo = (args: string) =>
      adb.exec(android!, `am broadcast -a com.android.systemui.demo ${args}`);
    try {
      await adb.exec(android!, 'settings put global sysui_demo_allowed 1');
      await demo('-e command enter');
      await demo('-e command clock -e hhmm 0101');
      await h.ok('open_link', { url: 'appdyno-fixture://open/dialog' });
      await h.ok('wait_for', { text: 'Open dialog' });
      const b = join(dir, 'clock');
      await h.ok('visual', { action: 'baseline', name: 'clock', dir: b });
      await demo('-e command clock -e hhmm 2359');
      const r = await h.ok('visual', { action: 'compare', name: 'clock', dir: b, tolerance: 0 });
      expect(r.data.same).toBe(true);
    } finally {
      await demo('-e command exit');
      await adb.exec(android!, 'settings delete global sysui_demo_allowed');
      h.ctx.close();
    }
  }, 120_000);
});

describe.skipIf(!android || !android.startsWith('emulator-'))('emulator events on Android', () => {
  let h: ReturnType<typeof harness>;
  const adb = new Adb();
  const callState = async () =>
    /mCallState=(\d)/.exec(await adb.exec(android!, 'dumpsys telephony.registry'))?.[1];
  const until = untilWithin(15_000);
  beforeAll(async () => {
    h = harness(android!, androidProvider(adb));
    await h.ok('launch_app');
  }, 240_000);
  afterAll(() => h?.ctx.close());

  it('sets the battery and puts it back', async () => {
    const level = async () => /level: (\d+)/.exec(await adb.exec(android!, 'dumpsys battery'))?.[1];
    const was = await h.ok('device_setting', { name: 'battery' });
    expect(was.text).toMatch(/battery: default \(now \d+\)/);
    const before = await level();
    await h.ok('device_setting', { name: 'battery', value: '17' });
    expect(await level()).toBe('17');
    expect((await h.call('device_setting', { name: 'battery', value: '170' })).error).toBe(true);
    await h.ok('device_setting', { name: 'restore' });
    expect(await level()).toBe(before);
    expect(await adb.exec(android!, 'dumpsys battery')).not.toContain('UPDATES STOPPED');
  }, 60_000);

  it('brings a call in and ends it', async () => {
    await h.ok('device_setting', { name: 'call', value: '5551212' });
    await until('a call ringing', async () => (await callState()) === '1');
    await h.ok('device_setting', { name: 'call', value: 'end 5551212' });
    await until('the call gone', async () => (await callState()) === '0');
    await h.ok('launch_app');
  }, 60_000);

  it('brings an SMS in', async () => {
    const text = `Merhaba ${Date.now()}`;
    await h.ok('device_setting', { name: 'sms', title: '5553434', value: text });
    await until('the SMS in the inbox', async () =>
      (
        await adb.exec(android!, 'content query --uri content://sms/inbox --projection body')
      ).includes(text),
    );
    await h.ok('launch_app');
  }, 60_000);

  it('says when an emulator cannot fold', async () => {
    const r = await h.call('device_setting', { name: 'fold', value: 'closed' });
    expect(r.error).toBe(true);
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toMatch(/this device does not fold: its states are default/);
  });
});

describe.skipIf(!simulator)('emulator events on a simulator', () => {
  it('says why it has none', async () => {
    const h = harness(simulator!, simulatorProvider());
    for (const [args, why] of [
      [{ name: 'fold', value: 'closed' }, /simctl has no fold pose/],
      [{ name: 'call', value: '5551212' }, /no telephony/],
      [{ name: 'sms', value: 'x' }, /no telephony/],
      [{ name: 'battery', value: '10' }, /no battery to set/],
    ] as const) {
      const r = await h.call('device_setting', args);
      expect(r.error).toBe(true);
      expect(r.data.code).toBe('UNSUPPORTED');
      expect(r.text).toMatch(why);
    }
    h.ctx.close();
  }, 120_000);
});

describe.skipIf(!android)('recording on Android', () => {
  let h: ReturnType<typeof harness>;
  const adb = new Adb();
  beforeAll(async () => {
    h = harness(android!, androidProvider(adb));
    await h.ok('launch_app');
  }, 240_000);
  afterAll(() => h?.ctx.close());

  it('joins its segments into one video, across the limit of one run', async () => {
    process.env.APPDYNO_RECORD_SEGMENT_S = '5';
    try {
      const to = join(dir, 'joined.mp4');
      // something moves all along: a still phone's screen gives no frames, so little video
      await h.ok('open_link', { url: 'appdyno-fixture://open/ticker' });
      await h.ok('record', { action: 'start', file: to });
      await new Promise((r) => setTimeout(r, 12_000));
      await stirOnce(h.ok);
      const stopped = await h.ok('record', { action: 'stop' });
      expect(stopped.data.files).toEqual([to]);
      expect(stopped.text).toMatch(/\d segments joined/);
      // what was recorded, less a moment at each join
      const j = assertPlayable(to, 8);
      if (j) expect(Number(j.format.duration)).toBeLessThan(40);
      // every frame decodes in one pass, through both joins
      if (ffprobe)
        execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', to, '-f', 'null', '-'], {
          stdio: 'pipe',
        });
    } finally {
      delete process.env.APPDYNO_RECORD_SEGMENT_S;
    }
  }, 120_000);

  it('says so when the recorder is killed, and can record again', async () => {
    const to = join(dir, 'killed.mp4');
    await h.ok('record', { action: 'start', file: to });
    await stirOnce(h.ok);
    await adb.exec(android!, 'pkill -9 screenrecord');
    const r = await h.call('record', { action: 'stop' });
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/recording failed.*(did not end properly|runs past|empty)/);
    expect((await h.call('record', { action: 'stop' })).text).toMatch(/no recording runs/);
    const next = join(dir, 'after-kill.mp4');
    await h.ok('record', { action: 'start', file: next });
    await stirOnce(h.ok);
    await h.ok('record', { action: 'stop' });
    assertPlayable(next, 0.1);
  }, 120_000);

  it('stops a session-long recording when the session ends', async () => {
    const to = join(dir, 'ended.mp4');
    const e = harness(android!, androidProvider(adb));
    await e.ok('record', { action: 'start', file: to });
    await stirOnce(e.ok);
    expect(await e.ctx.end()).toEqual([]);
    e.ctx.close();
    assertPlayable(to, 0.1);
    expect((await h.call('record', { action: 'stop' })).text).toMatch(/no recording runs/);
  }, 120_000);
});

async function stirOnce(ok: ReturnType<typeof harness>['ok']) {
  await ok('open_link', { url: 'appdyno-fixture://open/ticker' });
  await ok('press_key', { key: 'back' });
}
