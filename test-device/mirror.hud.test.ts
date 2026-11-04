import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LIVE_FIELDS,
  MirrorSession,
  startOf,
  viewerBinary,
  ViewerProcess,
  type Device,
  type LiveSample,
} from '../packages/core/src/index.js';
import { Adb, AndroidDevice } from '../packages/driver-android/src/index.js';
import { IosSimulatorDevice } from '../packages/driver-apple/src/index.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { windowControls, windowLook } from '../packages/ops/src/mirror/controls.js';
import { windowMeasures } from '../packages/ops/src/mirror/measures.js';
import { removeMirrorFile, writeMirrorFile } from '../packages/ops/src/mirror/state.js';

/**
 * A window's live numbers on a device we hold (APPDYNO_IOS_UDID or APPDYNO_ANDROID_SERIAL; never a default): a real
 * window, kept off every screen, reading a real app. APPDYNO_SHOTS names a folder for a picture of it.
 */
const udid = process.env.APPDYNO_IOS_UDID;
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const READING_MS = 200_000;
const OUT_OF_A_READING = 3_000;
/** A runner's first start and five launches, on a shared Mac. */
const MEASURE_MS = 400_000;
const FIXTURE = 'dev.appdyno.fixture';
const PERFORMANCE_PANE = 3;

const until = async (what: string, test: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`no ${what} in ${ms} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

/** A real app in front: on Android one that animates, so that its frames have something to count. */
const inFront = async () => {
  if (udid) execFileSync('xcrun', ['simctl', 'launch', udid, 'com.apple.Preferences']);
  else
    await new Adb().exec(
      serial!,
      'am start -a android.intent.action.VIEW -d appdyno-fixture://open/ticker dev.appdyno.fixture',
    );
};

const fixtureInFront = async () => {
  if (udid) execFileSync('xcrun', ['simctl', 'launch', udid, FIXTURE]);
  else
    await new Adb().exec(
      serial!,
      `am start -a android.intent.action.VIEW -d appdyno-fixture://open/list ${FIXTURE}`,
    );
};

describe.runIf(udid ?? serial)("a window's live numbers", () => {
  const device: Device = udid
    ? new IosSimulatorDevice(udid)
    : new AndroidDevice(serial!, new Adb());
  const told: Record<string, unknown>[] = [];
  let session: MirrorSession;
  const runs = mkdtempSync(join(tmpdir(), 'appdyno-window-runs-'));
  const control = (name: string) => session.tell({ op: 'poke', control: name });
  const perf = () => told.filter((m) => m.op === 'perf');
  const answers = () => told.filter((m) => m.op === 'measured');
  const picture = async (name: string) => {
    const shots = process.env.APPDYNO_SHOTS;
    if (!shots) return;
    await new Promise((r) => setTimeout(r, 6_000));
    session.tell({ op: 'snapshot', file: join(shots, `${name}-${udid ? 'ios' : 'android'}.png`) });
    await new Promise((r) => setTimeout(r, 1_000));
  };

  beforeAll(async () => {
    const binary = await viewerBinary();
    const hardware = await device.hardware();
    const measures = windowMeasures(
      new ServerContext(DEFAULT_POLICY, [], {
        measurements: join(runs, 'measurements'),
        perf: join(runs, 'perf'),
      }),
      device,
    );
    const controls = windowControls(device, hardware, () => session, measures);
    session = new MirrorSession({
      mirror: device.mirror,
      viewer: async () => new ViewerProcess(binary, ['--behind']),
      options: { quality: 'auto' },
      title: 'a window under test',
      look: windowLook(hardware),
      press: controls.press,
      onWindow: controls.onWindow,
    });
    const tell = session.tell.bind(session);
    session.tell = (m) => {
      told.push(m);
      tell(m);
    };
    await session.start();
    await until('picture', () => session.status.state === 'live', 120_000);
    // as a window's parent writes it: what is measured beside a stream is marked by this
    writeMirrorFile({
      pid: process.pid,
      started: startOf(process.pid),
      session: 'a window under test',
      serial: device.serial,
      status: session.status,
    });
    await inFront();
  }, 180_000);

  afterAll(async () => {
    removeMirrorFile(device.serial);
    await session?.stop('done');
    await device.stopAgent().catch(() => undefined);
    device.close();
    rmSync(runs, { recursive: true, force: true });
  });

  it(
    "reads nothing until asked, then a real app's numbers, and nothing after",
    async () => {
      await new Promise((r) => setTimeout(r, OUT_OF_A_READING));
      expect(perf()).toEqual([]);
      control('hud');
      const read = (m: Record<string, unknown>) =>
        m.op === 'perf' && (m.sample as LiveSample).memoryMb !== undefined;
      await until('a real reading', () => told.some(read), READING_MS).catch((e: Error) => {
        throw new Error(`${e.message}; last sample: ${JSON.stringify(perf().at(-1)?.sample)}`);
      });
      await until('a few more', () => perf().length >= 4, READING_MS);
      const { sample, noise } = perf().findLast(read) as unknown as {
        sample: LiveSample;
        noise: string[];
      };
      console.log(`live: ${JSON.stringify(sample)}`);
      expect(noise).toEqual(['mirrored']);
      // every measure is a reading or the reason it has none: nothing is left to look like a 0
      for (const field of LIVE_FIELDS)
        expect(sample[field] ?? sample.absent?.[field]).toBeDefined();
      await picture('hud');
      control('hud');
      await new Promise((r) => setTimeout(r, OUT_OF_A_READING));
      const after = perf().length;
      await new Promise((r) => setTimeout(r, OUT_OF_A_READING));
      expect(perf()).toHaveLength(after);
    },
    2 * READING_MS + 60_000,
  );

  it(
    'measures the app in front for real, by the tools an agent calls, and reads again after',
    async () => {
      await fixtureInFront();
      session.tell({ op: 'poke', pane: PERFORMANCE_PANE });
      // as a person does: a measure is of what the pane says is in front
      const fixtureRead = () => (perf().at(-1)?.sample as LiveSample | undefined)?.app === FIXTURE;
      await until('the fixture in the pane', fixtureRead, READING_MS);
      for (const [name, value] of [
        ['measureLaunch', /\d+ ms/],
        ['measureScroll', /jank|too few frames/],
      ] as const) {
        const before = answers().length;
        control(name);
        await until(name, () => answers().length > before, MEASURE_MS);
        const said = answers().at(-1)!;
        console.log(`measured: ${JSON.stringify(said)}`);
        expect(said.ok).toBe(true);
        expect(String(said.value)).toMatch(value);
        expect(String(said.detail)).toContain('stream running');
        const read = perf().length;
        await until('readings again', () => perf().length > read, READING_MS);
        await fixtureInFront();
        await until('the fixture in the pane', fixtureRead, READING_MS);
      }
      await picture('performance');
    },
    2 * MEASURE_MS + 120_000,
  );
});
