import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePng, type AddedMedia, type Device, type Mirror } from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseFlow } from '@appdyno/flows';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { flowFiles } from '../../src/index.js';
import { LOOK } from '../../src/flow/still.js';
import { conditions } from '../../src/settings.js';
import { callerOf, flowsFor, flowHelpers } from './harness.js';

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
  const { context, refusal, recorded } = flowHelpers(
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
    vi.restoreAllMocks();
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

  /** A screen whose small looks are each new for the first `moving` of them, and still after. */
  const settling = (moving: number) => {
    let looks = 0;
    device.screenshot = (o?: Parameters<Device['screenshot']>[0]) => {
      const fresh = o === LOOK && looks++ < moving;
      const data = fresh ? Buffer.from([looks]) : screen;
      return Promise.resolve({ meta: { w: W, h: H, format: 'png', bytes: data.length }, data });
    };
    return () => looks;
  };

  it('takes a picture once the screen has looked the same for half a second', async () => {
    const looks = settling(3);
    const r = await flowsFor(context()).replay(flowFile('screenshot home'), {
      shots: join(dir, 'shots'),
    });
    expect(r.passed).toBe(true);
    expect(looks()).toBeGreaterThan(4);
    expect(r.steps[0]?.ms).toBeGreaterThanOrEqual(500);
    expect(r.steps[0]?.ms).toBeLessThan(5_000);
  });

  it('takes a screen that never holds still at five seconds, for its masks to decide', async () => {
    settling(Infinity);
    await flowsFor(context([], { updateBaselines: true })).replay(flowFile('visual ticker'));
    const r = await flowsFor(context()).replay(flowFile('visual ticker'));
    expect(r.passed).toBe(true);
    expect(r.steps[0]?.ms).toBeGreaterThanOrEqual(5_000);
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

  /** Each setting as the device reads it; `seen`: each change, and each picture kept with the dark mode it was in. */
  const settingsOf = (held: Record<string, string>, seen: string[] = []) => {
    device.settings = {
      get: (name) => Promise.resolve(held[name] ?? 'none'),
      set: (name, value) => {
        held[name] = value;
        seen.push(`${name} ${value}`);
        return Promise.resolve(undefined);
      },
    };
    const take = device.screenshot.bind(device);
    device.screenshot = (o?: Parameters<Device['screenshot']>[0]) => {
      // the small looks that wait for a still screen are not the picture a step keeps
      if (o !== LOOK) seen.push(`picture in dark_mode ${String(held.dark_mode)}`);
      return take();
    };
    return seen;
  };

  it('changes a device setting through device_setting, and puts it back with setting restore', async () => {
    const held: Record<string, string> = { dark_mode: 'off' };
    settingsOf(held);
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

  it('records a setting, a comparison and a picture kept in a file as their steps, a look as none', async () => {
    settingsOf({ dark_mode: 'off' });
    const call = callerOf(context());
    const baselines = join(dir, 'state', 'b');
    const { text } = await recorded(call, async () => {
      await call('device_setting', { name: 'dark_mode', value: 'on' });
      await call('device_setting', { name: 'dark_mode' });
      await call('device_setting', { name: 'locale', value: 'tr-TR', app: 'org.example' });
      await call('visual', { action: 'baseline', name: 'home', dir: baselines });
      await call('visual', {
        action: 'compare',
        name: 'home',
        dir: baselines,
        tolerance: 0.5,
        masks: [{ text: 'Ana sayfa' }, { x: -10, y: 2000, w: 1080, h: 400 }],
      });
      await call('screenshot', { file: join(dir, 'state', 'shots', 'Home page.png') });
      await call('screenshot');
      await call('device_setting', { name: 'restore', value: 'all' });
    });
    expect(text).toBe(`app dev.app

setting dark_mode on
setting locale tr-TR app=org.example
visual home
visual home tolerance=0.5 mask="text=\\"Ana sayfa\\"" mask="-10,2000,1080,400"
screenshot Home_page
setting restore
`);
    expect(parseFlow(text).steps).toHaveLength(6);
  });

  it('records a shake, a memory warning with no level and an end in the background, and replays them so', async () => {
    const got: string[] = [];
    device = Object.assign(new FakeDevice(), {
      shake: () => {
        got.push('shake');
        return Promise.resolve(undefined);
      },
      memoryWarning: (app: string, level?: string) => {
        got.push(`memory warning to ${app}${level ? ` at ${level}` : ''}`);
        return Promise.resolve(undefined);
      },
      endInBackground: (app: string) => {
        got.push(`${app} ended in the background`);
        return Promise.resolve(undefined);
      },
    });
    const call = callerOf(context());
    const { file, text } = await recorded(call, async () => {
      await call('device_setting', { name: 'shake' });
      await call('device_setting', { name: 'memory_warning' });
      await call('device_setting', { name: 'memory_warning', value: 'RUNNING_LOW' });
      await call('terminate_app', { background: true });
    });
    expect(text).toBe(`app dev.app

setting shake
setting memory_warning
setting memory_warning RUNNING_LOW
stop background
`);
    got.length = 0;
    await call('flow', { action: 'run', file });
    expect(got).toEqual([
      'shake',
      'memory warning to dev.app',
      'memory warning to dev.app at RUNNING_LOW',
      'dev.app ended in the background',
    ]);
  });

  describe('a test run', () => {
    const test = (
      o: { retries?: number; iterations?: number; log?: (line: string) => void } = {},
    ) => {
      const artifacts = join(dir, 'artifacts');
      return flowsFor(context()).test({
        files: flowFiles([join(dir, 'flows')]),
        devices: [],
        artifacts,
        junit: join(artifacts, 'j.xml'),
        ...o,
      });
    };

    it('puts back what each file changed before the next file’s first step', async () => {
      const seen = settingsOf({ dark_mode: 'off' });
      flowFile('setting dark_mode on\nscreenshot dark', 'a.flow');
      flowFile('screenshot plain', 'b.flow');
      expect((await test()).passed).toBe(true);
      expect(seen).toEqual([
        'dark_mode on',
        'picture in dark_mode on',
        'dark_mode off',
        'picture in dark_mode off',
      ]);
      const kept = join(dir, 'artifacts', device.serial);
      expect(existsSync(join(kept, 'a.flow', 'dark.png'))).toBe(true);
      expect(existsSync(join(kept, 'b.flow', 'plain.png'))).toBe(true);
    });

    /** A device that takes out what it added, as an Android one: each of the two said in `seen`, `left` not its to delete. */
    const takingMedia = (seen: string[], left: string[] = []) => {
      const root = realpathSync(dir);
      vi.spyOn(process, 'cwd').mockReturnValue(root);
      writeFileSync(join(root, 'photo.png'), 'x');
      let held: ReturnType<AddedMedia['holder']>;
      const addedMedia: AddedMedia = {
        owner: undefined,
        holder: () => held,
        takeOut: () => {
          seen.push('photo taken out');
          held = undefined;
          return Promise.resolve({ removed: left.length > 0 ? [] : ['photo.png'], left });
        },
      };
      Object.assign(device, {
        addedMedia,
        addMedia: () => {
          seen.push('photo added');
          held = { owner: addedMedia.owner };
          return Promise.resolve(undefined);
        },
      });
    };

    it('takes out the photos a file added before the next file’s first step', async () => {
      const seen = settingsOf({ dark_mode: 'off' });
      takingMedia(seen);
      flowFile('setting media photo.png', 'a.flow');
      flowFile('screenshot plain', 'b.flow');
      const lines: string[] = [];
      expect((await test({ log: (l) => lines.push(l) })).passed).toBe(true);
      expect(seen).toEqual(['photo added', 'photo taken out', 'picture in dark_mode off']);
      expect(lines.join('\n')).not.toContain('could not put back');
    });

    it('says a photo it could not take out, and takes nothing where a file added none', async () => {
      const seen = settingsOf({ dark_mode: 'off' });
      takingMedia(seen, ['/sdcard/Pictures/appdyno/photo.png']);
      flowFile('setting media photo.png', 'a.flow');
      flowFile('screenshot plain', 'b.flow');
      const lines: string[] = [];
      expect((await test({ log: (l) => lines.push(l) })).passed).toBe(true);
      expect(lines).toContain(
        '  could not put back after a.flow: media: left /sdcard/Pictures/appdyno/photo.png in the library: changed since it was added',
      );
      // b.flow added nothing: nothing is asked of the library after it
      expect(seen.filter((x) => x === 'photo taken out')).toHaveLength(1);
    });

    it('puts back after each attempt of a file it retries, its failure’s picture taken first', async () => {
      const seen = settingsOf({ dark_mode: 'off' });
      flowFile('setting dark_mode on\nassert text="Nowhere" timeoutMs=200');
      expect((await test({ retries: 1 })).passed).toBe(false);
      const attempt = ['dark_mode on', 'picture in dark_mode on', 'dark_mode off'];
      expect(seen).toEqual([...attempt, ...attempt]);
    });

    it('puts back a measured file after its iterations, not between them', async () => {
      const seen = settingsOf({ dark_mode: 'off' });
      flowFile('setting dark_mode on\nassert text="Ana sayfa"');
      expect((await test({ iterations: 2 })).passed).toBe(true);
      expect(seen).toEqual(['dark_mode on', 'dark_mode on', 'dark_mode on', 'dark_mode off']);
    });

    it('leaves alone what was changed before the run', async () => {
      const held = { dark_mode: 'off', text_size: '1.3' };
      settingsOf(held);
      conditions.write(device.serial, { text_size: { was: '1.0' } });
      flowFile('setting dark_mode on');
      expect((await test()).passed).toBe(true);
      expect(held).toEqual({ dark_mode: 'off', text_size: '1.3' });
      expect(conditions.read(device.serial)).toEqual({ text_size: { was: '1.0' } });
    });
  });
});
