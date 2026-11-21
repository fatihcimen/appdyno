import { run } from '@appdyno/core';
import { DeviceError, type ActParams, type Method } from '@appdyno/protocol';

/**
 * The emulator's QEMU, as `ps` lists it with its arguments. The build with a window has Qt, which shares the clipboard
 * with this Mac's both ways while the emulator's Settings › Enable clipboard sharing is on, as it is by default; the
 * one `-no-window` starts, `qemu-system-…-headless`, has no Qt and none of that.
 */
const WINDOWED = /qemu-system-\w+(\s|$)/m;
const HEADLESS = /qemu-system-\w+-headless(\s|$)/m;

/**
 * Whether an emulator's clipboard may be this Mac's, a person's: so unless every emulator this Mac runs is a headless
 * one. The switch is not read: no read shows a running emulator follows it. Another QEMU with that name counts, and
 * so does a list with no emulator, which cannot say how this one runs.
 */
export const sharedWithMac = (processes: string) =>
  WINDOWED.test(processes) || !HEADLESS.test(processes);

/**
 * Whether this device's clipboard may be this Mac's now: an emulator's, by `sharedWithMac` of each process's executable
 * and its arguments, as either may name it; a phone's never is.
 */
export async function clipboardShared(serial: string) {
  if (!serial.startsWith('emulator-')) return false;
  const lists = await Promise.all([
    run('ps', ['-axo', 'comm=']),
    run('ps', ['-axww', '-o', 'args=']),
  ]);
  return sharedWithMac(lists.map((r) => r.stdout).join('\n'));
}

const TYPE_IT = 'type the text into its field instead';
/** What a refusal says while it may be shared, by what was asked, with what to do instead. */
const SHARED = {
  write: ["this text would go on your Mac's clipboard", TYPE_IT],
  copy: ["what it copies would go on your Mac's clipboard", TYPE_IT],
  read: [
    "it may hold your Mac's clipboard, and a read would hand it out",
    'read the text where the app shows it instead',
  ],
  paste: ["it may hold your Mac's clipboard, and a paste would put it in the field", TYPE_IT],
} as const;

/** What an agent call asks of the clipboard: Android takes Command as Ctrl, as it takes Control, in a field. */
function asks(method: Method, params: unknown): keyof typeof SHARED | undefined {
  if (method === 'clipboard.set') return 'write';
  if (method === 'clipboard.get') return 'read';
  if (method !== 'act') return undefined;
  const a = (params as { action: ActParams }).action;
  if (a.kind !== 'key' || !a.modifiers?.some((m) => m === 'command' || m === 'control'))
    return undefined;
  return a.key === 'c' || a.key === 'x' ? 'copy' : a.key === 'v' ? 'paste' : undefined;
}

/**
 * Refuses an agent call that would use the device's clipboard while that may be this Mac's (`clipboardShared`): a
 * write would replace a person's, and a read hand out what they copied, a password as much as anything.
 */
export async function keepOffTheMac(serial: string, method: Method, params: unknown) {
  const asked = asks(method, params);
  if (!asked || !(await clipboardShared(serial))) return;
  const [what, hint] = SHARED[asked];
  throw new DeviceError(
    'UNSUPPORTED',
    `an emulator with a window shares its clipboard with this Mac's, so ${what}: one started with -no-window shares none`,
    `${hint}, or start the emulator with -no-window (APPDYNO_EMULATOR_ARGS="-no-window -no-snapshot-save -no-boot-anim")`,
  );
}
