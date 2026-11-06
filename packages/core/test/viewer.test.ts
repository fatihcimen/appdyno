import { execFile, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ViewerProcess,
  viewerBinary,
  VIEWER_TEST_FILES,
  viewerTestBinary,
  type ViewerMessage,
} from '../src/index.js';

const run = promisify(execFile);
const FIXTURES = join(import.meta.dirname, '../../../mirror/Viewer/fixtures');
/** The first use compiles it, on a Mac that may be busy. */
const COMPILE_MS = 300_000;
/** A hang, not a slow machine: how long a word from a viewer is waited for. */
const WAIT_MS = 240_000;

let binary: string;
let testBinary: string;
const dir = mkdtempSync(join(tmpdir(), 'appdyno-viewer-'));

beforeAll(async () => {
  binary = await viewerBinary();
  testBinary = await viewerTestBinary();
}, COMPILE_MS);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A running headless viewer and what it has said. */
function viewer() {
  const v = new ViewerProcess(binary, ['--headless']);
  const said: ViewerMessage[] = [];
  const waiting: {
    op: string;
    test: (m: ViewerMessage) => boolean;
    done: (m: ViewerMessage) => void;
  }[] = [];
  v.onMessage((m) => {
    said.push(m);
    for (const w of [...waiting])
      if (w.op === m.op && w.test(m)) {
        waiting.splice(waiting.indexOf(w), 1);
        w.done(m);
      }
  });
  const until = (op: string, test: (m: ViewerMessage) => boolean = () => true) =>
    new Promise<ViewerMessage>((done, fail) => {
      const old = said.find((m) => m.op === op && test(m));
      if (old) return done(old);
      waiting.push({ op, test, done });
      setTimeout(() => fail(new Error(`no ${op}: ${JSON.stringify(said).slice(-400)}`)), WAIT_MS);
    });
  return { v, said, until };
}

const exited = (v: ViewerProcess) => new Promise<string>((r) => v.onExit(r));

describe('the keyboard', () => {
  const viewer = join(import.meta.dirname, '../../../mirror/Viewer');
  const source = (f: string) => readFileSync(join(viewer, f), 'utf8');

  it('is taken in one place, and that one is what --focus asks for', () => {
    const window = source('Window.m');
    for (const taking of ['makeKeyAndOrderFront', 'activateIgnoringOtherApps']) {
      const all = readdirSync(viewer)
        .filter((f) => f.endsWith('.m'))
        .flatMap((f) =>
          source(f)
            .split('\n')
            .filter((l) => l.includes(taking)),
        );
      expect(all, taking).toHaveLength(1);
      expect(window.indexOf(taking)).toBeGreaterThan(window.indexOf('case MVShowFocused:'));
      expect(window.indexOf(taking)).toBeLessThan(window.indexOf('- (void)raise'));
    }
    expect(window).toContain('MVShowOf([attach[@"focus"] boolValue]');
    expect(source('Hub.m')).toContain('MVPresent(_window, how)');
  });

  it('a card over the picture takes no click, but on its own button', () => {
    expect(source('Overlay.m')).toMatch(
      /@implementation MVOverlayCard\n- \(NSView \*\)hitTest[^}]*isKindOfClass:NSButton\.class\] \? hit : nil;/,
    );
  });

  it('no launch brings the viewer forward', () => {
    expect(source('main.m')).toContain(
      'application.activationPolicy = NSApplicationActivationPolicyProhibited',
    );
    expect(source('main.m')).not.toContain(
      'application.activationPolicy = NSApplicationActivationPolicyRegular',
    );
  });

  it('nothing the viewer writes as a log holds what was typed', () => {
    for (const f of readdirSync(viewer).filter((n) => n.endsWith('.m'))) {
      expect(source(f), f).not.toMatch(/NSLog|fprintf\(stderr/);
    }
  });
});

