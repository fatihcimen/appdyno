import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LIVE_FIELDS,
  MirrorSession,
  viewerBinary,
  ViewerProcess,
  type Device,
  type LiveSample,
} from '../packages/core/src/index.js';
import { Adb, AndroidDevice } from '../packages/driver-android/src/index.js';
import { IosSimulatorDevice } from '../packages/driver-apple/src/index.js';
import { windowControls, windowLook } from '../packages/ops/src/mirror/controls.js';

/**
 * A window's live numbers on a device we hold (APPDYNO_IOS_UDID or APPDYNO_ANDROID_SERIAL; never a default): a real
 * window, kept off every screen, reading a real app. APPDYNO_SHOTS names a folder for a picture of it.
 */
const udid = process.env.APPDYNO_IOS_UDID;
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const READING_MS = 200_000;
const OUT_OF_A_READING = 3_000;

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

describe.runIf(udid ?? serial)("a window's live numbers", () => {
  const device: Device = udid
    ? new IosSimulatorDevice(udid)
    : new AndroidDevice(serial!, new Adb());
  const told: Record<string, unknown>[] = [];
  let session: MirrorSession;
  const control = (name: string) => session.tell({ op: 'poke', control: name });
  const perf = () => told.filter((m) => m.op === 'perf');

  beforeAll(async () => {
    const binary = await viewerBinary();
    const hardware = await device.hardware();
    const controls = windowControls(device, hardware, () => session);
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
    await inFront();
  }, 180_000);

  afterAll(async () => {
    await session?.stop('done');
    device.close();
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
      const shots = process.env.APPDYNO_SHOTS;
      if (shots) {
        await new Promise((r) => setTimeout(r, 6_000));
        session.tell({ op: 'snapshot', file: join(shots, `hud-${udid ? 'ios' : 'android'}.png`) });
        await new Promise((r) => setTimeout(r, 1_000));
      }
      control('hud');
      await new Promise((r) => setTimeout(r, OUT_OF_A_READING));
      const after = perf().length;
      await new Promise((r) => setTimeout(r, OUT_OF_A_READING));
      expect(perf()).toHaveLength(after);
    },
    2 * READING_MS + 60_000,
  );
});
