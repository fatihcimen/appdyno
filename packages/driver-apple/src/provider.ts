import { join } from 'node:path';
import { run, type Check, type DeviceProvider, must } from '@appdyno/core';
import type { DeviceError } from '@appdyno/protocol';
import { firstLaunchCheck } from './first-launch.js';
import { IosSimulatorDevice } from './simulator.js';
import { Simulators } from './simulators.js';
import { phoneRunnerApp } from './phone.js';
import { checkoutBehind, iosProducts } from './runner-build.js';
import { DirectSim } from './simdirect.js';
import { findPhoneSigning, phoneSigningFromEnv, readProfile } from './signing.js';
import { Simctl, xcodeEnv, type Simulator } from './simctl.js';
import { queryTraceFile } from './trace.js';
import { listPhones } from './usbmux.js';

const RUNNER_NOT_BUILT =
  'built once on first use (a few minutes), or build it now: appdyno ios build';

/** A simulator is named by its id. */
const SIMULATOR_ID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

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
  const firstLaunch = await firstLaunchCheck();
  if (firstLaunch) out.push(firstLaunch);
  // looked up only: a missing runner is built once on its first use, never by doctor
  const runner = (name: string, kind: 'simulator' | 'device', products?: string, at = products) => {
    if (!products || !at) return warn(name, 'not built yet', RUNNER_NOT_BUILT);
    const behind = checkoutBehind(kind, products);
    return behind
      ? warn(name, `older than its sources in ios/: ${at}`, behind)
      : { name, ok: true, detail: at };
  };
  const sim = await iosProducts('simulator', false).catch(() => undefined);
  out.push(runner('ios runner (simulator)', 'simulator', sim));
  const phone = await phoneRunnerApp(false).catch(() => undefined);
  // the app is Debug-iphoneos/Runner-Runner.app in the products
  out.push(runner('ios runner (iPhone)', 'device', phone && join(phone, '../..'), phone));
  const phones = (await listPhones().catch(() => [])).map((p) => p.udid);
  const explicit = phoneSigningFromEnv();
  if (!phones.length && !explicit)
    out.push(warn('iPhone signing', 'chosen when a phone is connected (needed for iPhones only)'));
  for (const udid of phones.length ? phones : explicit ? [undefined] : []) {
    const name = udid ? `iPhone ${udid}` : 'iPhone signing';
    try {
      const signing = udid ? await findPhoneSigning(udid) : must(explicit, 'a signing');
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
  const r = await direct.probe().catch((e: unknown) => {
    const why = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    return { input: why, read: why };
  });
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

/** Booted simulators. Xcode's checks, which iPhones stand on too, are this driver's: it is the first of the two. */
export function simulatorProvider(booted = bootedSimulators): DeviceProvider {
  return {
    list: async () =>
      (await booted()).map((d) => ({
        serial: d.udid,
        state: 'booted',
        ready: true,
        model: `iOS simulator ${d.name}`,
      })),
    handles: (serial) => SIMULATOR_ID.test(serial),
    virtual: new Simulators(new Simctl()),
    open: (serial) => new IosSimulatorDevice(serial),
    doctor: async (serial) => [
      ...(await iosChecks()),
      ...(await booted()).map((s) => ({
        name: `simulator ${s.udid}`,
        ok: true,
        detail: `${s.name}, booted`,
      })),
      // a named simulator only: the helpers run inside it
      ...(serial ? await directChecks(serial) : []),
    ],
    queryTrace: queryTraceFile,
  };
}
