import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, assert, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { Adb, androidProvider, imageSize, simulatorProvider, Simctl } from './workspace.js';
import { type Answer, type Call, IPHONE, onIphone, opsOn, SIM_FIXTURE } from './helpers.js';

/**
 * The small arguments, each against what the device says, on the devices the variables name. On a phone what was set
 * goes back in a `finally`, an iPhone's accessibility is only read, and the assistant is left to emulators and simulators.
 */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const EMULATOR = ANDROID.startsWith('emulator-');
const SIMULATOR = process.env.APPDYNO_IOS_UDID ?? '';
/** One for the file: a describe in a folder of its own finds no agent there, and the one it starts ends the last. */
const STATE = mkdtempSync(join(tmpdir(), 'appdyno-small-'));

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

describe.skipIf(!ANDROID)('small tools on Android', () => {
  const shell = (...words: string[]) =>
    execFileSync('adb', ['-s', ANDROID, 'shell', ...words], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  let o: ReturnType<typeof opsOn>;
  let call: Call;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', STATE);
    o = opsOn(androidProvider(new Adb()), ANDROID, APP);
    call = o.call;
    ok(await call('launch_app'));
  });
  afterAll(async () => {
    await call('set_orientation', { orientation: 'portrait' });
    await call('device_setting', { name: 'restore' });
    o.ctx.close();
  });

  it('mutes the media stream and turns it back', async () => {
    const muted = () => /- STREAM_MUSIC:\s+Muted: (\w+)/.exec(shell('dumpsys', 'audio'))?.[1];
    expect(muted()).toBe('false');
    try {
      ok(await call('press_key', { key: 'mute' }));
      expect(muted()).toBe('true');
    } finally {
      await call('press_key', { key: 'mute' });
    }
    expect(muted()).toBe('false');
  });

  it.skipIf(!EMULATOR)('calls the assistant', async () => {
    expect(ok(await call('press_key', { key: 'siri' })).text).toContain('not read');
    ok(await call('press_key', { key: 'home', read: 'none' }));
    // the assistant's sheet takes a moment to go, and leaves no window to read until it has
    await vi.waitFor(async () => ok(await call('launch_app')), {
      timeout: 15_000,
      interval: 1_000,
    });
  });

  it('fixes a position and ends it, with no test provider left', async () => {
    try {
      ok(await call('set_location', { lat: 41.01, lon: 28.97 }));
      expect(shell('dumpsys', 'location')).toContain('[mock]');
    } finally {
      ok(await call('set_location', { clear: true }));
    }
    expect(shell('dumpsys', 'location')).not.toContain('[mock]');
  });

  it('takes a picture of a width, and no wider than the screen', () => atWidth(call));

  it('launches an app by its name', () => byName(call));

  it('saves a picture at the size of the screen', async () => {
    // a phone's screen is a person's: no picture of it stays
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-shot-'));
    const saved = await savedWidth(call, dir);
    rmSync(dir, { recursive: true });
    expect(saved).toBe(ok(await call('device_info')).data.screen.w);
  });

  it('turns to each of the four rotations, as the device says', async () => {
    for (const [i, orientation] of ['landscape_left', 'upside_down', 'landscape_right'].entries()) {
      ok(await call('set_orientation', { orientation, read: 'none' }));
      expect(shell('settings', 'get', 'system', 'user_rotation')).toBe(String(i + 1));
    }
    ok(await call('set_orientation', { orientation: 'portrait', read: 'none' }));
    expect(shell('settings', 'get', 'system', 'user_rotation')).toBe('0');
  });
});

/** The width of the picture saved in `dir`: the answer's own image is the one shown, at most 800 px. */
const savedWidth = async (call: Call, dir: string) => {
  const file = join(dir, 'screen.png');
  ok(await call('screenshot', { file }));
  return imageSize(readFileSync(file))?.w;
};

/** The language the fixture says it was launched in. */
const language = async (call: Call) => {
  ok(await call('open_link', { url: 'appdyno-fixture://open/locale' }));
  const [seen] = ok(await call('find', { selector: { id: 'result' } })).data.matches;
  assert(seen);
  return seen.label;
};

const inPoints = async (call: Call) => {
  const r = ok(await call('screenshot', { points: true }));
  const { w, h } = ok(await call('device_info')).data.screen;
  expect([r.data.width, r.data.height]).toEqual([w, h]);
  expect(r.data.scale).toBe(1);
};

const atWidth = async (call: Call) => {
  expect(Math.abs(ok(await call('screenshot', { width: 200 })).data.width - 200)).toBeLessThan(2);
  const { w, density } = ok(await call('device_info')).data.screen;
  // Android's units are pixels already, and its density is in dpi
  const full = density < 10 ? Math.round(w * density) : w;
  expect(ok(await call('screenshot', { width: 8_000 })).data.width).toBe(full);
};

