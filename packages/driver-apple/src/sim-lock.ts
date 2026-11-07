import { pause } from '@appdyno/core';
import type { Simctl } from './simctl.js';

const WAKE_GAP_MS = 400;
const WAKE_PRESSES = 6;

/** A simulator locked by this tool: a screen under the lock still reads, and an app will not come forward. */
export class SimulatorLock {
  private locked = false;

  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
  ) {}

  /** The lock or the power key was pressed. */
  pressed() {
    this.locked = true;
  }

  /** As on Android: one press of `home` wakes it, one more opens it (no passcode here). */
  async wake(home: () => Promise<unknown>) {
    if (!this.locked) return;
    this.locked = false;
    // the lock comes a moment after its press; a press during its animation does nothing; and a read under the lock
    // holds the runner up for 15 s
    for (let i = 0; i < WAKE_PRESSES && !(await this.lockedNow()); i++)
      await pause(WAKE_GAP_MS / 2);
    for (let i = 0; i < WAKE_PRESSES && (await this.lockedNow()); i++) {
      await home();
      await pause(WAKE_GAP_MS);
    }
  }

  private async lockedNow() {
    const state = await this.simctl.exec([
      'spawn',
      this.udid,
      'notifyutil',
      '-g',
      'com.apple.springboard.lockstate',
    ]);
    return state.trim().endsWith(' 1');
  }
}
