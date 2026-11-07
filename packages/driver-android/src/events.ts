import type { BiometricAnswer, DeviceEvents, Push, SettingName } from '@appdyno/core';
import { DeviceError, type Tree } from '@appdyno/protocol';
import type { Adb } from './adb.js';
import { EmulatorFingerprint } from './fingerprint.js';
import { ANDROID_PUSHES, AndroidPush } from './push.js';
import { emulatorConsole, shellOf } from './settings.js';

export class AndroidEvents implements DeviceEvents {
  private readonly sh: (command: string) => Promise<string>;
  private readonly emu: (what: string, ...words: string[]) => Promise<string>;
  private readonly fingerprint: EmulatorFingerprint;
  private readonly pusher: AndroidPush;

  constructor(
    adb: Adb,
    serial: string,
    /** The screen as the agent reads it, for the steps of Settings' enrolment. */
    screen: () => Promise<Tree> = () => Promise.reject(new Error('no screen to read')),
  ) {
    this.sh = shellOf(adb, serial);
    this.emu = (what, ...words) => emulatorConsole(adb, serial, what, words);
    this.fingerprint = new EmulatorFingerprint(serial, this.sh, this.emu, screen);
    this.pusher = new AndroidPush(this.sh);
  }

  async call(number: string, end: boolean) {
    await this.emu('calls', 'gsm', end ? 'cancel' : 'call', number);
  }

  async sms(from: string, text: string) {
    await this.emu('SMS', 'sms', 'send', from, text.replace(/\s+/g, ' '));
  }

  pushRoutes() {
    return ANDROID_PUSHES;
  }

  push(app: string, push: Push) {
    return this.pusher.send(app, push);
  }

  biometric(answer: BiometricAnswer, setUp?: (name: SettingName, value: string) => Promise<void>) {
    return this.fingerprint.answer(answer, setUp);
  }

  async resetKeychain(): Promise<number> {
    throw new DeviceError('UNSUPPORTED', 'Android has no keychain: app clear empties an app');
  }
}
