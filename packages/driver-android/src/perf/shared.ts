import { DeviceError } from '@appdyno/protocol';
import { assertPkg } from '../adb.js';
import type { AndroidDevice } from '../device.js';

export const at = () => new Date().toISOString();

export type PerfDevice = Pick<
  AndroidDevice,
  'serial' | 'shell' | 'shellAlongside' | 'shellBuffer' | 'pull' | 'readyToMeasure' | 'ensureAwake'
>;

export const isVirtual = (d: PerfDevice) => /^emulator-/.test(d.serial);

/** Commands run in the C locale: a localized device writes `0,0`. */
export const sh = (d: PerfDevice, cmd: string, timeoutMs?: number) =>
  d.shell(`LC_ALL=C ${cmd}`, timeoutMs);

export async function pidOf(d: PerfDevice, pkg: string): Promise<number> {
  const out = (await sh(d, `pidof ${assertPkg(pkg)}`)).trim();
  const pid = Number(out.split(/\s+/)[0]);
  if (!out || !Number.isInteger(pid))
    throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not running`);
  return pid;
}

/** The uid the app's processes run as. */
export async function uidOf(d: PerfDevice, pkg: string): Promise<number> {
  assertPkg(pkg);
  const out = await sh(d, `pm list packages -U ${pkg}`);
  const uid = new RegExp(`^package:${pkg.replace(/\./g, '\\.')} uid:(\\d+)`, 'm').exec(out)?.[1];
  if (!uid) throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not installed`);
  return Number(uid);
}
