import { type BiometricAnswer, type DeviceEvents, sleep } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { type Adb, shq } from './adb.js';
import { emulatorConsole, shellOf } from './settings.js';

const READ_AGAIN_MS = 200;
/** The finger an emulator's enrolment is given, and one it has never seen. */
const KNOWN_FINGER = '1';
const UNKNOWN_FINGER = '99';
/** Enrolling took 3 touches on API 34; a sensor counts a touch only once the one before it is lifted. */
const ENROLL_TOUCHES = 15;
const FINGER_MS = 300;
/** How long a touch has to show in the service's counts. */
const COUNTED_MS = 3_000;
const NO_FINGERPRINT =
  "no fingerprint is enrolled here: set a screen lock, open Settings' fingerprint enrolment, then biometric enroll";

export class AndroidEvents implements DeviceEvents {
  private readonly sh: (command: string) => Promise<string>;
  private readonly emu: (what: string, ...words: string[]) => Promise<string>;

  constructor(
    adb: Adb,
    private readonly serial: string,
  ) {
    this.sh = shellOf(adb, serial);
    this.emu = (what, ...words) => emulatorConsole(adb, serial, what, words);
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

  /** The service's own counts: how many are enrolled, and what it took of the touches so far. */
  private async prints() {
    const out = await this.sh('dumpsys fingerprint');
    const m = /"count":(\d+),"accept":(\d+),"reject":(\d+)/.exec(out);
    if (!m)
      throw new DeviceError(
        'UNSUPPORTED',
        `this device gives no fingerprint counts: ${out.trim().split('\n')[0]}`,
      );
    return { enrolled: Number(m[1]), accept: Number(m[2]), reject: Number(m[3]) };
  }

  private async touch(finger: string) {
    await this.emu('fingerprint sensor', 'finger', 'touch', finger);
    await sleep(FINGER_MS);
    await this.emu('fingerprint sensor', 'finger', 'remove');
    await sleep(FINGER_MS);
  }

  /** A touch of the emulator's sensor, done only when the service counted it. */
  async biometric(answer: BiometricAnswer) {
    if (!this.serial.startsWith('emulator-'))
      throw new DeviceError(
        'UNSUPPORTED',
        'an Android phone takes a fingerprint only from a person: only an emulator has a sensor to touch',
      );
    const before = await this.prints();
    if (answer === 'enroll') {
      for (let i = 0; i < ENROLL_TOUCHES && (await this.prints()).enrolled === 0; i++)
        await this.touch(KNOWN_FINGER);
      if ((await this.prints()).enrolled > 0) return;
      throw new DeviceError(
        'NOT_FOUND',
        `${ENROLL_TOUCHES} touches enrolled nothing: open Settings' fingerprint enrolment first, which needs a screen lock`,
      );
    }
    if (before.enrolled === 0) throw new DeviceError('NOT_FOUND', NO_FINGERPRINT);
    await this.touch(answer === 'match' ? KNOWN_FINGER : UNKNOWN_FINGER);
    const counted = answer === 'match' ? 'accept' : 'reject';
    const end = Date.now() + COUNTED_MS;
    let now = await this.prints();
    while (now[counted] === before[counted] && Date.now() < end) {
      await sleep(READ_AGAIN_MS);
      now = await this.prints();
    }
    if (now[counted] === before[counted])
      throw new DeviceError(
        'NOT_FOUND',
        `the touch was not counted as a ${answer} (${now.accept} accepted, ${now.reject} rejected): an app must be asking for a fingerprint, and finger ${KNOWN_FINGER} must be the one enrolled`,
      );
  }

  async resetKeychain(): Promise<number> {
    throw new DeviceError('UNSUPPORTED', 'Android has no keychain: app clear empties an app');
  }
}
