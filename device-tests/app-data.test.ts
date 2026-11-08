import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppManager } from '../packages/core/src/index.js';
import { Adb } from '../packages/driver-android/src/adb.js';
import { AndroidApps } from '../packages/driver-android/src/apps.js';
import { Devicectl } from '../packages/driver-apple/src/devicectl.js';
import { PhoneApps } from '../packages/driver-apple/src/phone-manage.js';
import { Simctl } from '../packages/driver-apple/src/simctl.js';
import { SimulatorApps } from '../packages/driver-apple/src/simulator-manage.js';

/**
 * The fixture's data there and back on a real device: our own booted simulator (APPDYNO_IOS_UDID), emulator or phone
 * (APPDYNO_ANDROID_SERIAL), or iPhone (APPDYNO_IPHONE_UDID), each with the fixture installed. It ends with that data
 * empty.
 */
const FIXTURE = 'dev.appdyno.fixture';
const TEXT = 'there and back';
const iosFile = join('Documents', 'deep', 'a.txt');

describe('an app data on a device', () => {
  let base: string;
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'appdyno-app-data-'));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const folder = (name: string) => {
    const at = join(base, name);
    mkdirSync(at, { recursive: true });
    return at;
  };

  const thereAndBack = async (apps: AppManager, name: string, file: string) => {
    const from = folder(`${name}-from`);
    mkdirSync(dirname(join(from, file)), { recursive: true });
    writeFileSync(join(from, file), TEXT);
    await apps.replaceData(FIXTURE, from);
    const to = folder(`${name}-to`);
    await apps.downloadData(FIXTURE, to);
    expect(readFileSync(join(to, file), 'utf8')).toBe(TEXT);

    // what a replace was not given goes too
    await apps.replaceData(FIXTURE, folder(`${name}-empty`));
    const again = folder(`${name}-again`);
    await apps.downloadData(FIXTURE, again);
    expect(existsSync(join(again, file))).toBe(false);
  };

  const simulator = process.env.APPDYNO_IOS_UDID ?? '';
  it.runIf(simulator)(
    'goes both ways on a simulator',
    () => thereAndBack(new SimulatorApps(new Simctl(), simulator), 'simulator', iosFile),
    120_000,
  );

  const iphone = process.env.APPDYNO_IPHONE_UDID ?? '';
  it.runIf(iphone)(
    'goes both ways on an iPhone',
    () => thereAndBack(new PhoneApps(new Devicectl(iphone)), 'iphone', iosFile),
    120_000,
  );

  const serial = process.env.APPDYNO_ANDROID_SERIAL ?? '';
  const android = () =>
    new AndroidApps(new Adb(), serial, {} as ConstructorParameters<typeof AndroidApps>[2]);

  it.runIf(serial)(
    'goes both ways on Android, with a debuggable build',
    () => thereAndBack(android(), 'android', join('files', 'deep', 'a.txt')),
    120_000,
  );

  it.runIf(serial)(
    'says a build that is not debuggable keeps its data',
    async () => {
      await expect(
        android().downloadData('com.android.settings', folder('settings')),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    },
    60_000,
  );
});
