import { execFile, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ViewerProcess, viewerBinary, type ViewerMessage } from '../src/index.js';

const run = promisify(execFile);
const FIXTURES = join(import.meta.dirname, '../../../mirror/Viewer/fixtures');
/** The first use compiles it, on a Mac that may be busy. */
const COMPILE_MS = 300_000;

let binary: string;
const dir = mkdtempSync(join(tmpdir(), 'appdyno-viewer-'));

beforeAll(async () => {
  binary = await viewerBinary();
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
      setTimeout(() => fail(new Error(`no ${op}: ${JSON.stringify(said).slice(-400)}`)), 30_000);
    });
  return { v, said, until };
}

const exited = (v: ViewerProcess) => new Promise<string>((r) => v.onExit(r));

describe('the viewer, compiled by its first-use path', () => {
  it('passes its self test: real frames, bad input, the sums a window rests on', async () => {
    // a failed check exits 1, and it is the lines that say which
    const { stdout } = await run(binary, ['--selftest', FIXTURES], { timeout: 180_000 }).catch(
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
  }, 200_000);

  it('says it is ready, and ends with its stdin', async () => {
    const { v, until } = viewer();
    await until('ready');
    const end = exited(v);
    v.kill();
    await end;
  }, 60_000);

  it('a parent that dies by SIGKILL takes its viewer with it', async () => {
    // a parent of its own, killed as a crash would: the viewer sees its stdin end
    const parent = spawn(
      process.execPath,
      [
        '-e',
        `const {spawn}=require('node:child_process');const c=spawn(${JSON.stringify(binary)},['--headless'],{stdio:['pipe','inherit','inherit']});process.stdout.write(String(c.pid)+'\\n');setInterval(()=>{},1000);`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const pid = await new Promise<number>((r) =>
      parent.stdout.once('data', (b: Buffer) => r(parseInt(b.toString()))),
    );
    expect(pid).toBeGreaterThan(0);
    process.kill(parent.pid!, 'SIGKILL');
    const end = Date.now() + 20_000;
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
  }, 60_000);

  it('a kind it does not know is said so, and it stays', async () => {
    const { v, until } = viewer();
    v.send({ op: 'attach', source: { kind: 'no-such' } });
    await expect(until('lost')).resolves.toMatchObject({ fatal: true });
    v.send({ op: 'status', state: 'live' });
    v.send('not json' as never);
    await until('stats');
    const end = exited(v);
    v.send({ op: 'quit' });
    await end;
  }, 60_000);

  it('shows an emulator pixels on each tick, reports them, and lets go on detach', async () => {
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
  }, 60_000);

  it('names a simulator that is not there', async () => {
    const { v, until } = viewer();
    v.send({
      op: 'attach',
      source: { kind: 'surface', udid: '00000000-0000-0000-0000-000000000000' },
    });
    await expect(until('lost')).resolves.toMatchObject({ why: 'simulator-off' });
    v.kill();
  }, 60_000);
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
    const { stdout } = await run(binary, ['--encode', 'h264', '20'], {
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

  it('a device adb refuses is said in adb words', async () => {
    agent.refuse = "device 'emulator-9999' not found";
    const { v, until } = viewer();
    v.send({ op: 'attach', source: source() });
    await expect(until('lost')).resolves.toMatchObject({ why: "device 'emulator-9999' not found" });
    agent.refuse = undefined;
    v.kill();
  }, 60_000);

  it('a refusal of the stream is final, with the reason', async () => {
    agent.onStart = (s) =>
      agent.json(s, { id: 3, error: { message: 'no encoder took this display' } });
    const { v, until } = viewer();
    v.send({ op: 'attach', source: source() });
    await expect(until('lost')).resolves.toMatchObject({
      why: 'no encoder took this display',
      fatal: true,
    });
    v.kill();
  }, 60_000);

  it('adb not running: said, and not final', async () => {
    const { v, until } = viewer();
    v.send({ op: 'attach', source: { ...source(), adbPort: 1 } });
    await expect(until('lost')).resolves.toMatchObject({
      why: 'adb server not reachable',
      fatal: false,
    });
    v.kill();
  }, 60_000);
});
