import { join } from 'node:path';
import {
  run,
  type BiometricAnswer,
  type Push,
  type PushRoute,
  type PushTokenKind,
  type DeviceEvent,
  type DeviceEvents,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { ApnsPush } from './apns-push.js';
import { simulatorApnsTarget } from './sim-apns.js';
import { simulatorPush, simulatorRoutes } from './sim-push.js';
import type { Simctl } from './simctl.js';

/** What a simulator has no way to take, as each refusal says it. */
export const SIM_CANNOT = {
  fold: 'simctl has no fold pose (its ui and io options name none), and this simulator has one display',
  call: 'a simulator has no telephony: it cannot take a call',
  sms: 'a simulator has no telephony: it cannot take an SMS',
  radio: "a simulator has no radios: it uses the Mac's network",
} as const;

/** The rows of the keychain's tables that are not the system's own. */
const APP_ITEMS = `select count(*) from (${['genp', 'inet', 'cert', 'keys']
  .map((t) => `select agrp from ${t}`)
  .join(' union all ')}) where agrp != 'apple' and agrp not like 'com.apple.%'`;

/** A simulator's one-time events; what it has no way to take says so. */
export class SimulatorEvents implements DeviceEvents {
  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
    /** The app in front, if it can be read: what a push reaches depends on it. */
    private readonly front: () => Promise<string | undefined>,
    /** What simctl cannot take, once a person set APNs up. */
    private readonly apns = new ApnsPush(simulatorApnsTarget(simctl, udid)),
  ) {}

  private spawn = (...words: string[]) => this.simctl.exec(['spawn', this.udid, ...words]);

  pushRoutes() {
    return new Promise<PushRoute[]>((resolve) => {
      resolve(simulatorRoutes(this.apns.routes()));
    });
  }

  push(app: string, push: Push) {
    return push.type === 'alert' || !this.apns.ready
      ? simulatorPush(this.simctl, this.udid, app, push, this.front)
      : this.apns.push(app, push);
  }

  pushToken(app: string, token: string, kind?: PushTokenKind) {
    this.apns.typed(app, token, kind);
  }

  /** Enrols if needed and answers the next biometric request: Face ID and Touch ID, whichever it has. */
  async biometric(answer: BiometricAnswer): Promise<undefined> {
    await this.spawn('notifyutil', '-s', 'com.apple.BiometricKit.enrollmentChanged', '1');
    await this.spawn('notifyutil', '-p', 'com.apple.BiometricKit.enrollmentChanged');
    if (answer === 'enroll') return;
    await this.spawn('notifyutil', '-p', `com.apple.BiometricKit_Sim.pearl.${answer}`);
    await this.spawn('notifyutil', '-p', `com.apple.BiometricKit_Sim.fingerTouch.${answer}`);
  }

  /** What apps hold in the simulator's store: a reset leaves the system's own rows, and says nothing itself. */
  private async keychainItems() {
    const home = (await this.simctl.exec(['getenv', this.udid, 'HOME'])).trim();
    const db = join(home, 'Library/Keychains/keychain-2-debug.db');
    const { stdout } = await run('sqlite3', ['-readonly', db, APP_ITEMS]);
    return Number(stdout.trim());
  }

  async resetKeychain() {
    const held = await this.keychainItems();
    await this.simctl.exec(['keychain', this.udid, 'reset']);
    const left = await this.keychainItems();
    if (left > 0)
      throw new DeviceError('INTERNAL', `apps still hold ${left} keychain items after a reset`);
    return held;
  }

  cannot(event: DeviceEvent) {
    return event === 'biometric' ? undefined : SIM_CANNOT[event];
  }

  call(): Promise<void> {
    return Promise.reject(new DeviceError('UNSUPPORTED', SIM_CANNOT.call));
  }

  sms(): Promise<void> {
    return Promise.reject(new DeviceError('UNSUPPORTED', SIM_CANNOT.sms));
  }
}
