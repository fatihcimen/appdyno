import type { ApnsTarget } from './apns-push.js';
import { logShowArgs } from './logs.js';
import { infoValue } from './sim-links.js';
import type { Simctl } from './simctl.js';

/**
 * A simulator, to APNs: on a Mac with Apple silicon or a T2 and macOS 13 or later APNs' sandbox reaches it, by Xcode 14's
 * notes, and its apps print their tokens in its own log, read from the start of this session.
 */
export function simulatorApnsTarget(simctl: Simctl, udid: string): ApnsTarget {
  const since = Date.now();
  return {
    name: 'simulator',
    production: false,
    installed: (app) =>
      simctl.appContainer(udid, app).then(
        () => true,
        () => false,
      ),
    lines: async (app) => {
      // NSLog's and os_log's own lines: debug would add the libraries' noise
      const q = { app, since, level: 'info' as const, maxLines: 10_000 };
      const log = await simctl.exec(logShowArgs(udid, await simctl.appContainer(udid, app), q));
      return { lines: log.split('\n') };
    },
    build: () => Promise.resolve(undefined),
    declaresVoip: async (app) => {
      const modes = await infoValue(await simctl.appContainer(udid, app), 'UIBackgroundModes');
      return Array.isArray(modes) && modes.includes('voip');
    },
    osMajor: async () => {
      const me = (await simctl.list()).find((s) => s.udid === udid);
      return Number(/iOS-(\d+)/.exec(me?.runtime ?? '')?.[1] ?? 0);
    },
  };
}
