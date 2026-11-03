import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, opsFor, ServerContext, ToolError, type Op } from '@appdyno/ops';
import { Adb, androidProvider, appleProvider, decodePng } from 'appdyno';

/**
 * Phase 6 on real devices, through the operations an agent calls and, where a recording must outlive its
 * process, the built command line: one suite per platform, each on the device its variable names.
 */
const APP = 'dev.appdyno.fixture';
const CLI = fileURLToPath(new URL('../packages/appdyno/dist/main.js', import.meta.url));
const LONG_MS = 300_000;

type Answer = { error: boolean; text: string; data: Record<string, unknown> };

const dir = mkdtempSync(join(tmpdir(), 'appdyno-evidence-'));
const stateDir = join(dir, 'state');
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
  const ops = opsFor(ctx);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Answer> => {
    const op = ops[name] as Op;
    try {
      const r = await op.handler(op.input.parse(args) as Record<string, unknown>);
      return {
        error: false,
        text: r.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'),
        data: r.data,
      };
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      return { error: true, text: e.message, data: { code: e.code } };
    }
  };
  const ok = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args);
    expect(r.error ? r.text : '').toBe('');
    return r;
  };
  return { ctx, call, ok };
}

const cli = (serial: string, ...args: string[]) =>
  new Promise<{ code: number; out: string; err: string }>((resolve) => {
    execFile(
      process.execPath,
      [CLI, args[0]!, ...args.slice(1), '--device', serial, '--share'],
      { env: { ...process.env, APPDYNO_STATE_DIR: stateDir }, timeout: LONG_MS, maxBuffer: 1 << 24 },
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
const targets = [
  { platform: 'android', serial: android, provider: () => androidProvider(new Adb()) },
  { platform: 'ios', serial: simulator, provider: () => appleProvider() },
];

afterAll(() => rmSync(dir, { recursive: true, force: true }));

for (const { platform, serial, provider } of targets)
  describe.skipIf(!serial)(`evidence on ${platform}`, () => {
    let h: ReturnType<typeof harness>;
    const file = (name: string) => join(dir, `${platform}-${name}`);

    beforeAll(async () => {
      h = harness(serial!, provider());
      await h.ok('launch_app');
    }, 240_000);
    afterAll(() => h?.ctx.close());

    describe('record', () => {
      it('records a video that plays, and refuses a second one', async () => {
        const to = file(platform === 'ios' ? 'one.mov' : 'one.mp4');
        const started = await h.ok('record', { action: 'start', file: to });
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

      it('starts in one process and stops in another', async () => {
        const to = file(platform === 'ios' ? 'cli.mov' : 'cli.mp4');
        const start = await cli(serial!, 'record', 'start', '--file', to);
        expect(start.err).toBe('');
        expect(start.code).toBe(0);
        // the starter is gone; only the recording remains
        await stir(h.ok, 2);
        const stop = await cli(serial!, 'record', 'stop');
        expect(stop.err).toBe('');
        expect(stop.out).toContain(to);
        assertPlayable(to, 0.1);
      }, 180_000);

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
        await h.ok('record', { action: 'start' });
        await stir(h.ok, 1);
        await h.ok('record', { action: 'stop' });
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
        const blacks = img.data.filter((_, i) => i % img.channels === 0 && img.data[i] === 0).length;
        expect(blacks / (img.width * img.height)).toBeGreaterThan(0.005);

        // the video is in the folder, and plays
        const video = /<video controls src="([^"]+)"/.exec(html)?.[1];
        expect(video).toBeDefined();
        assertPlayable(join(folder, video!), 0.05);
      }, 240_000);

      it('works from the command line, one process per step', async () => {
        const folder = file('report-cli');
        expect((await cli(serial!, 'report', 'start', '--dir', folder)).code).toBe(0);
        const open = await cli(serial!, 'open-link', '--url', 'appdyno-fixture://open/list');
        expect(open.err).toBe('');
        const r = await cli(serial!, 'report', 'stop');
        expect(r.err).toBe('');
        expect(r.out).toContain('1 steps');
        expect(readFileSync(join(folder, 'index.html'), 'utf8')).toMatch(/1\. open_link/);
      }, 120_000);
    });
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