describe('the viewer, compiled by its first-use path', () => {
  it('kept behind, it is one the system can never put in front, whoever started it', async () => {
    const viewer = spawn(binary, ['--hub', '--behind'], { stdio: ['pipe', 'ignore', 'ignore'] });
    try {
      let kind = '';
      for (let i = 0; i < 100 && !kind.includes('type='); i++) {
        await new Promise((r) => setTimeout(r, 100));
        ({ stdout: kind } = await run('lsappinfo', [
          'info',
          '-only',
          'ApplicationType',
          String(viewer.pid),
        ]));
      }
      expect(kind).toContain('type="BackgroundOnly"');
    } finally {
      viewer.kill();
    }
  }, 30_000);

  it.each(['--headless', '--behind'])(
    "%s copies to a board of its own, and leaves a person's pasteboard alone",
    async (flag) => {
      const file = join(dir, `copied${flag}.png`);
      // a picture of one pixel
      const pixel =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      writeFileSync(file, Buffer.from(pixel, 'base64'));
      const v = new ViewerProcess(binary, [flag]);
      const board = `$.NSPasteboard.pasteboardWithName('dev.appdyno.behind.${v.pid}')`;
      const ask = async (what: string) => {
        const read = `ObjC.import('AppKit'); ${what}`;
        return (await run('osascript', ['-l', 'JavaScript', '-e', read])).stdout.trim();
      };
      const counts = async () => {
        const said = await ask(
          `[$.NSPasteboard.generalPasteboard.changeCount, ${board}.changeCount].join(' ')`,
        );
        const [general, own] = said.split(' ').map(Number);
        return { general: general!, own: own! };
      };
      const held = () => ask(`ObjC.unwrap(${board}.stringForType($.NSPasteboardTypeString)) || ''`);
      try {
        const before = await counts();
        v.send({ op: 'copied', file });
        v.send({ op: 'copyText', text: 'nothing of a person' });
        // that the viewer did copy is what makes the other count mean anything
        const end = Date.now() + WAIT_MS;
        let after = await counts();
        while (after.own < before.own + 2 && Date.now() < end) after = await counts();
        expect(after.own).toBeGreaterThanOrEqual(before.own + 2);
        expect(after.general).toBe(before.general);
        expect(await held()).toBe('nothing of a person');
        const gone = new Promise((resolve) => v.onExit(resolve));
        v.send({ op: 'quit' });
        await gone;
        expect(await held()).toBe('');
      } finally {
        v.kill();
      }
    },
    WAIT_MS + 10_000,
  );

  it('has no test in what a person runs, and nothing of it in what is published', () => {
    expect(readFileSync(binary).includes('--selftest')).toBe(false);
    expect(readFileSync(binary).includes('--encode')).toBe(false);
    expect(readFileSync(testBinary).includes('--selftest')).toBe(true);
    const viewer = join(import.meta.dirname, '../../../mirror/Viewer');
    expect(readdirSync(viewer).filter((f) => VIEWER_TEST_FILES.test(f)).length).toBeGreaterThan(5);
  });

  it('passes its self test: real frames, bad input, the sums a window rests on', async () => {
    // a failed check exits 1, and it is the lines that say which
    const { stdout } = await run(testBinary, ['--selftest', FIXTURES], { timeout: 180_000 }).catch(
      (e: { stdout: string }) => ({ stdout: e.stdout }),
    );
    const lines = stdout
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.filter((l) => l.ok === false)).toEqual([]);
    expect(lines.at(-1)).toMatchObject({ selftest: 'done', failed: 0 });
    const named = lines.map((l) => String(l.check));
    expect(named).toContain('nal: random bytes stay in bounds');
    expect(named).toContain('pixels: a size past the file is refused, unread');
    expect(named).toContain('stream: a frame over the limit ends it');
    expect(named).toContain("pasteboard: all of this left a person's alone");
  }, 200_000);

  it(
    'says it is ready, and ends with its stdin',
    async () => {
      const { v, until } = viewer();
      await until('ready');
      const end = exited(v);
      v.kill();
      await end;
    },
    COMPILE_MS,
  );

  it(
    'a parent that dies by SIGKILL takes its viewer with it',
    async () => {
      // a parent of its own, killed as a crash would: the viewer sees its stdin end. It goes with this test's process by
      // its own stdin, so a run that fails or is cut short before the kill leaves neither behind
      const parent = spawn(
        process.execPath,
        [
          '-e',
          `const {spawn}=require('node:child_process');const c=spawn(${JSON.stringify(binary)},['--headless'],{stdio:['pipe','inherit','inherit']});process.stdout.write(String(c.pid)+'\\n');process.stdin.on('end',()=>process.exit()).resume();`,
        ],
        { stdio: ['pipe', 'pipe', 'ignore'] },
      );
      // the viewer writes to this pipe too, and its first line may come before the parent's
      const pid = await new Promise<number>((r) => {
        let said = '';
        parent.stdout.on('data', (b: Buffer) => {
          said += b.toString();
          const line = /^(\d+)\n/m.exec(said)?.[1];
          if (line) r(Number(line));
        });
      });
      expect(pid).toBeGreaterThan(0);
      process.kill(parent.pid!, 'SIGKILL');
      const end = Date.now() + WAIT_MS;
      let alive = true;
      while (alive && Date.now() < end) {
        try {
          process.kill(pid, 0);
          await new Promise((r) => setTimeout(r, 100));
        } catch {
          alive = false;
        }
      }
      expect(alive).toBe(false);
    },
    COMPILE_MS,
  );

  it(
    'a kind it does not know is said so, and it stays',
    async () => {
      const { v, until } = viewer();
      v.send({ op: 'attach', source: { kind: 'no-such' } });
      await expect(until('lost')).resolves.toMatchObject({ fatal: true });
      v.send({ op: 'status', state: 'live' });
      v.send('not json' as never);
      await until('stats');
      const end = exited(v);
      v.send({ op: 'quit' });
      await end;
    },
    COMPILE_MS,
  );

  it(
    'shows an emulator pixels on each tick, reports them, and lets go on detach',
    async () => {
      const file = join(dir, 'screen.rgba');
      writeFileSync(file, Buffer.alloc(64 * 32 * 4, 200));
      chmodSync(file, 0o600);
      const { v, until } = viewer();
      v.send({ op: 'attach', source: { kind: 'pixels', file, w: 64, h: 32 } });
      v.send({ op: 'tick', w: 64, h: 32 });
      await expect(until('first')).resolves.toMatchObject({ w: 64, h: 32, codec: 'pixels' });
      for (let i = 0; i < 5; i++) v.send({ op: 'tick', w: 64, h: 32 });
      const stats = await until('stats', (m) => Number(m.arrived) > 0);
      expect(stats).toMatchObject({ source: 'pixels', w: 64, h: 32 });
      expect(Number(stats.rssMb)).toBeGreaterThan(0);
      v.send({ op: 'detach' });
      await until('stats', (m) => m.source === 'pixels' && Number(m.arrived) === 0);
      v.send({ op: 'tick', w: 64, h: 32 });
      v.kill();
    },
    COMPILE_MS,
  );

  it(
    'names a simulator that is not there',
    async () => {
      const { v, until } = viewer();
      v.send({
        op: 'attach',
        source: { kind: 'surface', udid: '00000000-0000-0000-0000-000000000000' },
      });
      await expect(until('lost')).resolves.toMatchObject({ why: 'simulator-off' });
      v.kill();
    },
    COMPILE_MS,
  );
});

