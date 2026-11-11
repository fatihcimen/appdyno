import { sleep } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { FOCUS_READ, KEYGUARD_READ } from './window-dump.js';

/** How long a phone just woken gets for its focus to hold, and how long it must hold. */
const WAKE_FOCUS_MS = 5_000;
const WAKE_STEADY_MS = 600;

type Shell = (command: string) => Promise<string>;

/**
 * A screen that went dark or locked comes back: wake it, dismiss a keyguard without a credential, and
 * swipe it up when dismissing did not work. Says what it did; a locked device with a PIN stays locked.
 */
export async function wakeScreen(
  shell: Shell,
  screen: () => { w: number; h: number } | undefined,
): Promise<{ woke: boolean; unlocked: boolean; locked: boolean }> {
  const state = async () => {
    const out = await shell(`dumpsys power | grep -m1 'mWakefulness='; ${KEYGUARD_READ}`);
    return {
      awake: out.includes('mWakefulness=Awake'),
      locked: /isKeyguardShowing=true|mShowingLockscreen=true/.test(out),
    };
  };
  let s = await state();
  let woke = false;
  let unlocked = false;
  if (!s.awake) {
    await shell('input keyevent KEYCODE_WAKEUP');
    await sleep(400);
    woke = true;
    s = await state();
  }
  if (s.locked) {
    await shell('wm dismiss-keyguard');
    await sleep(600);
    s = await state();
    if (s.locked) {
      const w = screen() ?? { w: 1080, h: 2400 };
      await shell(
        `input swipe ${Math.round(w.w / 2)} ${Math.round(w.h * 0.9)} ${Math.round(w.w / 2)} ${Math.round(w.h * 0.3)} 250`,
      );
      await sleep(600);
      s = await state();
    }
    unlocked = !s.locked;
  }
  if (woke || unlocked) await focusSteady(shell);
  return { woke, unlocked, locked: s.locked };
}

/**
 * A phone just woken has the app on its screen before the app can take a touch: a Xiaomi passes through no focus
 * and its launcher, and a touch meanwhile reaches no window. Until the focus has held for a moment.
 */
export async function focusSteady(shell: Shell) {
  const end = Date.now() + WAKE_FOCUS_MS;
  let last = '';
  let since = Date.now();
  while (Date.now() < end) {
    const focus = await currentFocus(shell);
    if (!focus || focus !== last) {
      last = focus;
      since = Date.now();
    } else if (Date.now() - since >= WAKE_STEADY_MS) return;
    await sleep(150);
  }
}

/** What a screen locked behind a credential says: no tool can answer it. */
export const lockedError = (serial: string) =>
  new DeviceError(
    'DEVICE_LOCKED',
    `${serial} is locked behind its PIN, pattern or password`,
    'unlock it by hand: no tool can answer it',
  );

/** The window that has the focus; none between windows and on a dark screen. */
export async function currentFocus(shell: Shell): Promise<string> {
  const focus = /mCurrentFocus=(.*)/.exec(await shell(FOCUS_READ))?.[1];
  return focus === undefined || focus === 'null' ? '' : focus;
}