/** A landscape and back, seen in where the app puts a row. */
const turns = async (call: Call) => {
  await call('terminate_app');
  ok(await call('launch_app'));
  const y = async () => {
    const [row] = ok(await call('find', { selector: { text: 'Permission' } })).data.matches;
    assert(row);
    return row.y;
  };
  const upright = await y();
  try {
    ok(await call('set_orientation', { orientation: 'landscape_right', read: 'none' }));
    await vi.waitFor(async () => expect(await y()).not.toBe(upright), { timeout: 8_000 });
  } finally {
    ok(await call('set_orientation', { orientation: 'portrait', read: 'none' }));
  }
  await vi.waitFor(async () => expect(await y()).toBe(upright), { timeout: 8_000 });
};

/** By what a launcher shows: the fixture's name is the same on every device. */
const byName = async (call: Call) => {
  await call('terminate_app');
  expect(ok(await call('launch_app', { app: 'appdyno fixture' })).text).toContain(`started ${APP}`);
  expect(ok(await call('device_info')).data.foreground).toBe(APP);
  expect((await call('launch_app', { app: 'no such app' })).data.code).toBe('NOT_FOUND');
};

describe.skipIf(!ANDROID)('a language on Android', () => {
  it('stays with the app until it is put back', async () => {
    const { call, ctx } = opsOn(androidProvider(new Adb()), ANDROID, APP);
    ok(await call('launch_app', { language: 'de-DE' }));
    expect(await language(call)).toContain('de-DE');
    ok(await call('device_setting', { name: 'restore' }));
    await call('terminate_app');
    ok(await call('launch_app'));
    expect(await language(call)).not.toContain('de-DE');
    ctx.close();
  });
});

describe.skipIf(!ANDROID)('accessibility on Android', () => {
  let call: Call;
  const shell = (...words: string[]) =>
    execFileSync('adb', ['-s', ANDROID, 'shell', ...words], { encoding: 'utf8' }).trim();
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', STATE);
    call = opsOn(androidProvider(new Adb()), ANDROID, APP).call;
  });

  it('turns on high contrast text, and it goes back', async () => {
    const contrast = () => shell('settings', 'get', 'secure', 'high_text_contrast_enabled');
    const was = contrast();
    expect(was).not.toBe('1');
    try {
      ok(await call('device_setting', { name: 'increase_contrast', value: 'on' }));
      expect(contrast()).toBe('1');
      expect((await call('device_setting', { name: 'increase_contrast' })).data.value).toBe('on');
    } finally {
      await call('device_setting', { name: 'restore' });
    }
    expect(contrast()).not.toBe('1');
  });

  it('says Android has no reduce_transparency', async () => {
    const r = await call('device_setting', { name: 'reduce_transparency', value: 'on' });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain('no reduce_transparency switch');
  });
});

describe.skipIf(!SIMULATOR)('small tools on a simulator', () => {
  let o: ReturnType<typeof opsOn>;
  let call: Call;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', STATE);
    await new Simctl().install(SIMULATOR, SIM_FIXTURE);
    o = opsOn(simulatorProvider(), SIMULATOR, APP);
    call = o.call;
    ok(await call('launch_app'));
  }, 300_000);
  afterAll(async () => {
    await call('set_orientation', { orientation: 'portrait' });
    await call('device_setting', { name: 'restore' });
    o.ctx.close();
  });

  it('turns on contrast and transparency, reads them back, and they go back', async () => {
    for (const name of ['increase_contrast', 'reduce_transparency']) {
      expect((await call('device_setting', { name })).data.value).toBe('off');
      ok(await call('device_setting', { name, value: 'on' }));
      expect((await call('device_setting', { name })).data.value).toBe('on');
    }
    ok(await call('device_setting', { name: 'restore' }));
    for (const name of ['increase_contrast', 'reduce_transparency'])
      expect((await call('device_setting', { name })).data.value).toBe('off');
  });

  // a simulator's position has no reading back, so what stands here is that it is taken
  it('takes a position and its end with no refusal', async () => {
    ok(await call('set_location', { lat: 41.01, lon: 28.97 }));
    ok(await call('set_location', { clear: true }));
  });

  it('mutes by the Action button, where the simulated phone has one', async () => {
    const ring = () =>
      execFileSync(
        'xcrun',
        ['simctl', 'spawn', SIMULATOR, 'notifyutil', '-g', 'com.apple.springboard.ringerstate'],
        {
          encoding: 'utf8',
        },
      ).trim();
    const was = ring();
    ok(await call('press_key', { key: 'mute' }));
    await vi.waitFor(() => expect(ring()).not.toBe(was), { timeout: 5_000 });
    ok(await call('press_key', { key: 'mute' }));
    await vi.waitFor(() => expect(ring()).toBe(was), { timeout: 5_000 });
  });

  it('holds the side button for Siri, as a window does', async () => {
    ok(await call('press_key', { key: 'siri', read: 'none' }));
    ok(await call('press_key', { key: 'home', read: 'none' }));
    ok(await call('launch_app'));
  });

  it('launches in a language for that launch alone', async () => {
    ok(await call('launch_app', { language: 'tr' }));
    expect(await language(call)).toContain('tr');
    await call('terminate_app');
    ok(await call('launch_app'));
    expect(await language(call)).not.toContain('tr');
    ok(await call('launch_app'));
  });

  it("saves a picture at the screen's own size, and refuses to replace one", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-shot-'));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const saved = await savedWidth(call, dir);
    const { w, density } = ok(await call('device_info')).data.screen;
    expect(saved).toBe(Math.round(w * density));
    const again = await call('screenshot', { file: join(dir, 'screen.png') });
    expect(again.text).toContain('is there already');
  });

  it('takes a picture whose pixels are points', () => inPoints(call));

  it('takes a picture of a width, and no wider than the screen', () => atWidth(call));

  it('launches an app by its name', () => byName(call));

  it('holds a drag before it moves: the pad sees the same travel, later', async () => {
    ok(await call('open_link', { url: 'appdyno-fixture://open/gestures' }));
    const at = Date.now();
    ok(
      await call('gesture', {
        kind: 'drag',
        selector: { text: 'Gesture pad' },
        to: { x: 200, y: 700 },
        holdMs: 1_500,
      }),
    );
    expect(Date.now() - at).toBeGreaterThan(1_500);
    const [travel] = ok(await call('find', { selector: { id: 'travel' } })).data.matches;
    assert(travel);
    expect(travel.label).not.toBe('travel: 0');
    ok(await call('launch_app'));
  });

  it('turns to a landscape and back, and the app lays out for it', () => turns(call));
});