/** The adb server's two questions and a stand-in agent behind them, with real frames. */
class FakeAgent {
  server!: Server;
  port = 0;
  /** Everything it was asked, in order. */
  asked: string[] = [];
  methods: Record<string, unknown>[] = [];
  socket: Socket | undefined;
  refuse: string | undefined;
  onStart: ((s: Socket) => void) | undefined;

  listen() {
    this.server = createServer((s) => this.serve(s));
    return new Promise<void>((r) =>
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server.address() as { port: number }).port;
        r();
      }),
    );
  }

  private serve(s: Socket) {
    let buf = Buffer.alloc(0);
    let inAgent = false;
    s.on('error', () => undefined);
    s.on('data', (b) => {
      buf = Buffer.concat([buf, b]);
      while (!inAgent && buf.length >= 4) {
        const n = parseInt(buf.subarray(0, 4).toString(), 16);
        if (buf.length < 4 + n) return;
        const q = buf.subarray(4, 4 + n).toString();
        buf = buf.subarray(4 + n);
        this.asked.push(q);
        if (q.startsWith('host:transport') && this.refuse) {
          const m = Buffer.from(this.refuse);
          s.write(`FAIL${m.length.toString(16).padStart(4, '0')}${m.toString()}`);
          s.end();
          return;
        }
        s.write('OKAY');
        if (q.startsWith('localabstract:')) inAgent = true;
      }
      while (inAgent && buf.length >= 5) {
        const n = buf.readUInt32BE(0);
        if (buf.length < 5 + n) return;
        const m = JSON.parse(buf.subarray(5, 5 + n).toString()) as Record<string, unknown>;
        buf = buf.subarray(5 + n);
        this.methods.push(m);
        if (m.method === 'stream.clock')
          this.json(s, { id: m.id, result: { now: Number(process.hrtime.bigint()) } });
        if (m.method === 'stream.start') {
          this.socket = s;
          this.onStart?.(s);
        }
      }
    });
  }

  json(s: Socket, m: unknown) {
    const body = Buffer.from(JSON.stringify(m));
    const head = Buffer.alloc(5);
    head.writeUInt32BE(body.length, 0);
    s.write(Buffer.concat([head, body]));
  }

  video(s: Socket, frame: Buffer) {
    const head = Buffer.alloc(25);
    head.writeUInt32BE(frame.length + 20, 0);
    head.writeUInt8(2, 4);
    s.write(Buffer.concat([head, frame]));
  }
}

