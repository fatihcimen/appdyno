/**
 * `dumpsys window` opens with the last ANR's own copy of its state, and keeps it until the next ANR or a reboot: a first
 * match there reads a window long gone and a lock long changed. The section goes, whatever else is read, as where a
 * line lives changes between releases.
 */
const LIVE_DUMP = "dumpsys window | sed '/^WINDOW MANAGER LAST ANR/,/^WINDOW MANAGER POLICY/d'";

/** The window that has the focus, as it is now. */
export const FOCUS_READ = `${LIVE_DUMP} | grep -m1 mCurrentFocus`;
/** Whether the keyguard shows, as it is now. */
export const KEYGUARD_READ = `${LIVE_DUMP} | grep -m1 -E 'isKeyguardShowing=|mShowingLockscreen='`;
