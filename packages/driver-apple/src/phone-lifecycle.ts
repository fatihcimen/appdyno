import { endInBackground, type Backgrounds } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import type { Devicectl } from './devicectl.js';
import { noLevel } from './sim-lifecycle.js';

/** What an iPhone has no way to take, as each refusal says it. */
export const PHONE_CANNOT = {
  shake: 'an iPhone is shaken only by hand: neither devicectl nor XCTest sends a shake',
  media:
    "nothing on this Mac puts a photo into an iPhone's library: devicectl copies files into an app's own folder alone",
} as const;

/** An iPhone's memory warnings, by devicectl, and the end the system makes of an app in the background. */
export class PhoneLifecycle {
  constructor(
    private readonly ctl: Devicectl,
    private readonly device: Backgrounds,
  ) {}

  /** To the app's own process alone, as the phone's system sends one. */
  async memoryWarning(app: string, level?: string) {
    noLevel(level);
    await this.ctl.sendMemoryWarning(await this.ctl.pid(app));
    return undefined;
  }

  endInBackground(app: string) {
    return endInBackground(this.device, app, async () => {
      await this.ctl.kill(await this.ctl.pid(app));
    });
  }

  shake(): Promise<string | undefined> {
    return Promise.reject(new DeviceError('UNSUPPORTED', PHONE_CANNOT.shake));
  }

  addMedia(): Promise<string | undefined> {
    return Promise.reject(new DeviceError('UNSUPPORTED', PHONE_CANNOT.media));
  }
}
