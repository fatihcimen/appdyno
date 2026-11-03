import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Check, DeviceProvider } from '@appdyno/core';
import type { DeviceError } from '@appdyno/protocol';
import { IosSimulatorDevice } from './device.js';
import { Simulators } from './manage.js';
import { IosPhoneDevice, phoneRunnerApp } from './phone.js';
import { iosProducts } from './runner.js';
import { DirectSim } from './simdirect.js';
import { findPhoneSigning, phoneSigningFromEnv, readProfile } from './signing.js';
import { Simctl, xcodeEnv, type Simulator } from './simctl.js';
import { listPhones } from './usbmux.js';

const run = promisify(execFile);

/** A simulator is named by its id. */
const SIMULATOR_ID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
/** An iPhone's UDID. */
const PHONE_ID = /^[0-9A-F]{8}-[0-9A-F]{16}$|^[0-9a-f]{40}$/;

/** iOS (optional, so warnings): Xcode, the runner builds, the iPhone signing and the connected phones. */
export async function iosChecks(now = Date.now()): Promise<Check[]> {
  const out: Check[] = [];
  const warn = (name: string, detail: string, fix?: string): Check => ({
    name,
    ok: false,
    warn: true,
    detail,
    ...(fix && { fix }),
  });
  try {
    const { stdout } = await run('xcodebuild', ['-version'], { timeout: 30_000, env: xcodeEnv() });
    out.push({ name: 'xcode', ok: true, detail: stdout.trim().split('\n').join(', ') });
  } catch {
    out.push(warn('xcode', 'not found', 'install Xcode (iOS only)'));
    return out;
  }
  // looked up only: a missing runner is built once on its first use, never by doctor
  const sim = await iosProducts('simulator', false).catch(() => undefined);
  out.push(
    sim
      ? { name: 'ios runner (simulator)', ok: true, detail: sim }
      : warn(
          'ios runner (simulator)',
          'not built yet',
          'built once on first use (a few minutes), or build it now from ios/ (README)',
        ),
  );
  const phone = await phoneRunnerApp(false).catch(() => undefined);
  out.push(
    phone
      ? { name: 'ios runner (iPhone)', ok: true, detail: phone }
      : warn(
          'ios runner (iPhone)',
          'not built yet',
          'built once on first use (a few minutes), or build it now from ios/ (README)',
        ),
  );
  const phones = await listPhones().catch(() => [] as string[]);
  const explicit = phoneSigningFromEnv();
  if (!phones.length && !explicit)
    out.push(warn('iPhone signing', 'chosen when a phone is connected (needed for iPhones only)'));
  for (const udid of phones.length ? phones : explicit ? [undefined] : []) {
    const name = udid ? `iPhone ${udid}` : 'iPhone signing';
    try {
      const signing = udid ? await findPhoneSigning(udid) : explicit!;
      const profile = await readProfile(signing.profile);
      const days = profile.expires
        ? Math.floor((Date.parse(profile.expires) - now) / 86_400_000)
        : undefined;
      const ids = (
        await run('security', [
          'find-identity',
          '-v',
          '-p',
          'codesigning',
          ...(signing.keychain ? [signing.keychain] : []),
        ])
      ).stdout;
      const identity = profile.certSha1.some((h) => ids.includes(h));
      const inProfile = !udid || profile.devices.includes(udid);
      out.push({
        name,
        ok: identity && inProfile && (days === undefined || days > 0),
        ...(days !== undefined && days < 30 && { warn: true }),
        detail: `${profile.appId} (team ${profile.team}), ${days === undefined ? 'no expiry' : `expires in ${days} days`}, ${identity ? 'identity in the keychain' : 'no identity of the profile in the keychain'}${inProfile ? '' : ', phone not in the profile'}`,
        ...(!identity && { fix: "import the profile's development certificate into the keychain" }),
        ...(!inProfile && { fix: "add the phone's UDID to the profile and download it again" }),
      });
    } catch (e) {
      out.push(warn(name, (e as DeviceError).message, (e as DeviceError).hint));
    }
  }
  return out;
}

/** The simulator's direct input and read: answering, else the runner does the work (slower, still right). */
export async function directChecks(udid: string, direct = new DirectSim(udid)): Promise<Check[]> {
  const check = (name: string, how: string): Check =>
    how === 'ok'
      ? { name, ok: true, detail: 'answers' }
      : { name, ok: false, warn: true, detail: `${how}; the runner does this instead` };
  const r = await direct.probe().catch((e: Error) => ({
    input: e.message.slice(0, 200),
    read: e.message.slice(0, 200),
  }));
  return [
    check(`simulator ${udid} direct input`, r.input),
    check(`simulator ${udid} direct read`, r.read),
  ];
}

/** Booted simulators (none when Xcode is missing). */
const bootedSimulators = (): Promise<Simulator[]> =>
  new Simctl()
    .list()
    .then((l) => l.filter((d) => d.state === 'Booted'))
    .catch(() => []);

/** Simulators and iPhones connected by USB. */
export function appleProvider(
  connected: { simulators: () => Promise<Simulator[]>; phones: () => Promise<string[]> } = {
    simulators: bootedSimulators,
    phones: () => listPhones().catch(() => []),
  },
): DeviceProvider {
  return {
    list: async () => [
      ...(await connected.simulators()).map((d) => ({
        serial: d.udid,
        state: 'booted',
        model: `iOS simulator ${d.name}`,
      })),
      ...(await connected.phones()).map((udid) => ({
        serial: udid,
        state: 'usb',
        model: 'iPhone',
      })),
    ],
    handles: (serial) => SIMULATOR_ID.test(serial) || PHONE_ID.test(serial),
    virtual: new Simulators(new Simctl()),
    open: (serial) =>
      SIMULATOR_ID.test(serial) ? new IosSimulatorDevice(serial) : new IosPhoneDevice(serial),
    doctor: async (serial) => [
      ...(await iosChecks()),
      ...(await bootedSimulators()).map((s) => ({
        name: `simulator ${s.udid}`,
        ok: true,
        detail: `${s.name}, booted`,
      })),
      // a named simulator only: the helpers run inside it
      ...(serial && SIMULATOR_ID.test(serial) ? await directChecks(serial) : []),
    ],
  };
}
