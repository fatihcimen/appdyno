import { DeviceError } from '@appdyno/protocol';
import { sleep } from './call.js';
import type { Device } from './device.js';

/** What an app is given to save its state once it has left the front, before its process ends. */
export const SAVES_STATE_MS = 1_500;

/** The app goes 0.9 to 1.8 s after home, at load 7 to 40 on a simulator, by either input. */
const LEAVES_MS = 5_000;
const ENDS_MS = 5_000;
const LOOK_MS = 100;

/** What an app's end in the background takes of a device: its front, its home key and whether the app runs. */
export type Backgrounds = Pick<Device, 'foreground' | 'key' | 'appRunning'>;

/** Whether `done` holds within `ms`, looked at until it does. */
async function within(ms: number, done: () => Promise<boolean>) {
  const end = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() >= end) return false;
    await sleep(LOOK_MS);
  }
  return true;
}

/**
 * The app sent home, given the time an app has to save its state once it is out of the front, then `kill` ends its
 * process as the system ends one in the background: its saved state is what its next launch finds. A process that
 * outlives it is refused, with what may keep it (`outlives`), and nothing is claimed of it.
 */
export async function endInBackground(
  device: Backgrounds,
  app: string,
  kill: () => Promise<void>,
  outlives?: string,
): Promise<undefined> {
  if (!(await device.appRunning(app)))
    throw new DeviceError('APP_NOT_RUNNING', `${app} is not running: it has no process to end`);
  if ((await device.foreground()) === app) {
    await device.key('home', { settle: false, read: 'none' });
    if (!(await within(LEAVES_MS, async () => (await device.foreground()) !== app)))
      throw new DeviceError(
        'TIMEOUT',
        `${app} stayed in front ${LEAVES_MS} ms after home: its process was left running`,
      );
  }
  await sleep(SAVES_STATE_MS);
  await kill();
  if (!(await within(ENDS_MS, async () => !(await device.appRunning(app)))))
    throw new DeviceError(
      'UNSUPPORTED',
      `${app} still runs after its end${outlives ? `: ${outlives}` : ''}`,
    );
  return undefined;
}
