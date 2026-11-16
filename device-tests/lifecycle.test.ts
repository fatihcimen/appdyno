import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Adb,
  androidProvider,
  encodePng,
  Simctl,
  simulatorProvider,
  type DeviceProvider,
} from './workspace.js';
import { opsOn, SIM_FIXTURE, type Answer, type Call } from './helpers.js';

/**
 * What the system tells an app, counted by the fixture's lifecycle screen itself: one memory warning and one shake a
 * call, the typed value an end in the background keeps for the next launch, in a new process, and photos added to the
 * library, which Android's restore takes out again. On the simulator APPDYNO_IOS_UDID names and the emulator
 * APPDYNO_ANDROID_SERIAL names: a phone's accelerometer takes no shake, and its library is a person's.
 *
 * A simulator that has once discarded the fixture's saved scene at a launch discards it at every launch until it boots
 * again (iOS 26.5): boot it anew where the kept value does not come back. This file stops the app on iOS only as the
 * system does, in the background, since a stop in front came before each simulator that began to discard it.
 */
const APP = 'dev.appdyno.fixture';
const LIFECYCLE = 'appdyno-fixture://open/lifecycle';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const EMULATOR = ANDROID.startsWith('emulator-') ? ANDROID : '';
const SIMULATOR = process.env.APPDYNO_IOS_UDID ?? '';
const PICTURES = '/storage/emulated/0/Pictures/appdyno';

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

/** Whether the fixture's element of that id shows those words, within a few seconds. */
const shows = async (call: Call, id: string, text: string) =>
  ok(await call('check_element', { selector: { id, text }, timeoutMs: 8_000 })).data.met;

const labelOf = async (call: Call, id: string) =>
  ok(await call('read_screen', { selector: { id } })).data.matches[0]?.label;

/** The lifecycle screen of a fixture in a process of its own: what it counts begins at none. */
const fresh = async (p: Platform, call: Call) => {
  await p.stop(call);
  ok(await call('launch_app', { read: 'none' }));
  ok(await call('open_link', { url: LIFECYCLE, read: 'none' }));
  expect(await shows(call, 'process_start', 'Process')).toBe(true);
};

/** A value no run before this one typed: what an earlier run saved would otherwise read as kept. */
const unique = (what: string) => `${what}${String(Date.now() % 1_000_000)}`;

type Platform = {
  name: string;
  serial: string;
  provider: () => DeviceProvider;
  /** Before the first test: the fixture on the device. */
  ready?: () => Promise<unknown>;
  /** The fixture with no process: Android's own launch then begins its task, which brings back what the system ended. */
  stop: (call: Call) => Promise<unknown>;
  /** Whether a plain stop, which loses what the app saved, is this file's to make here. */
  plainStop: boolean;
  /**
   * After a launch of an app the system ended: the screen it was on. Android brings the ended activity back on its
   * task; the fixture on iOS keeps its screen in no scene storage, and starts at its home.
   */
  back: (call: Call) => Promise<unknown>;
};

const ON_SIMULATOR: Platform = {
  name: 'a simulator',
  serial: SIMULATOR,
  provider: () => simulatorProvider(),
  ready: () => new Simctl().install(SIMULATOR, SIM_FIXTURE),
  stop: (call) => call('manage_app', { action: 'stop', background: true }),
  plainStop: false,
  back: (call) => call('open_link', { url: LIFECYCLE, read: 'none' }),
};

const ON_EMULATOR: Platform = {
  name: 'an emulator',
  serial: EMULATOR,
  provider: () => androidProvider(new Adb()),
  stop: (call) => call('manage_app', { action: 'stop' }),
  plainStop: true,
  back: () => Promise.resolve(),
};

const PLATFORMS = [ON_SIMULATOR, ON_EMULATOR];

for (const p of PLATFORMS)
  describe.skipIf(!p.serial)(`the lifecycle on ${p.name}`, () => {
    let o: ReturnType<typeof opsOn>;
    let call: Call;
    beforeAll(async () => {
      await p.ready?.();
      o = opsOn(p.provider(), p.serial, APP);
      call = o.call;
    }, 300_000);
    afterAll(() => o.ctx.close());

    it('counts exactly one shake a call, several in a row', async () => {
      await fresh(p, call);
      for (let i = 0; i < 3; i++) ok(await call('set_device', { name: 'shake' }));
      expect(await shows(call, 'shakes', 'Shakes: 3')).toBe(true);
    });

    it('keeps what the app saved for its next launch, in a new process', async () => {
      await fresh(p, call);
      const kept = unique('kept');
      ok(await call('type_text', { text: kept, selector: { id: 'kept_value' }, replace: true }));
      const before = await labelOf(call, 'process_start');
      const ended = ok(await call('manage_app', { action: 'stop', background: true }));
      expect(ended.text).toBe(`ended ${APP} in the background, as the system does for memory`);
      expect(ok(await call('manage_app', { action: 'state', app: APP })).text).toContain('stopped');
      expect(ok(await call('launch_app', { read: 'none' })).text).toContain(`started ${APP}`);
      await p.back(call);
      expect(await shows(call, 'kept_value', kept)).toBe(true);
      expect(await labelOf(call, 'process_start')).not.toBe(before);
    });

    it.runIf(p.plainStop)('loses what the app typed at a plain stop', async () => {
      await fresh(p, call);
      const lost = unique('lost');
      ok(await call('type_text', { text: lost, selector: { id: 'kept_value' }, replace: true }));
      ok(await call('manage_app', { action: 'stop' }));
      ok(await call('launch_app', { read: 'none' }));
      ok(await call('open_link', { url: LIFECYCLE, read: 'none' }));
      expect(await shows(call, 'process_start', 'Process')).toBe(true);
      expect(await labelOf(call, 'kept_value')).not.toBe(lost);
    });

    it('refuses an end in the background of an app that does not run', async () => {
      await p.stop(call);
      expect((await call('manage_app', { action: 'stop', background: true })).data.code).toBe(
        'APP_NOT_RUNNING',
      );
    });
  });

