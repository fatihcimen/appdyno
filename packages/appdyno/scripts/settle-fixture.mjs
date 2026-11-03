import { Adb, AndroidDevice, buildScreen, sleep as pause } from '../dist/index.js';

export const APP = 'dev.appdyno.fixture';

/** The fixture on this device, for what tunes the settle. */
export async function openFixture(serial) {
  const adb = new Adb();
  const d = new AndroidDevice(serial, adb);
  await d.open();
  const read = async () => buildScreen(await d.tree(), { platform: 'android', appId: APP });
  return { adb, d, pause, read };
}
