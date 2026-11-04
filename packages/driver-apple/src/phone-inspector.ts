import type { ScreenInspector } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import type { Devicectl } from './devicectl.js';
import { loadPhoneStream } from './mirror-phone.js';

/** What is on an iPhone's screen with no runner, which is all a phone with no signing identity can be asked. */
export class PhoneInspector implements ScreenInspector {
  constructor(
    private readonly ctl: Devicectl,
    private readonly load = loadPhoneStream,
  ) {}

  /** A phone behind its passcode shows only what its lock screen holds, which is not ours to read. */
  private async reach() {
    if ((await this.ctl.lockState()).passcodeRequired)
      throw new DeviceError('DEVICE_LOCKED', `${this.ctl.udid} is locked behind its passcode`);
    const stream = await this.load();
    if (!stream)
      throw new DeviceError('UNSUPPORTED', 'this build holds no way to reach an iPhone so');
    return stream;
  }

  async elements() {
    return (await this.reach()).elements(this.ctl.udid);
  }

  async press(name: string) {
    return (await this.reach()).press(this.ctl.udid, name);
  }
}