describe.skipIf(!SIMULATOR)('memory warnings and photos on a simulator', () => {
  let o: ReturnType<typeof opsOn>;
  let call: Call;
  beforeAll(async () => {
    await new Simctl().install(SIMULATOR, SIM_FIXTURE);
    o = opsOn(simulatorProvider(), SIMULATOR, APP);
    call = o.call;
  }, 300_000);
  afterAll(() => {
    vi.restoreAllMocks();
    o.ctx.close();
  });

  it('counts exactly one memory warning a call, several in a row, and takes no level', async () => {
    await fresh(ON_SIMULATOR, call);
    for (let i = 0; i < 3; i++) {
      const r = ok(await call('set_device', { name: 'memory_warning' }));
      expect(r.text).toContain('every app that runs on the simulator gets it');
    }
    expect(await shows(call, 'memory_warnings', 'Memory warnings: 3')).toBe(true);
    const level = await call('set_device', { name: 'memory_warning', value: 'RUNNING_LOW' });
    expect(level.data.code).toBe('INVALID_ARGUMENT');
  });

  it('adds photos to Photos, which then holds them, and says it cannot take them out', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(pictures());
    const one = ok(await call('transfer_files', { action: 'media', path: 'shots/a.png' }));
    const held = Number(/Photos holds (\d+)/.exec(one.text)?.[1]);
    const two = ok(await call('transfer_files', { action: 'media', path: 'shots' }));
    expect(two.text).toContain(`Photos holds ${String(held + 2)}`);
    expect(two.text).toContain('has no delete');
  });
});

describe.skipIf(!EMULATOR)('trim levels and photos on an emulator', () => {
  let o: ReturnType<typeof opsOn>;
  let call: Call;
  const adb = new Adb();
  const sh = (command: string) => adb.exec(EMULATOR, command);
  // the folder's own row with its files'
  const rows = () =>
    sh(
      `content query --uri content://media/external/file --projection _data:is_pending --where "_data LIKE '${PICTURES}%'"`,
    );
  beforeAll(() => {
    o = opsOn(androidProvider(adb), EMULATOR, APP);
    call = o.call;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await call('set_device', { name: 'restore' });
    o.ctx.close();
  });

  it('tells the app each level it is sent, a higher one each time, and a background one only in the background', async () => {
    await fresh(ON_EMULATOR, call);
    for (const value of ['RUNNING_MODERATE', 'RUNNING_LOW', 'RUNNING_CRITICAL'])
      ok(await call('set_device', { name: 'memory_warning', value }));
    expect(
      await shows(call, 'trim_levels', 'RUNNING_MODERATE, RUNNING_LOW, RUNNING_CRITICAL'),
    ).toBe(true);
    const again = await call('set_device', { name: 'memory_warning' });
    expect(again.data.code).toBe('INVALID_ARGUMENT');
    expect(again.text).toContain('is at RUNNING_CRITICAL already');
    const front = await call('set_device', { name: 'memory_warning', value: 'BACKGROUND' });
    expect(front.text).toContain('reaches only an app in the background');
    ok(await call('press_key', { key: 'home', read: 'none' }));
    ok(await call('set_device', { name: 'memory_warning', value: 'BACKGROUND' }));
    ok(await call('launch_app', { read: 'none' }));
    expect(await shows(call, 'trim_levels', 'BACKGROUND')).toBe(true);
  });

  it('adds photos to the library, listed once scanned, and restore deletes exactly them', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(pictures());
    const added = ok(await call('transfer_files', { action: 'media', path: 'shots' }));
    expect(added.text).toContain('the library lists 2 of them, in Pictures/appdyno');
    const listed = await rows();
    for (const name of ['a.png', 'b.png'])
      expect(listed).toContain(`_data=${PICTURES}/${name}, is_pending=0`);
    const back = ok(await call('set_device', { name: 'restore' }));
    expect(back.text).toContain('took out the 2 photos and videos it added');
    expect(await sh(`ls ${PICTURES} 2>&1`)).toContain('No such file');
    expect(await rows()).toContain('No result found');
  });
});

/** A folder for the server's own, holding `shots` of two small pictures. */
function pictures() {
  const root = mkdtempSync(join(tmpdir(), 'appdyno-lifecycle-'));
  mkdirSync(join(root, 'shots'));
  for (const [name, shade] of [
    ['a.png', 60],
    ['b.png', 180],
  ] as const)
    writeFileSync(
      join(root, 'shots', name),
      encodePng({ width: 32, height: 32, channels: 3, data: Buffer.alloc(32 * 32 * 3, shade) }),
    );
  return root;
}
