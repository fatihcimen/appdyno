import { DeviceError } from '@appdyno/protocol';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { describe, expect, it } from 'vitest';
import { endInBackground, SAVES_STATE_MS, type Backgrounds } from '../src/background-end.js';

const APP = 'org.example.app';

/**
 * A device whose app is in front and runs until killed; `leaves`: whether home takes it out of the front, `dies`:
 * whether the kill ends its process. Each step is logged with the time it came.
 */
function device({ leaves = true, dies = true, runs = true, front = true } = {}) {
  const log: string[] = [];
  const started = Date.now();
  const at = (what: string) => log.push(`${what} ${Date.now() - started}`);
  let inFront = front;
  let running = runs;
  const d: Backgrounds = {
    foreground: () => Promise.resolve(inFront ? APP : 'com.android.launcher'),
    key: (key) => {
      at(key);
      if (leaves) inFront = false;
      return Promise.resolve({});
    },
    appRunning: () => Promise.resolve(running),
  };
  const kill = () => {
    at('kill');
    if (dies) running = false;
    return Promise.resolve();
  };
  return { d, kill, log };
}

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as DeviceError,
  );

describe("an app's end in the background", () => {
  it(
    'sends the app home, gives it the time to save its state once out of the front, then ends its process',
    fakeTimed(async () => {
      const { d, kill, log } = device();
      await expect(endInBackground(d, APP, kill)).resolves.toBeUndefined();
      expect(log).toEqual(['home 0', `kill ${SAVES_STATE_MS}`]);
    }),
  );

  it(
    'presses nothing for an app already out of the front',
    fakeTimed(async () => {
      const { d, kill, log } = device({ front: false });
      await endInBackground(d, APP, kill);
      expect(log).toEqual([`kill ${SAVES_STATE_MS}`]);
    }),
  );

  it(
    'refuses an app with no process, and touches nothing',
    fakeTimed(async () => {
      const { d, kill, log } = device({ runs: false });
      const e = await refusal(endInBackground(d, APP, kill));
      expect(e?.code).toBe('APP_NOT_RUNNING');
      expect(log).toEqual([]);
    }),
  );

  it(
    'leaves the process running, and says so, where the app stays in front after home',
    fakeTimed(async () => {
      const { d, kill, log } = device({ leaves: false });
      const e = await refusal(endInBackground(d, APP, kill));
      expect(e?.code).toBe('TIMEOUT');
      expect(e?.message).toContain('left running');
      expect(log).toEqual(['home 0']);
    }),
  );

  it(
    'claims nothing of a process that outlives its end, and says what may keep it',
    fakeTimed(async () => {
      const { d, kill } = device({ dies: false });
      const e = await refusal(endInBackground(d, APP, kill, 'a foreground service keeps it'));
      expect(e?.code).toBe('UNSUPPORTED');
      expect(e?.message).toBe(`${APP} still runs after its end: a foreground service keeps it`);
    }),
  );
});
