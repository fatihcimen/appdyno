import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Device, DeviceProvider } from '@appdyno/core';
import { noiseOf } from '@appdyno/perf';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { activityFollower, activityFor, appendActivity } from '../src/activity.js';
import { inCall, must, startOf } from '@appdyno/core';
import { ServerContext } from '../src/context.js';
import { handoffDone, handoffOps, handoffRequest } from '../src/mirror/handoff.js';
import { removeMirrorFile, writeMirrorFile } from '../src/mirror-state.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { reply, type Op } from '../src/tool.js';
import { z } from 'zod';

const dir = mkdtempSync(join(tmpdir(), 'appdyno-guards-'));
const before = process.env.APPDYNO_STATE_DIR;

beforeAll(() => {
  process.env.APPDYNO_STATE_DIR = dir;
});

afterAll(() => {
  if (before === undefined) delete process.env.APPDYNO_STATE_DIR;
  else process.env.APPDYNO_STATE_DIR = before;
  rmSync(dir, { recursive: true, force: true });
});

const op = (name: string, run: () => Promise<void> = () => Promise.resolve(undefined)): Op => ({
  name,
  title: name,
  description: name,
  input: z.object({}).loose(),
  output: z.object({}),
  annotations: { openWorldHint: false },
  handler: async () => {
    await run();
    return reply('ok', {});
  },
});

function context(
  hash: () => string = () => 'same',
  alertPerson?: (reason: string) => void,
  silent = false,
) {
  const device = {
    serial: 'guarded',
    open: () => Promise.resolve({}),
    close: () => undefined,
    tree: () => Promise.resolve({ hash: hash(), nodes: [], windows: [] }),
  } as unknown as Device;
  const provider: DeviceProvider = {
    list: () => Promise.resolve([{ serial: 'guarded', state: 'device', ready: true }]),
    handles: () => true,
    open: () => device,
  };
  return new ServerContext({ ...DEFAULT_POLICY, secrets: ['hunter2'] }, [provider], {
    device: 'guarded',
    ...(alertPerson && { alertPerson }),
    ...(silent && { silent }),
  });
}

const activityFile = () => join(dir, 'activity/guarded.jsonl');
const readActivity = () =>
  readFileSync(activityFile(), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { tool: string; ok: boolean; ms: number; args: unknown });

describe('the activity of a device', () => {
  it('holds each call with how it went, typed text by its length and secrets hidden', async () => {
    const ctx = context();
    ctx.currentSerial = 'guarded';
    const wrap = activityFor(ctx);
    rmSync(activityFile(), { force: true });
    await wrap(op('type_text')).handler({ text: 'hello there' });
    await wrap(op('tap')).handler({ selector: { text: 'hunter2' } });
    await expect(
      wrap(op('terminate_app', () => Promise.reject(new Error('nope')))).handler({}),
    ).rejects.toThrow('nope');
    const lines = readActivity();
    expect(lines.map((l) => [l.tool, l.ok])).toEqual([
      ['type_text', true],
      ['tap', true],
      ['terminate_app', false],
    ]);
    expect(JSON.stringify(lines[0]?.args)).toContain('(11 characters)');
    expect(JSON.stringify(lines)).not.toContain('hello there');
    expect(JSON.stringify(lines)).not.toContain('hunter2');
  });

  it('names the client that drives, as a person knows it', async () => {
    rmSync(activityFile(), { force: true });
    const ctx = new ServerContext(DEFAULT_POLICY, [], { clientNamed: (s) => `${s} by name` });
    ctx.currentSerial = 'guarded';
    await inCall({ client: 'said' }, () => activityFor(ctx)(op('tap')).handler({}));
    expect(readActivity()[0]).toMatchObject({ tool: 'tap', client: 'said by name' });
  });

  it('leaves out what is no agent acting on the device', async () => {
    const ctx = context();
    ctx.currentSerial = 'guarded';
    const wrap = activityFor(ctx);
    rmSync(activityFile(), { force: true });
    await wrap(op('mirror')).handler({});
    await wrap(op('hand_off')).handler({});
    expect(existsSync(activityFile())).toBe(false);
  });

  it('a follower sees what comes after it began, and a line only when it is whole', () => {
    rmSync(activityFile(), { force: true });
    appendActivity('guarded', { at: 1, tool: 'old', ms: 1, ok: true, args: {} });
    const lines = activityFollower('guarded');
    expect(lines()).toEqual([]);
    appendActivity('guarded', { at: 2, tool: 'new', ms: 1, ok: true, args: {} });
    expect(lines().map((l) => l.tool)).toEqual(['new']);
    writeFileSync(activityFile(), `${readFileSync(activityFile(), 'utf8')}{"tool":"ha`);
    expect(lines()).toEqual([]);
    writeFileSync(activityFile(), `${readFileSync(activityFile(), 'utf8')}lf"}\n`);
    expect(lines().map((l) => l.tool)).toEqual(['half']);
  });

  it('stays small through a long session', () => {
    rmSync(activityFile(), { force: true });
    const args = { pad: 'x'.repeat(1_000) };
    for (let i = 0; i < 400; i++)
      appendActivity('guarded', { at: i, tool: 't', ms: 1, ok: true, args });
    expect(readFileSync(activityFile(), 'utf8').length).toBeLessThan(260 * 1024);
    expect(readActivity().at(-1)).toMatchObject({ tool: 't' });
  });
});

