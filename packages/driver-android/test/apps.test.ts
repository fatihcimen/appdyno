import { expect, it } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidApps } from '../src/apps.js';

it('names an app with two launcher activities by its own, the first, as it is started', async () => {
  // a debug build with LeakCanary: the system lists the app's own activity, then the one LeakCanary adds
  const adb = {
    exec: () => Promise.resolve('package:org.wikipedia.alpha\npackage:dev.app\n'),
  } as unknown as Adb;
  const labels = () =>
    Promise.resolve([
      { id: 'org.wikipedia.alpha', name: 'Wikipedia Alpha' },
      { id: 'dev.app', name: 'Dev' },
      { id: 'org.wikipedia.alpha', name: 'Leaks' },
    ]);
  const apps = new AndroidApps(adb, 'emulator-5560', {} as never, undefined, labels);
  expect(await apps.listApps(false)).toEqual([
    { id: 'dev.app', name: 'Dev' },
    { id: 'org.wikipedia.alpha', name: 'Wikipedia Alpha' },
  ]);
});
