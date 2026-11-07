import type { BiometricAnswer, DeviceEvents, SettingName } from '@appdyno/core';
import { DeviceError, type Tree } from '@appdyno/protocol';
import { type Adb, shq } from './adb.js';
import { EmulatorFingerprint } from './fingerprint.js';
import { emulatorConsole, shellOf } from './settings.js';

export class AndroidEvents implements DeviceEvents {
  private readonly sh: (command: string) => Promise<string>;
  private readonly emu: (what: string, ...words: string[]) => Promise<string>;
  private readonly fingerprint: EmulatorFingerprint;

  constructor(
    adb: Adb,
    serial: string,
    /** The screen as the agent reads it, for the steps of Settings' enrolment. */
    screen: () => Promise<Tree> = () => Promise.reject(new Error('no screen to read')),
  ) {
    this.sh = shellOf(adb, serial);
    this.emu = (what, ...words) => emulatorConsole(adb, serial, what, words);
    this.fingerprint = new EmulatorFingerprint(serial, this.sh, this.emu, screen);
  }

  async fold(closed: boolean) {
    await this.emu('fold pose', closed ? 'fold' : 'unfold');
  }

  async call(number: string, end: boolean) {
    await this.emu('calls', 'gsm', end ? 'cancel' : 'call', number);
  }

  async sms(from: string, text: string) {
    await this.emu('SMS', 'sms', 'send', from, text.replace(/\s+/g, ' '));
  }

  /** Posted by the shell user: Android has no way to post as the app without its own code. */
  async push(_app: string | undefined, title: string, body: string) {
    const out = await this.sh(
      `cmd notification post -S bigtext -t ${shq(title)} appdyno ${shq(body)}`,
    );
    if (/Exception|Error/.test(out))
      throw new DeviceError('INTERNAL', `the notification was not posted: ${out.split('\n')[0]}`);
  }

  biometric(answer: BiometricAnswer, setUp?: (name: SettingName, value: string) => Promise<void>) {
    return this.fingerprint.answer(answer, setUp);
  }

  async resetKeychain(): Promise<number> {
    throw new DeviceError('UNSUPPORTED', 'Android has no keychain: app clear empties an app');
  }
}
