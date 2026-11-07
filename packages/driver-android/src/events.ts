import type { BiometricAnswer, DeviceEvents, Push, SettingName } from '@appdyno/core';
import { FcmPush } from './fcm-push.js';
import { DeviceError, type Tree } from '@appdyno/protocol';
import { shq, type Adb } from './adb.js';
import { EmulatorFingerprint } from './fingerprint.js';
import { ANDROID_PUSHES, AndroidPush } from './push.js';
import { logcatCommand } from './logs.js';
import { emulatorConsole, shellOf } from './settings.js';

export class AndroidEvents implements DeviceEvents {
  private readonly sh: (command: string) => Promise<string>;
  private readonly emu: (what: string, ...words: string[]) => Promise<string>;
  private readonly fingerprint: EmulatorFingerprint;
  private readonly pusher: AndroidPush;
  /** What only Google's servers deliver, once a person set FCM up. */
  private readonly fcm: FcmPush;

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
    const since = Date.now();
    this.fcm = new FcmPush({
      installed: async (app) => (await this.sh(`pm path ${shq(app)}`)).startsWith('package:'),
      // the app's own lines in this session: those of the process running now
      lines: async (app) => {
        const pid = (await this.sh(`pidof ${shq(app)}`)).trim().split(/\s+/)[0];
        if (!pid) return [];
        return (
          await this.sh(logcatCommand(pid, { since, level: 'verbose', maxLines: 10_000 }))
        ).split('\n');
      },
    });
  }

  async call(number: string, end: boolean) {
    await this.emu('calls', 'gsm', end ? 'cancel' : 'call', number);
  }

  async sms(from: string, text: string) {
    await this.emu('SMS', 'sms', 'send', from, text.replace(/\s+/g, ' '));
  }

  async pushRoutes() {
    const byFcm = this.fcm.routes();
    return ANDROID_PUSHES.map((r) => byFcm.find((f) => f.type === r.type) ?? r);
  }

  push(app: string, push: Push) {
    const byFcm = this.fcm.routes().some((r) => r.type === push.type);
    return byFcm ? this.fcm.push(app, push) : this.pusher.send(app, push);
  }

  pushToken(app: string, token: string) {
    this.fcm.typed(app, token);
  }

  biometric(answer: BiometricAnswer, setUp?: (name: SettingName, value: string) => Promise<void>) {
    return this.fingerprint.answer(answer, setUp);
  }

  async resetKeychain(): Promise<number> {
    throw new DeviceError('UNSUPPORTED', 'Android has no keychain: app clear empties an app');
  }
}
