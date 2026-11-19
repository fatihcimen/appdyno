import { run } from '@appdyno/core';
import { DeviceError, type ActParams } from '@appdyno/protocol';
import type { Simctl } from './simctl.js';

/** Simulator.app as Xcode runs it, in the Mac's process list: another process named Simulator is not it. */
const SIMULATOR_APP = /\/Simulator\.app\/Contents\/MacOS\/Simulator\s*$/m;
/** A switch `defaults` reads as off: Simulator takes anything else, and no value at all, as on. */
const OFF = /^(0|no|false)$/i;

/**
 * Whether Simulator.app syncs a simulator's pasteboard with this Mac's, each way: while it runs with its Edit › Automatically
 * Sync Pasteboard on, as it is by default. It reads that setting at its launch and from the menu alone, and each of
 * them writes it back, so what `defaults` reads is what runs: a value written behind it waits for its next launch.
 */
export const syncsToMac = (processes: string, setting: string | undefined) =>
  SIMULATOR_APP.test(processes) && !OFF.test(setting?.trim() ?? '');

/** `syncsToMac` on this Mac now. */
export async function macSyncsPasteboard() {
  const [processes, setting] = await Promise.all([
    run('ps', ['-axo', 'comm=']).then((r) => r.stdout),
    run('defaults', ['read', 'com.apple.iphonesimulator', 'PasteboardAutomaticSync']).then(
      (r) => r.stdout,
      () => undefined,
    ),
  ]);
  return syncsToMac(processes, setting);
}

const TYPE_IT = 'type the text into its field instead, which takes no clipboard';
/** What a refusal says while the sync runs, by what was asked, with what to do instead. */
const SYNCED = {
  write: ["would put this text on your Mac's clipboard", TYPE_IT],
  copy: ["would put what it copies on your Mac's clipboard", TYPE_IT],
  read: [
    "puts your Mac's clipboard on this simulator's, and a read would hand it out",
    'read the text where the app shows it instead',
  ],
} as const;

/**
 * Refuses a use of a simulator's pasteboard that would reach the Mac's clipboard, a person's: a write would replace it,
 * and a read hand out what Simulator.app put there from it, a password as much as anything. Turning the sync off here
 * would not stop it: Simulator.app takes the setting only at its launch or from its menu.
 */
export async function refuseWhereSynced(asked: keyof typeof SYNCED) {
  if (!(await macSyncsPasteboard())) return;
  const [what, hint] = SYNCED[asked];
  throw new DeviceError(
    'UNSUPPORTED',
    `Simulator's pasteboard sync ${what}: turn off Edit › Automatically Sync Pasteboard in Simulator to use a simulator's clipboard`,
    hint,
  );
}

/** Whether a key copies or cuts, and so writes the pasteboard: Command-C and Command-X. */
export const copies = (a: ActParams) =>
  a.kind === 'key' && (a.key === 'c' || a.key === 'x') && !!a.modifiers?.includes('command');

/**
 * From the Mac: at times the runner's own pasteboard call held it up for its 15 s. Where the Mac's call writes
 * nothing, as `simctl pbcopy` on a new iOS 26.5 simulator with Xcode 27.1, only the runner's is left, and a stall
 * of that is refused as what it is: it was restarted for it, and a second wait saw the same at load 138. The Mac's
 * call goes first, as it refuses where Simulator.app would sync the text to the Mac, which the runner's would be too.
 */
export async function setSimClipboard(
  simctl: Simctl,
  udid: string,
  text: string,
  byRunner: (text: string) => Promise<void>,
) {
  await simctl.pbcopy(udid, text);
  if ((await simctl.pbpaste(udid)) === text) return;
  await byRunner(text).catch((e: unknown) => {
    if (!(e instanceof DeviceError && e.code === 'TIMEOUT')) throw e;
    throw new DeviceError(
      'UNSUPPORTED',
      `this simulator's clipboard did not take the text: simctl pbcopy wrote nothing and the runner's call stalled`,
      'try again once the Mac is less busy, or type the text instead',
      { cause: e, retryable: true },
    );
  });
}
