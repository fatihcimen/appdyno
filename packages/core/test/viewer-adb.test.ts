import { existsSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { must } from '../src/must.js';
import { COMPILE_MS, compiled, run, viewer } from './viewer-helpers.js';

const built = compiled();

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
    const { stdout } = await run(built.testBinary, ['--encode', 'h264', '20'], {
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
    const { v, until } = viewer(built.binary);
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
    expect(existsSync(`/proc/${String(v.pid)}/cmdline`)).toBe(false);
    const stats = await until('stats', (m) => Number(m.arrived) > 0);
    expect(Number(stats.decoded)).toBeGreaterThan(0);
    expect(stats.source).toBe('adb');
    // the end of the connection, and the same viewer on a new one: no new process for a reconnect
    must(agent.socket, 'its connection').destroy();
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
      const { v, until } = viewer(built.binary);
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
      const { v, until } = viewer(built.binary);
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
      const { v, until } = viewer(built.binary);
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
