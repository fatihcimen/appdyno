import { run, type Check } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { xcodeEnv, xcodeTool } from './simctl.js';

const NOT_DONE =
  "Xcode's first-launch setup is not done: devicectl would start it, and it asks for an administrator's password on this Mac";
const FIX = 'run `sudo xcodebuild -runFirstLaunch` in a terminal, or open Xcode once';

/**
 * Whether Xcode's first-launch setup is done, by the check that is instant and asks nothing: undefined where it cannot
 * be asked, as without Xcode's own xcodebuild, where devicectl says itself what is missing.
 */
export async function firstLaunchDone(env = xcodeEnv()): Promise<boolean | undefined> {
  const [file, args] = xcodeTool('xcodebuild', ['-checkFirstLaunchStatus'], env);
  if (file === 'xcrun') return undefined;
  try {
    await run(file, args, { env, timeout: 10_000 });
    return true;
  } catch (e) {
    // its own exit says not done; one that never ran or hung says nothing of it
    return typeof (e as { code?: unknown }).code === 'number' ? false : undefined;
  }
}

let asked = false;

/**
 * Refuses before devicectl runs while Xcode's first-launch setup is not done: each devicectl call starts it then, which
 * puts a password prompt on a person's screen and takes the call past its time. Asked once a process, and again after
 * a refusal, so that the setup a person then runs needs no restart.
 */
export async function devicectlReady(env = xcodeEnv()) {
  if (asked) return;
  if ((await firstLaunchDone(env)) === false)
    throw new DeviceError('PERMISSION_REQUIRED', NOT_DONE, FIX);
  asked = true;
}

/** For doctor: none where it cannot be asked. */
export async function firstLaunchCheck(env = xcodeEnv()): Promise<Check | undefined> {
  const done = await firstLaunchDone(env);
  if (done === undefined) return undefined;
  return done
    ? { name: 'xcode first launch', ok: true, detail: 'done' }
    : { name: 'xcode first launch', ok: false, warn: true, detail: NOT_DONE, fix: FIX };
}
