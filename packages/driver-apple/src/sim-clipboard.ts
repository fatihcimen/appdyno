import { run } from '@appdyno/core';
import { DeviceError, type ActParams } from '@appdyno/protocol';
import type { Simctl } from './simctl.js';

/**
 * What syncs a simulator's pasteboard with this Mac's, each way, while it runs, as `ps` lists it with its arguments,
 * and how a person stops it. Simulator.app's switch is the only one read here: nothing else is taken as off.
 */
const SYNCERS: { runs: RegExp; who: string; stop: string; switchable?: true }[] = [
  {
    // Xcode 26's and before, of any Xcode: another process named Simulator is not it. Its Edit › Automatically Sync
    // Pasteboard is on by default; it reads that at its launch and from the menu alone, and each of them writes it
    // back, so what `defaults` reads is what runs: a value written behind it waits for its next launch
    runs: /\/Simulator\.app\/Contents\/MacOS\/Simulator(\s|$)/m,
    who: 'Simulator',
    stop: 'turn off Edit › Automatically Sync Pasteboard in Simulator',
    switchable: true,
  },
  {
    // Xcode 27's, in Simulator.app's place: its trampoline, the app it starts, or its menu bar extra. Its Edit › Use
    // Shared Clipboard is kept in its sandbox's container, which macOS keeps from other apps behind a person's yes
    runs: /\/(DeviceHub|DevicesMenu\w*)\.app\/Contents\/MacOS\//m,
    who: 'Device Hub',
    stop: 'quit Device Hub and its menu bar extra',
  },
  {
    // syncs both ways until it ends
    runs: /\bdevicectl\b.*\bsync-with-host\b/m,
    who: 'devicectl',
    stop: 'stop `devicectl device pasteboard sync-with-host`',
  },
];
/** A switch `defaults` reads as off: Simulator takes anything else, and no value at all, as on. */
const OFF = /^(0|no|false)$/i;

/** What syncs a simulator's pasteboard with this Mac's, by the processes `ps` lists and Simulator's switch. */
export const syncsToMac = (processes: string, setting: string | undefined) =>
  SYNCERS.filter(
    (s) => s.runs.test(processes) && !(s.switchable && OFF.test(setting?.trim() ?? '')),
  );

/** `syncsToMac` on this Mac now, by each process's executable and by its arguments, as either may name it. */
async function syncingNow() {
  const [paths, args, setting] = await Promise.all([
    run('ps', ['-axo', 'comm=']).then((r) => r.stdout),
    run('ps', ['-axww', '-o', 'args=']).then((r) => r.stdout),
    run('defaults', ['read', 'com.apple.iphonesimulator', 'PasteboardAutomaticSync']).then(
      (r) => r.stdout,
      () => undefined,
    ),
  ]);
  return syncsToMac(`${paths}\n${args}`, setting);
}

/** Whether anything syncs a simulator's pasteboard with this Mac's now. */
export const macSyncsPasteboard = async () => (await syncingNow()).length > 0;

const TYPE_IT = 'type the text into its field instead, which takes no clipboard';
/** What a refusal says while the sync runs, by what was asked, with what to do instead. */
const SYNCED = {
  write: ["would put this text on your Mac's clipboard", TYPE_IT],
  copy: ["would put what it copies on your Mac's clipboard", TYPE_IT],
  read: [
    "puts your Mac's clipboard on this simulator's, and a read would hand it out",
    'read the text where the app shows it instead',
  ],
  paste: [
    "puts your Mac's clipboard on this simulator's, and a paste would put it in the field",
    TYPE_IT,
  ],
} as const;

/**
 * Refuses a use of a simulator's pasteboard that would reach the Mac's clipboard, a person's: a write would replace it,
 * and a read hand out what the sync put there from it, a password as much as anything. Turning the sync off here
 * would not stop it: Simulator.app takes the setting only at its launch or from its menu.
 */
export async function refuseWhereSynced(asked: keyof typeof SYNCED) {
  const syncing = await syncingNow();
  if (syncing.length === 0) return;
  const [what, hint] = SYNCED[asked];
  const each = (words: string[]) => words.join(' and ');
  throw new DeviceError(
    'UNSUPPORTED',
    `${each(syncing.map((s) => `${s.who}'s`))} pasteboard sync ${what}: ${each(syncing.map((s) => s.stop))} to use a simulator's clipboard`,
    hint,
  );
}

/** What a key asks of the pasteboard: Command-C and Command-X write it, Command-V puts what it holds in the field. */
export function pasteboardKey(a: ActParams): 'copy' | 'paste' | undefined {
  if (a.kind !== 'key' || !a.modifiers?.includes('command')) return undefined;
  return a.key === 'c' || a.key === 'x' ? 'copy' : a.key === 'v' ? 'paste' : undefined;
}

/**
 * From the Mac: at times the runner's own pasteboard call held it up for its 15 s. Where the Mac's call writes
 * nothing, as `simctl pbcopy` on a new iOS 26.5 simulator with Xcode 27.1, only the runner's is left, and a stall
 * of that is refused as what it is: it was restarted for it, and a second wait saw the same at load 138. The Mac's
 * call goes first, as it refuses where the text would be synced to the Mac (`syncsToMac`), which the runner's would be too.
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
