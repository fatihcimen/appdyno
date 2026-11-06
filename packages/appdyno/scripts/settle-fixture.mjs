import { buildScreen, sleep as pause } from '@appdyno/core';
import { Adb, AndroidDevice } from '@appdyno/driver-android';

export const APP = 'dev.appdyno.fixture';

/** The fixture on this device, for what tunes the settle. */
export async function openFixture(serial) {
  const adb = new Adb();
  const d = new AndroidDevice(serial, adb);
  await d.open();
  const read = async () => {
    const screen = buildScreen(await d.tree(), { port: d.platformScreen, appId: APP });
    if (!screen.window) throw new Error('a screen with no window');
    return { ...screen, window: screen.window };
  };
  return { adb, d, pause, read };
}
