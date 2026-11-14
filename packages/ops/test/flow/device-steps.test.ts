import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePng, type Mirror } from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { flowsFor, flowHelpers } from './harness.js';

const W = 108;
const H = 240;

/** A screen as a PNG, its lower half in `lower`: the status band at the top is left out of a comparison. */
function picture(lower: number) {
  const data = Buffer.alloc(W * H * 3, 200);
  data.fill(lower, (W * H * 3) / 2);
  return encodePng({ width: W, height: H, channels: 3, data });
}

describe('screenshot, visual and setting steps', () => {
  let dir: string;
  let device: FakeDevice;
  let screen: Buffer;
  const { context, refusal } = flowHelpers(
    () => device,
    () => dir,
  );
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-flow-'));
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
    device = new FakeDevice();
    screen = picture(40);
    device.screenshot = () =>
      Promise.resolve({ meta: { w: W, h: H, format: 'png', bytes: screen.length }, data: screen });
    // no window's own picture: the device's is the one taken
    device.mirror = {} as Mirror;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const flowFile = (body: string, name = 'a.flow') => {
    const file = join(dir, 'flows', name);
    mkdirSync(join(dir, 'flows'), { recursive: true });
    writeFileSync(file, `app dev.app\n${body}\n`);
    return file;
  };
  const baseline = (name: string) => join(dir, 'flows', 'baselines', `${name}.png`);

  it('keeps a screenshot step under the run’s folder, and takes it anew on the next run', async () => {
    const file = flowFile('screenshot home');
    const flows = flowsFor(context());
    const shots = join(dir, 'shots');
    expect((await flows.replay(file, { shots })).passed).toBe(true);
    expect(existsSync(join(shots, 'home.png'))).toBe(true);
    expect((await flows.replay(file, { shots })).passed).toBe(true);
  });

  it('saves baselines beside the flow with --update-baselines, then passes against them', async () => {
    const file = flowFile('visual home\nvisual list tolerance=1 mask=0,0,1080,200');
    const saved = await flowsFor(context([], { updateBaselines: true })).replay(file);
    expect(saved.passed).toBe(true);
    expect(existsSync(baseline('home'))).toBe(true);
    expect(existsSync(baseline('list'))).toBe(true);
    expect((await flowsFor(context()).replay(file)).passed).toBe(true);
  });

  it('fails the flow on a screen that differs from its baseline, naming the diff', async () => {
    const file = flowFile('launch\nvisual home');
    await flowsFor(context([], { updateBaselines: true })).replay(file);
    screen = picture(250);
    const r = await flowsFor(context()).replay(file);
    expect(r.passed).toBe(false);
    expect(r.failure).toMatchObject({ n: 2, line: 3, step: 'visual home', code: 'CHECK_FAILED' });
    const diff = join(dir, 'flows', 'baselines', 'home.diff.png');
    expect(r.failure?.message).toContain(`diff ${diff}`);
    expect(existsSync(diff)).toBe(true);
  });

  it('compares a step of a flow another runs with that file’s own baselines', async () => {
    mkdirSync(join(dir, 'flows', 'shared'), { recursive: true });
    writeFileSync(join(dir, 'flows', 'shared', 'look.flow'), 'visual card\n');
    const file = flowFile('run shared/look.flow');
    await flowsFor(context([], { updateBaselines: true })).replay(file);
    expect(existsSync(join(dir, 'flows', 'shared', 'baselines', 'card.png'))).toBe(true);
  });

  it('refuses a flow with no baseline to compare before its first step, saying how to save one', async () => {
    const file = flowFile('launch\nvisual home');
    const e = await refusal(flowsFor(context()).replay(file));
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toBe(
      `${file}:3: no baseline ${baseline('home')}: appdyno test or flow run with --update-baselines saves it`,
    );
    expect(device.calls.some((c) => c.name === 'launch')).toBe(false);
  });

  it('changes a device setting through device_setting, and puts it back with setting restore', async () => {
    const held: Record<string, string> = { dark_mode: 'off' };
    device.settings = {
      get: (name) => Promise.resolve(held[name] ?? 'none'),
      set: (name, value) => {
        held[name] = value;
        return Promise.resolve(undefined);
      },
    };
    const file = flowFile('setting dark_mode on\nassert text="Ana sayfa"\nsetting restore');
    const r = await flowsFor(context()).replay(file);
    expect(r.passed).toBe(true);
    expect(r.steps.map((s) => s.step)).toEqual([
      'setting dark_mode on',
      'assert text="Ana sayfa"',
      'setting restore',
    ]);
    expect(held.dark_mode).toBe('off');
  });
});
