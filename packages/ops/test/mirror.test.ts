import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  viewerBinary,
  type Device,
  type DeviceProvider,
  type Mirror,
  type MirrorSource,
} from '@appdyno/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { holder, startOf } from '../src/claims.js';
import { ServerContext } from '../src/context.js';
import { checkedOps } from './helpers.js';
import { runMirrors, type MirrorRun } from '../src/mirror/parent.js';
import { liveMirror, liveMirrors, writeMirrorFile, type MirrorFile } from '../src/mirror/state.js';
import { DEFAULT_POLICY } from '../src/policy.js';

const dir = mkdtempSync(join(tmpdir(), 'appdyno-mirror-'));
const before = process.env.APPDYNO_STATE_DIR;

// a first use compiles the viewer, on a Mac that may be busy; here it is once, under the state directory
beforeAll(async () => {
  process.env.APPDYNO_STATE_DIR = dir;
  await viewerBinary();
}, 300_000);

afterAll(() => {
  if (before === undefined) delete process.env.APPDYNO_STATE_DIR;
  else process.env.APPDYNO_STATE_DIR = before;
  rmSync(dir, { recursive: true, force: true });
});

const stateFiles = () => {
  try {
    return readdirSync(join(dir, 'mirror')).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
};

/** A device whose mirror shows a little file of pixels, through a real viewer with no window. */
function pixelsDevice(serial: string) {
  const file = join(dir, `${serial}.rgba`);
  writeFileSync(file, Buffer.alloc(8 * 8 * 4, 100));
  chmodSync(file, 0o600);
  const mirror: Mirror = {
    check: async () => ({ ok: true, routes: ['test'] }),
    open: async (_o, _s, tell): Promise<MirrorSource> => {
      setTimeout(() => tell({ op: 'tick', w: 8, h: 8, seq: 1 }), 20);
      return { kind: 'pixels', file, w: 8, h: 8 };
    },
    keyframe: async () => undefined,
    input: async () => undefined,
    close: async () => undefined,
    watch: () => () => undefined,
  };
  return { serial, mirror, close: vi.fn() } as unknown as Device;
}

function context(
  serials: string[],
  over: { noMirror?: boolean; policy?: object; command?: string[] } = {},
) {
  const provider: DeviceProvider = {
    list: async () => serials.map((serial) => ({ serial, state: 'device', ready: true })),
    handles: () => true,
    open: (serial) => {
      const d = pixelsDevice(serial);
      return over.noMirror ? ({ ...d, mirror: undefined } as unknown as Device) : d;
    },
  };
  return new ServerContext({ ...DEFAULT_POLICY, ...over.policy }, [provider], {
    ...(over.command && { mirrorCommand: over.command }),
  });
}

const run = (ctx: ServerContext, o: Partial<MirrorRun> = {}) => {
  const lines: string[] = [];
  const done = runMirrors(ctx, {
    serials: [],
    max: 8,
    options: { quality: 'auto' },
    headless: true,
    noInput: false,
    share: false,
    focus: false,
    inputOnClick: false,
    log: (l) => lines.push(l),
    ...o,
  });
  return { lines, done };
};

const until = async (test: () => boolean, ms = 60_000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`not in ${ms} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** A file as a parent writes it, for a process that is alive. */
const file = (serial: string, pid: number, status: object): MirrorFile => ({
  pid,
  started: startOf(pid),
  session: 'x',
  serial,
  status: { state: 'live', since: 1, inputDropped: 0, inputFailed: 0, ...status } as never,
});

describe('a mirror parent', () => {
  it('runs its time, keeps a file while it does, and leaves nothing behind', async () => {
    const { lines, done } = run(context(['device-a']), { seconds: 3 });
    await until(() => liveMirror('device-a')?.status.state === 'live');
    expect(holder('device-a')?.tool).toBe('appdyno mirror');
    await expect(done).resolves.toBe(0);
    expect(stateFiles()).toEqual([]);
    expect(holder('device-a')).toBeUndefined();
    expect(lines.some((l) => l.startsWith('device-a: live 8x8'))).toBe(true);
    expect(lines.at(-1)).toContain('stopped: time is up');
  }, 120_000);

  it('goes through the claims: another holder is said by name, and --share goes on', async () => {
    const other = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    try {
      const claims = join(dir, 'claims');
      mkdirSync(claims, { recursive: true });
      await until(() => startOf(other.pid!) !== '');
      writeFileSync(
        join(claims, 'device-b.json'),
        JSON.stringify({
          pid: other.pid,
          started: startOf(other.pid!),
          tool: 'another tool',
          since: 'a while ago',
        }),
      );
      const ctx = context(['device-b']);
      const refused = run(ctx, { serials: ['device-b'] });
      await expect(refused.done).resolves.toBe(1);
      expect(refused.lines.join()).toContain(`held by pid ${other.pid} (another tool)`);
      const shared = run(ctx, { serials: ['device-b'], share: true, seconds: 2 });
      await until(() => liveMirror('device-b')?.status.state === 'live');
      expect(holder('device-b')?.tool).toBe('another tool');
      await expect(shared.done).resolves.toBe(0);
      expect(holder('device-b')?.tool).toBe('another tool');
    } finally {
      other.kill();
    }
  }, 120_000);

  it('a device with no mirror, or not allowed, is refused by name', async () => {
    const none = run(context(['device-c'], { noMirror: true }), { serials: ['device-c'] });
    await expect(none.done).resolves.toBe(1);
    expect(none.lines.join()).toContain('no mirror on this kind of device');
    const barred = run(context(['device-d'], { policy: { devices: /^other/ } }), {
      serials: ['device-d'],
    });
    await expect(barred.done).resolves.toBe(1);
    expect(barred.lines.join()).toContain('not allowed');
  }, 60_000);

  it('several devices each have their own; one refused leaves the others', async () => {
    const ctx = context(['device-e', 'device-f', 'device-g']);
    const { lines, done } = run(ctx, { all: true, max: 2, seconds: 3 });
    await until(() => liveMirrors().length === 2);
    expect(lines.join()).toContain('1 more devices left out: --max 2');
    await expect(done).resolves.toBe(0);
    expect(stateFiles()).toEqual([]);
  }, 120_000);

  it('--watch opens a device that comes, once: a window closed stays closed until its device returns', async () => {
    const serials = ['device-w1'];
    const ctx = context(serials);
    const { lines, done } = run(ctx, { all: true, watch: true, seconds: 8 });
    await until(() => liveMirror('device-w1')?.status.state === 'live');
    serials.push('device-w2');
    await until(() => liveMirror('device-w2')?.status.state === 'live');
    await expect(done).resolves.toBe(0);
    expect(lines.filter((l) => l === 'device-w2: connecting')).toHaveLength(1);
    expect(stateFiles()).toEqual([]);
  }, 120_000);

  it('--all with no device says so', async () => {
    const { lines, done } = run(context([]), { all: true });
    await expect(done).resolves.toBe(1);
    expect(lines).toEqual(['no device to mirror']);
  }, 30_000);

  it('a second window on a device is refused, naming the first', async () => {
    const ctx = context(['device-h']);
    writeMirrorFile(file('device-h', process.pid, {}));
    const { lines, done } = run(ctx, { serials: ['device-h'] });
    await expect(done).resolves.toBe(1);
    expect(lines.join()).toContain(`already has a window: pid ${process.pid}`);
    rmSync(join(dir, 'mirror/device-h.json'));
  }, 30_000);
});

describe('what other processes read', () => {
  it('a dead parent is no mirror, and its file goes', () => {
    const dead = { ...file('device-i', process.pid, {}), started: 'long ago' };
    writeMirrorFile(dead);
    expect(liveMirror('device-i')).toBeUndefined();
    expect(stateFiles()).not.toContain('device-i.json');
  });

  it('status says what stands in the way, and when a person touched it', async () => {
    writeMirrorFile(
      file('device-j', process.pid, {
        state: 'waiting',
        need: 'not-connected',
        touchedAt: Date.now() - 3_000,
      }),
    );
    const ops = checkedOps(context(['device-j']));
    const answer = await ops.mirror!.handler({ action: 'status', quality: 'auto' });
    const text = answer.blocks.map((b) => (b.type === 'text' ? b.text : '')).join();
    expect(text).toContain('The device is not connected');
    expect(text).toContain('Connect it');
    expect(text).toMatch(/a person touched it 3 s ago/);
    expect(answer.data).toMatchObject({ mirrors: [{ serial: 'device-j', state: 'waiting' }] });
    rmSync(join(dir, 'mirror/device-j.json'));
  });

  it('stats reads true numbers, and says when none are yet', async () => {
    writeMirrorFile(
      file('device-k', process.pid, {
        stats: {
          arrived: 60,
          shown: 59,
          dropped: 1,
          mbps: 3,
          captureP50: 26,
          captureP95: 31,
          decodeP95: 2,
          source: 'adb',
          mode: 'x',
          w: 720,
          h: 1600,
          cpu: 2,
          rssMb: 90,
        },
      }),
    );
    writeMirrorFile(file('device-l', process.pid, {}));
    const ops = checkedOps(context(['device-k', 'device-l']));
    const answer = await ops.mirror!.handler({ action: 'stats', quality: 'auto' });
    const text = answer.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(text).toContain('59 frames/s shown of 60 arrived');
    expect(text).toContain('p50 26, p95 31 ms');
    expect(text).toContain('device-l: no numbers yet');
    rmSync(join(dir, 'mirror/device-k.json'));
    rmSync(join(dir, 'mirror/device-l.json'));
  });

  it('with nothing open it says so, and close refuses', async () => {
    const ops = checkedOps(context([]));
    await expect(ops.mirror!.handler({ action: 'status', quality: 'auto' })).resolves.toMatchObject(
      {
        data: { done: 'none' },
      },
    );
    await expect(ops.mirror!.handler({ action: 'close', quality: 'auto' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('a device the server may not touch is left out', async () => {
    writeMirrorFile(file('device-m', process.pid, {}));
    const ops = checkedOps(context([], { policy: { devices: /^other/ } }));
    await expect(ops.mirror!.handler({ action: 'status', quality: 'auto' })).resolves.toMatchObject(
      {
        data: { done: 'none' },
      },
    );
    rmSync(join(dir, 'mirror/device-m.json'));
  });
});

describe('open and close from a tool', () => {
  /** What the detached parent would do: writes its file, stays until told, and goes. */
  const parentScript = (serial: string) => `
    const { execFileSync } = require('node:child_process');
    const { mkdirSync, renameSync, rmSync, writeFileSync } = require('node:fs');
    const { join } = require('node:path');
    const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { encoding: 'utf8' }).trim();
    const to = join(process.env.APPDYNO_STATE_DIR, 'mirror', '${serial}.json');
    mkdirSync(join(process.env.APPDYNO_STATE_DIR, 'mirror'), { recursive: true });
    writeFileSync(to + '.t', JSON.stringify({ pid: process.pid, started, session: 's', serial: '${serial}',
      status: { state: 'live', since: 1, inputDropped: 0, inputFailed: 0 } }));
    renameSync(to + '.t', to);
    console.log(process.argv.slice(2).join(' '));
    process.on('SIGTERM', () => { rmSync(to, { force: true }); process.exit(0); });
    process.on('SIGUSR2', () => {});
    setInterval(() => {}, 1000);
  `;

  it('open starts a parent that outlives the call, and close ends it', async () => {
    const script = join(dir, 'parent.cjs');
    writeFileSync(script, parentScript('device-n'));
    const ctx = context(['device-n'], { command: [process.execPath, script] });
    const ops = checkedOps(ctx);
    const opened = await ops.mirror!.handler({ action: 'open', quality: 'standard' });
    expect(opened.data).toMatchObject({
      done: 'open',
      mirrors: [{ serial: 'device-n', state: 'live' }],
    });
    const live = liveMirror('device-n')!;
    expect(live.pid).not.toBe(process.pid);
    const again = await ops.mirror!.handler({ action: 'open', quality: 'auto' });
    expect(again.data).toMatchObject({ done: 'already open' });
    const closed = await ops.mirror!.handler({ action: 'close', quality: 'auto' });
    expect(closed.data).toMatchObject({ mirrors: [] });
    expect(liveMirror('device-n')).toBeUndefined();
  }, 60_000);

  it('a parent that ends at once is a refusal with its last word', async () => {
    const script = join(dir, 'ends.cjs');
    writeFileSync(script, `console.log('device-o: stopped: No compiler for the viewer');`);
    const ops = checkedOps(context(['device-o'], { command: [process.execPath, script] }));
    await expect(ops.mirror!.handler({ action: 'open', quality: 'auto' })).rejects.toThrow(
      /No compiler/,
    );
  }, 60_000);

  it('a host with no way to start a window says so', async () => {
    const ops = checkedOps(context(['device-p']));
    await expect(ops.mirror!.handler({ action: 'open', quality: 'auto' })).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  });
});