describe('hand_off', () => {
  const handOff = (ctx: ServerContext) => must(handoffOps(ctx)[0], 'hand_off');

  it('with a window: waits for a person to say done, and alerts by the window alone', async () => {
    const alert = vi.fn();
    const ctx = context(undefined, alert);
    writeMirrorFile({
      pid: process.pid,
      started: startOf(process.pid),
      session: 's',
      serial: 'guarded',
      status: { state: 'live', since: 1, inputDropped: 0, inputFailed: 0 },
    });
    try {
      const asked = handOff(ctx).handler({ reason: 'Face ID', timeoutS: 30 });
      const end = Date.now() + 5_000;
      while (!handoffRequest('guarded') && Date.now() < end)
        await new Promise((r) => setTimeout(r, 20));
      const request = must(handoffRequest('guarded'), 'the request');
      expect(request.reason).toBe('Face ID');
      handoffDone('guarded', 'another request');
      await new Promise((r) => setTimeout(r, 400));
      expect(handoffRequest('guarded')).toBeDefined();
      handoffDone('guarded', request.id);
      await expect(asked).resolves.toMatchObject({ data: { by: 'person' } });
      expect(alert).not.toHaveBeenCalled();
      expect(handoffRequest('guarded')).toBeUndefined();
    } finally {
      removeMirrorFile('guarded');
    }
  }, 30_000);

  it('with no window: alerts by itself, and goes on when the screen changes', async () => {
    const alert = vi.fn();
    let hash = 'before';
    const ctx = context(() => hash, alert);
    const asked = handOff(ctx).handler({ reason: 'the passcode', timeoutS: 30 });
    await new Promise((r) => setTimeout(r, 400));
    expect(alert).toHaveBeenCalledWith('the passcode');
    hash = 'after';
    await expect(asked).resolves.toMatchObject({ data: { by: 'screen' } });
  }, 30_000);

  it('on a server run --silent, tells the window to show it with no sound', async () => {
    const quiet = context(undefined, undefined, true);
    const asked = handOff(quiet).handler({ reason: 'Face ID', timeoutS: 1 });
    const end = Date.now() + 5_000;
    while (!handoffRequest('guarded') && Date.now() < end)
      await new Promise((r) => setTimeout(r, 20));
    expect(handoffRequest('guarded')).toMatchObject({ reason: 'Face ID', silent: true });
    await asked;
    const loud = context();
    const again = handOff(loud).handler({ reason: 'Face ID', timeoutS: 1 });
    while (!handoffRequest('guarded') && Date.now() < end)
      await new Promise((r) => setTimeout(r, 20));
    expect(handoffRequest('guarded')).not.toHaveProperty('silent');
    await again;
  }, 30_000);

  it('at the time it was given it says no one came, and takes the request down', async () => {
    const ctx = context();
    await expect(
      handOff(ctx).handler({ reason: 'Allow Paste', timeoutS: 1 }),
    ).resolves.toMatchObject({
      data: { by: 'timeout' },
    });
    expect(handoffRequest('guarded')).toBeUndefined();
  }, 30_000);
});

describe('a measure on a mirrored device', () => {
  it('is marked, naming the mirror', () => {
    const device = { virtual: false } as never;
    const load = { host: [1], hostCpus: 8 };
    const run = { device, build: 'release', thermal: 0 };
    expect(noiseOf({ load, ...run } as never)).toEqual([]);
    expect(noiseOf({ load: { ...load, mirrored: true }, ...run } as never)).toEqual(['mirrored']);
  });
});
