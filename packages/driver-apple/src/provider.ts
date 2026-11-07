import type { Check, DeviceProvider, Need } from '@appdyno/core';
import type { DeviceError } from '@appdyno/protocol';
import { IosSimulatorDevice } from './simulator.js';
import { Simulators } from './simulators.js';
import { IosPhoneDevice, phoneRunnerApp } from './phone.js';
import { iosProducts } from './runner-build.js';
import { DirectSim } from './simdirect.js';
import { findPhoneSigning, phoneSigningFromEnv, readProfile } from './signing.js';
import { Simctl, xcodeEnv, type Simulator } from './simctl.js';
import { Devicectl } from './devicectl.js';
import { queryTraceFile } from './trace.js';
import { iphoneGuide } from './guide.js';
import { listPhones, sameUdid, type UsbAttach } from './usbmux.js';
import { pairedPhones } from './wifi-paired.js';
import { deviceState, run } from '@appdyno/core';
import { z } from 'zod';

const RUNNER_NOT_BUILT =
  'built once on first use (a few minutes), or build it now: appdyno ios build';

/** The runner's deployment target. */
const RUNNER_MIN_IOS = 17;

/**
 * What keeps a phone from being driven: what the Mac knows of it, then its lock, which asks the phone. `trusted`: it
 * has been seen to trust this Mac on this cable, so its lock is asked alongside; the answer is the fresh list's either way.
 */
export async function phoneNeed(
  ctl: Pick<Devicectl, 'listed' | 'lockState'>,
  trusted = false,
): Promise<Need | undefined> {
  const lock = trusted ? ctl.lockState() : undefined;
  // its failure counts only once the list has passed
  lock?.catch(() => undefined);
  const phone = await ctl.listed();
  if (!phone) return 'not-connected';
  if (phone.connectionProperties?.pairingState !== 'paired') return 'not-trusted';
  if (phone.deviceProperties?.developerModeStatus !== 'enabled') return 'developer-mode-off';
  if (parseInt(phone.deviceProperties.osVersionNumber ?? '', 10) < RUNNER_MIN_IOS)
    return 'os-too-old';
  return (await (lock ?? ctl.lockState())).passcodeRequired ? 'locked' : undefined;
}

/**
 * The plug-in on which each phone's list last passed, by the multiplexer's number: on it, the phone trusts this Mac.
 * On disk, as a session's first list is a process of its own. Any other answer, or a failed read, takes it away.
 * shortcut: usbmux numbers plug-ins anew when it restarts, so a kept number may come back; that changes when the lock
 * is asked, never the answer. Upgrade if usbmux gives a plug-in an identity that outlives it.
 */
const trustedOn = deviceState('iphone-trusted-on', z.number().int());

/** What is kept says only when to ask the lock: a file that cannot be written changes no answer. */
function keepTrusted(serial: string, plugIn: number | undefined) {
  try {
    if (plugIn === undefined) trustedOn.remove(serial);
    else if (trustedOn.read(serial) !== plugIn) trustedOn.write(serial, plugIn);
  } catch {
    // the next list asks the lock after the list, as with nothing kept
  }
}

/** A phone's need, its lock asked alongside the list on a plug-in where it has been seen to trust this Mac. */
async function usbPhoneNeed(
  serial: string,
  plugIn: number | undefined,
  ctl: Pick<Devicectl, 'listed' | 'lockState'>,
) {
  let trusts = false;
  try {
    const need = await phoneNeed(ctl, plugIn !== undefined && trustedOn.read(serial) === plugIn);
    trusts = need === undefined || need === 'locked';
    return need;
  } finally {
    keepTrusted(serial, trusts ? plugIn : undefined);
  }
}

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
      : warn('ios runner (simulator)', 'not built yet', RUNNER_NOT_BUILT),
  );
  const phone = await phoneRunnerApp(false).catch(() => undefined);
  out.push(
    phone
      ? { name: 'ios runner (iPhone)', ok: true, detail: phone }
      : warn('ios runner (iPhone)', 'not built yet', RUNNER_NOT_BUILT),
  );
  const phones = (await listPhones().catch(() => [])).map((p) => p.udid);
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
  connected: {
    simulators: () => Promise<Simulator[]>;
    phones: () => Promise<UsbAttach[]>;
    /** Paired for Wi-Fi: what is on disk, as a list comes often and a look on the network takes seconds. */
    paired?: () => string[];
    devicectl?: (udid: string) => Pick<Devicectl, 'listed' | 'lockState'>;
  } = {
    simulators: bootedSimulators,
    phones: () => listPhones().catch(() => []),
    paired: pairedPhones,
  },
): DeviceProvider {
  const devicectl = connected.devicectl ?? ((udid) => new Devicectl(udid));
  return {
    list: async () => {
      // each is asked of its own tool, at once
      const [simulators, attached] = await Promise.all([
        connected.simulators(),
        connected.phones(),
      ]);
      const phones = attached.map((p) => p.udid);
      return [
        ...simulators.map((d) => ({
          serial: d.udid,
          state: 'booted',
          ready: true,
          model: `iOS simulator ${d.name}`,
        })),
        ...phones.map((udid) => ({
          serial: udid,
          state: 'usb',
          ready: true,
          model: 'iPhone',
          link: 'USB' as const,
        })),
        // with no cable a window is all it can do, and whether the phone is there is that window's to say
        ...(connected.paired?.() ?? [])
          .filter((udid) => !phones.some((phone) => sameUdid(phone, udid)))
          .map((udid) => ({
            serial: udid,
            state: 'network',
            ready: false,
            model: 'iPhone',
            link: 'Wi-Fi' as const,
          })),
      ];
    },
    handles: (serial) => SIMULATOR_ID.test(serial) || PHONE_ID.test(serial),
    need: async ({ serial, state }) => {
      if (SIMULATOR_ID.test(serial) || state === 'network') return undefined;
      const plugIn = (await connected.phones()).find((p) => sameUdid(p.udid, serial));
      return usbPhoneNeed(serial, plugIn?.deviceId, devicectl(serial));
    },
    guide: iphoneGuide,
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
    queryTrace: queryTraceFile,
  };
}