const framesOf = (buf: Buffer) => {
  const out: Buffer[] = [];
  for (let at = 0; at < buf.length;) {
    const n = buf.readUInt32BE(at);
    out.push(buf.subarray(at + 5, at + 5 + n));
    at += 5 + n;
  }
  return out;
};

describe('the viewer on an agent stream, through adb', () => {
  const agent = new FakeAgent();
  let frames: Buffer[] = [];

  beforeAll(async () => {
    await agent.listen();
    const { stdout } = await run(testBinary, ['--encode', 'h264', '20'], {
      encoding: 'buffer',
      maxBuffer: 1 << 26,
    });
    frames = framesOf(stdout);
    expect(frames.length).toBeGreaterThan(0);
  }, COMPILE_MS);

  afterAll(() => agent.server.close());

  const source = () => ({
    kind: 'adb',
    serial: 'emulator-9999',
    socket: 'appdyno_x',
    token: 'the-token',
    codec: 'h264',
    adbPort: agent.port,
    start: { failFirst: 2 },
  });

  it('asks adb for the device, then says hello with the token, and only by stdin', async () => {
    agent.asked = [];
    agent.methods = [];
    agent.onStart = (s) => {
      agent.json(s, {
        method: 'stream.info',
        params: { w: 320, h: 240, codec: 'h264', mode: 'top' },
      });
      for (const f of frames) agent.video(s, f);
    };
    const { v, until } = viewer();
    v.send({ op: 'attach', source: source() });
    await expect(until('first')).resolves.toMatchObject({ w: 320, h: 240, codec: 'h264' });
    expect(agent.asked).toEqual(['host:transport:emulator-9999', 'localabstract:appdyno_x']);
    expect(agent.methods[0]).toMatchObject({
      method: 'hello',
      params: { token: 'the-token' },
    });
    expect(agent.methods.find((m) => m.method === 'stream.start')).toMatchObject({
      params: { codec: 'h264', failFirst: 2 },
    });
    expect(existsSync(`/proc/${v.pid}/cmdline`)).toBe(false);
    const stats = await until('stats', (m) => Number(m.arrived) > 0);
    expect(Number(stats.decoded)).toBeGreaterThan(0);
    expect(stats.source).toBe('adb');
    // the end of the connection, and the same viewer on a new one: no new process for a reconnect
    agent.socket!.destroy();
    await expect(until('lost')).resolves.toMatchObject({ why: 'the stream ended', fatal: false });
    const started = agent.methods.filter((m) => m.method === 'stream.start').length;
    v.send({ op: 'attach', source: source() });
    const end = Date.now() + 30_000;
    while (
      agent.methods.filter((m) => m.method === 'stream.start').length === started &&
      Date.now() < end
    )
      await new Promise((r) => setTimeout(r, 50));
    expect(agent.methods.filter((m) => m.method === 'stream.start').length).toBe(started + 1);
    v.kill();
  }, 90_000);

  it(
    'a device adb refuses is said in adb words',
    async () => {
      agent.refuse = "device 'emulator-9999' not found";
      const { v, until } = viewer();
      v.send({ op: 'attach', source: source() });
      await expect(until('lost')).resolves.toMatchObject({
        why: "device 'emulator-9999' not found",
      });
      agent.refuse = undefined;
      v.kill();
    },
    COMPILE_MS,
  );

  it(
    'a refusal of the stream is final, with the reason',
    async () => {
      agent.onStart = (s) =>
        agent.json(s, { id: 3, error: { message: 'no encoder took this display' } });
      const { v, until } = viewer();
      v.send({ op: 'attach', source: source() });
      await expect(until('lost')).resolves.toMatchObject({
        why: 'no encoder took this display',
        fatal: true,
      });
      v.kill();
    },
    COMPILE_MS,
  );

  it(
    'adb not running: said, and not final',
    async () => {
      const { v, until } = viewer();
      v.send({ op: 'attach', source: { ...source(), adbPort: 1 } });
      await expect(until('lost')).resolves.toMatchObject({
        why: 'adb server not reachable',
        fatal: false,
      });
      v.kill();
    },
    COMPILE_MS,
  );
});
