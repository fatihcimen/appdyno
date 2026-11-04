import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidDevice } from '../src/device.js';
import { FOCUS_READ, KEYGUARD_READ } from '../src/window-dump.js';

/**
 * fixtures/window/*.txt are real `dumpsys window`, with only its section headers and the lines read here kept:
 * after-an-anr on a Samsung SM-A525F (Android 14) back on its lock screen after the fixture's ANR, no-anr on a Xiaomi
 * 25078RA3EY (Android 16) that had none since boot, mirror-open-* on each with the fixture's form under a mirror.
 */
const recorded = (name: string) => join(import.meta.dirname, 'fixtures/window', `${name}.txt`);
/** The read itself, run here on a recorded dump in place of the phone's. */
const read = (name: string, command: string) =>
  execSync(command.replace('dumpsys window', `cat ${recorded(name)}`), { encoding: 'utf8' });

describe('a read of the window dump', () => {
  it("takes what is true now, not the last ANR's copy", () => {
    expect(read('after-an-anr', FOCUS_READ)).toContain('NotificationShade');
    expect(read('after-an-anr', KEYGUARD_READ)).toContain('isKeyguardShowing=true');
  });

  it('reads the same with no ANR since boot', () => {
    expect(read('no-anr', FOCUS_READ)).toContain('mCurrentFocus=null');
    expect(read('no-anr', KEYGUARD_READ)).toContain('isKeyguardShowing=false');
  });

  it.each(['samsung', 'xiaomi'])("reads the phone's own display, not a mirror's: %s", (phone) => {
    const dump = `mirror-open-${phone}`;
    expect(read(dump, FOCUS_READ)).toContain('FormActivity');
    expect(read(dump, KEYGUARD_READ)).toContain('isKeyguardShowing=false');
  });

  it('a phone locked since its last ANR is seen as locked, and is dismissed', async () => {
    const commands: string[] = [];
    const exec = async (_serial: string, command: string) => {
      commands.push(command);
      return command.includes('dumpsys window')
        ? `mWakefulness=Awake\n${read('after-an-anr', KEYGUARD_READ)}`
        : '';
    };
    const state = await new AndroidDevice('s', { exec } as unknown as Adb).ensureAwake();
    expect(state.locked).toBe(true);
    expect(commands).toContain('wm dismiss-keyguard');
  });
});
