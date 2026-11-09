import { type BiometricAnswer, must, type SettingName, sleep } from '@appdyno/core';
import { DeviceError, NODE_FLAGS, type Tree } from '@appdyno/protocol';
import { EMULATOR_PIN } from './settings.js';

const READ_AGAIN_MS = 200;
/** The finger an emulator's enrolment is given, and one it has never seen. */
const KNOWN_FINGER = '1';
const UNKNOWN_FINGER = '99';
/** Enrolling took 3 touches on API 34; a sensor counts a touch only once the one before it is lifted. */
const ENROLL_TOUCHES = 15;
const FINGER_MS = 300;
/** How long a touch has to show in the service's counts. */
const COUNTED_MS = 3_000;
/** Settings' screens on the way to the sensor: its PIN, then an introduction of a page or two (3 on API 34). */
const SETTINGS_STEPS = 8;
const STEP_MS = 2_000;
/** The fingerprint service's state while an enrolment listens to the sensor. */
const ENROLLING = 1;
const APPLICATION_WINDOW = 1;
const NO_FINGERPRINT = 'no fingerprint is enrolled here: biometric enroll takes one';
export const PHONE_FINGERPRINT =
  'an Android phone takes a fingerprint only from a person: only an emulator has a sensor to touch';

type Step = { kind: 'pin' | 'tap'; x: number; y: number };

/**
 * What Settings' enrolment asks for on this screen, in no language: a PIN field, else its lowest and rightmost button,
 * which is the one that goes on (More, then I agree, then Done).
 */
export function enrolmentStep(tree: Tree): Step | undefined {
  const apps = new Set(tree.windows.flatMap((w, i) => (w.type === APPLICATION_WINDOW ? [i] : [])));
  const shown = tree.nodes.filter(
    (n) => apps.has(n.w) && n.f & NODE_FLAGS.visible && n.f & NODE_FLAGS.enabled,
  );
  const centre = (kind: Step['kind'], [l, t, r, b]: [number, number, number, number]) => ({
    kind,
    x: Math.round((l + r) / 2),
    y: Math.round((t + b) / 2),
  });
  const pin = shown.find((n) => n.f & NODE_FLAGS.editable && n.f & NODE_FLAGS.password);
  if (pin) return centre('pin', pin.b);
  const button = shown
    .filter((n) => n.c === 'android.widget.Button' && n.f & NODE_FLAGS.clickable)
    .sort((a, b) => b.b[3] - a.b[3] || b.b[2] - a.b[2])[0];
  return button && centre('tap', button.b);
}

/** An emulator's fingerprint sensor, by its console, and Settings' enrolment, by its screen. */
export class EmulatorFingerprint {
  constructor(
    private readonly serial: string,
    private readonly sh: (command: string) => Promise<string>,
    private readonly emu: (what: string, ...words: string[]) => Promise<string>,
    private readonly screen: () => Promise<Tree>,
  ) {}

  /** The service's own counts: how many are enrolled, what it took of the touches so far, and whether it listens. */
  private async prints() {
    const out = await this.sh('dumpsys fingerprint');
    const m = /"count":(\d+),"accept":(\d+),"reject":(\d+)/.exec(out);
    if (!m)
      throw new DeviceError(
        'UNSUPPORTED',
        `this device gives no fingerprint counts: ${must(out.trim().split('\n')[0], 'a line')}`,
      );
    const state = /Fps state: (\d+)/.exec(out)?.[1];
    return {
      enrolled: Number(m[1]),
      accept: Number(m[2]),
      reject: Number(m[3]),
      enrolling: Number(state) === ENROLLING,
    };
  }

  private async touch(finger: string) {
    await this.emu('fingerprint sensor', 'finger', 'touch', finger);
    await sleep(FINGER_MS);
    await this.emu('fingerprint sensor', 'finger', 'remove');
    await sleep(FINGER_MS);
  }

