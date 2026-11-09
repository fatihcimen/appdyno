import { DeviceError } from '@appdyno/protocol';

/** What to do about a read with no window, by what the agent found there: it says what, and no step. */
const NO_WINDOW_HINTS: Partial<Record<string, string>> = {
  'the app in front is not answering':
    'its main thread is busy: read again in a moment; if it stays, the app hangs: its log says on what, and stopping and launching it again ends it',
  'the screen is off or locked': 'the power key wakes it; a lock is opened by hand',
};

/** A failed read, refused again with what to do where it found no window. */
export function noWindowHint(e: unknown): never {
  if (!(e instanceof DeviceError) || e.code !== 'NOT_FOUND' || e.hint) throw e;
  const hint = NO_WINDOW_HINTS[e.message.replace(/^no window to read: /, '')];
  throw hint ? new DeviceError(e.code, e.message, hint) : e;
}

/**
 * What is true of the phone's own screen now. `dumpsys window` opens with the last ANR's own copy of its state, kept until
 * the next ANR or a reboot, and then gives each display its own focus and keyguard, a mirror's first: a first match there
 * reads a window long gone, or a display with nothing on it. Both go, whatever else is read, as where a line lives changes
 * between releases. Nothing anchors the display's line: a Xiaomi prints it on the end of another.
 */
const OTHER_DISPLAY = '/Display: mDisplayId=[1-9]/,/Display: mDisplayId=0|^WINDOW MANAGER/';
const LIVE_DUMP = `dumpsys window | sed -E -e '/^WINDOW MANAGER LAST ANR/,/^WINDOW MANAGER POLICY/d' -e '${OTHER_DISPLAY}{/Display: mDisplayId=0|^WINDOW MANAGER/!d;}'`;

/** The window that has the focus, as it is now. */
export const FOCUS_READ = `${LIVE_DUMP} | grep -m1 mCurrentFocus`;
/** Whether the keyguard shows, as it is now. */
export const KEYGUARD_READ = `${LIVE_DUMP} | grep -m1 -E 'isKeyguardShowing=|mShowingLockscreen='`;