describe.skipIf(!IPHONE)('small tools on an iPhone', () => {
  let o: Awaited<ReturnType<typeof onIphone>>;
  let call: Call;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', STATE);
    o = await onIphone(APP);
    call = o.call;
    ok(await call('launch_app'));
  }, 300_000);
  afterAll(async () => {
    await call('set_orientation', { orientation: 'portrait' });
    await call('terminate_app');
    await o.ctx.end();
    o.ctx.close();
  }, 60_000);

  it('reads contrast and transparency', async () => {
    for (const name of ['increase_contrast', 'reduce_transparency'])
      expect(ok(await call('device_setting', { name })).data.value).toMatch(/^(on|off)$/);
  });

  // an iPhone's position has no reading back that needs no app of its own: what stands here is that it is taken
  it('takes a position and its end with no refusal', async () => {
    try {
      ok(await call('set_location', { lat: 41.01, lon: 28.97 }));
    } finally {
      ok(await call('set_location', { clear: true }));
    }
  });

  it('says what mute needs, and that siri is for a window', async () => {
    const mute = await call('press_key', { key: 'mute' });
    if (!mute.error) await call('press_key', { key: 'mute' });
    else expect(mute.text).toContain('Action button');
    const siri = await call('press_key', { key: 'siri' });
    expect(siri.data.code).toBe('UNSUPPORTED');
    expect(siri.text).toContain('appdyno mirror');
  });

  it('launches in a language for that launch alone', async () => {
    ok(await call('launch_app', { language: 'de' }));
    expect(await language(call)).toContain(': de');
    await call('terminate_app');
    ok(await call('launch_app'));
    expect(await language(call)).not.toContain(': de');
    ok(await call('launch_app'));
  });

  it("saves a picture at the screen's own size", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-shot-'));
    const saved = await savedWidth(call, dir);
    rmSync(dir, { recursive: true });
    const { w, density } = ok(await call('device_info')).data.screen;
    expect(saved).toBe(Math.round(w * density));
  });

  it('takes a picture whose pixels are points', () => inPoints(call));

  it('takes a picture of a width, and no wider than the screen', () => atWidth(call));

  it('launches an app by its name', () => byName(call));

  it('holds a drag before it moves: the pad sees the same travel, later', async () => {
    ok(await call('open_link', { url: 'appdyno-fixture://open/gestures' }));
    const at = Date.now();
    ok(
      await call('gesture', {
        kind: 'drag',
        selector: { text: 'Gesture pad' },
        to: { x: 200, y: 700 },
        holdMs: 1_500,
      }),
    );
    expect(Date.now() - at).toBeGreaterThan(1_500);
    const [travel] = ok(await call('find', { selector: { id: 'travel' } })).data.matches;
    assert(travel);
    expect(travel.label).not.toBe('travel: 0');
    ok(await call('launch_app'));
  });

  it('turns to a landscape and back, and the app lays out for it', () => turns(call));
});
