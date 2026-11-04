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
