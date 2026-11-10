import { basename } from 'node:path';
import { simulatorCrashes } from './crashes.js';
import type { IosDeviceOps } from './device.js';
import { simulatorLogs } from './logs.js';
import { SIMULATOR_LINKS } from './settings-pages.js';
import type { Simctl } from './simctl.js';
import { helperBinary } from './simhelper.js';

export function simulatorOps(udid: string, simctl: Simctl): IosDeviceOps {
  return {
    up: async () => (await simctl.state(udid)) === 'Booted',
    launch: async (b) => {
      await simctl.launch(udid, b);
    },
    terminate: (b) => simctl.terminate(udid, b),
    openUrl: async (url) => {
      await simctl.openUrl(udid, url);
    },
    setLocation: async (lat, lon) => {
      await simctl.setLocation(udid, lat, lon);
    },
    clearLocation: async () => {
      await simctl.exec(['location', udid, 'clear']);
    },
    linkPrompt: true,
    settingsLinks: SIMULATOR_LINKS,
    openSettings: async (link) => {
      await simctl.exec(['spawn', udid, await helperBinary('SimOpen'), link]);
    },
    logs: (q) => simulatorLogs(simctl, udid, q),
    crashes: async (q) =>
      simulatorCrashes(
        udid,
        q,
        undefined,
        await simctl.appContainer(udid, q.app).then(
          (app) => basename(app, '.app'),
          () => undefined,
        ),
      ),
    name: `simulator ${udid}`,
    pid: (b) => simctl.pid(udid, b),
  };
}