  /** A touch of the emulator's sensor, done only when the service counted it. */
  async answer(
    answer: BiometricAnswer,
    setUp?: (name: SettingName, value: string) => Promise<void>,
  ) {
    if (!this.serial.startsWith('emulator-'))
      throw new DeviceError('UNSUPPORTED', PHONE_FINGERPRINT);
    const before = await this.prints();
    if (answer === 'enroll')
      return before.enrolled > 0 ? undefined : this.enrol(before.enrolling, setUp);
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

  private async enrol(
    listening: boolean,
    setUp?: (name: SettingName, value: string) => Promise<void>,
  ) {
    const pinSet = listening ? false : await this.lockForEnrolment(setUp);
    try {
      if (!listening) await this.reachSensor();
      for (let i = 0; i < ENROLL_TOUCHES && (await this.prints()).enrolled === 0; i++)
        await this.touch(KNOWN_FINGER);
      if ((await this.prints()).enrolled === 0)
        throw new DeviceError('NOT_FOUND', `${ENROLL_TOUCHES} touches enrolled nothing`);
    } catch (e) {
      // what this opened goes, back to the app; a PIN it set stays until restore, and is said
      if (!listening) await this.sh('am force-stop com.android.settings');
      if (!pinSet || !(e instanceof DeviceError)) throw e;
      throw new DeviceError(
        e.code,
        `${e.message}; the screen lock is PIN ${EMULATOR_PIN} until restore takes it off`,
      );
    }
    if (listening) return undefined;
    // the last screen of what this opened says it was added: Done takes it away
    const done = enrolmentStep(await this.screen());
    if (done?.kind === 'tap') await this.sh(`input tap ${done.x} ${done.y}`);
    return pinSet
      ? `the screen lock is PIN ${EMULATOR_PIN} for it: restore takes the PIN off, and the fingerprints with it`
      : undefined;
  }

  /** A screen lock Settings' enrolment can pass: this tool's PIN, set and written down where there is none. */
  private async lockForEnrolment(setUp?: (name: SettingName, value: string) => Promise<void>) {
    if (!setUp)
      throw new DeviceError(
        'UNSUPPORTED',
        `${NO_FINGERPRINT}, but not here: it leaves the app for Settings`,
      );
    const unlocked = 'verified successfully';
    const none = (await this.sh('cmd lock_settings verify')).includes(unlocked);
    // a lock with another PIN takes this as one failed attempt, which an emulator can spare
    if (
      !none &&
      !(await this.sh(`cmd lock_settings verify --old ${EMULATOR_PIN}`)).includes(unlocked)
    )
      throw new DeviceError(
        'UNSUPPORTED',
        'this emulator has a screen lock of its own, whose PIN this tool cannot type: enrol a fingerprint in Settings by hand',
      );
    if (none) await setUp('screen_lock', 'pin');
    return none;
  }

  /** Settings' enrolment, up to where the sensor listens. */
  private async reachSensor() {
    await this.sh('am start -a android.settings.FINGERPRINT_ENROLL');
    for (let step = 0; step < SETTINGS_STEPS; step++) {
      if (await this.listening()) return;
      const next = enrolmentStep(await this.screen());
      if (next?.kind === 'pin')
        await this.sh(
          `input tap ${next.x} ${next.y}; input text ${EMULATOR_PIN}; input keyevent 66`,
        );
      else if (next) await this.sh(`input tap ${next.x} ${next.y}`);
    }
    if (await this.listening()) return;
    throw new DeviceError(
      'UNSUPPORTED',
      `Settings' fingerprint enrolment did not come to its sensor in ${SETTINGS_STEPS} screens: enrol by hand, then biometric enroll`,
    );
  }

  /** Whether the sensor listens within a step's time. */
  private async listening() {
    const end = Date.now() + STEP_MS;
    do {
      if ((await this.prints()).enrolling) return true;
      await sleep(READ_AGAIN_MS);
    } while (Date.now() < end);
    return false;
  }
}
