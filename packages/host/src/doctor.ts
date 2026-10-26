import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DeviceError } from '@appdyno/protocol';
import { Adb } from './adb.js';
import { agentApk } from './android/agent.js';
import { traceProcessor } from './tools.js';
import { AndroidDevice } from './android/device.js';
import { phoneRunnerApp } from './ios/phone.js';
import { iosProducts } from './ios/runner.js';
import { phoneSigningFromEnv, readProfile } from './ios/signing.js';
import { Simctl, xcodeEnv } from './ios/simctl.js';
import { listPhones } from './ios/usbmux.js';

const run = promisify(execFile);

export type Check = { name: string; ok: boolean; warn?: boolean; detail: string; fix?: string };

/**
 * What this machine (and, with `serial`, that device) needs: Node, adb, the agent build; on the device
 * the agent starting and answering, no other UI automation owner, and an emulator on the host GPU.
 */
export async function doctor(opts: { serial?: string; adb?: Adb } = {}): Promise<Check[]> {
  const adb = opts.adb ?? new Adb();
  const checks: Check[] = [];
  checks.push(...(await iosChecks()));
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'node',
    ok: major >= 22,
    detail: process.versions.node,
    ...(major < 22 && { fix: 'install Node 22 or newer (mise use node@22)' }),
  });
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  checks.push(
    sdk
      ? { name: 'android sdk', ok: true, detail: sdk }
      : {
          name: 'android sdk',
          ok: false,
          warn: true,
          detail: 'ANDROID_HOME is not set',
          fix: 'set ANDROID_HOME to the Android SDK (Android only)',
        },
  );
  try {
    const { stdout } = await run(adb.bin, ['version'], { timeout: 10_000 });
    checks.push({ name: 'adb', ok: true, detail: stdout.split('\n')[0]!.trim() });
  } catch {
    checks.push({
      name: 'adb',
      ok: false,
      detail: `not found at ${adb.bin}`,
      fix: 'install the Android SDK platform-tools and set ANDROID_HOME',
    });
    return checks;
  }
  try {
    const apk = await agentApk();
    checks.push({
      name: 'android agent',
      ok: true,
      detail: `${apk.path} (${apk.sha256.slice(0, 12)})`,
    });
  } catch (e) {
    checks.push({
      name: 'android agent',
      ok: false,
      detail: (e as Error).message,
      fix: (e as DeviceError).hint ?? '',
    });
  }
  try {
    checks.push({ name: 'trace processor', ok: true, detail: await traceProcessor() });
  } catch (e) {
    checks.push({
      name: 'trace processor',
      ok: false,
      warn: true,
      detail: 'not installed: frame timelines are not available',
      fix: (e as DeviceError).hint ?? 'appdyno tools install',
    });
  }
  checks.push(...(await deviceList(adb)));
  if (!opts.serial) return checks;

  const serial = opts.serial;
  const dev = (await adb.devices()).find((d) => d.serial === serial);
  if (!dev || dev.state !== 'device') {
    checks.push({
      name: `device ${serial}`,
      ok: false,
      detail: dev ? `state ${dev.state}` : 'not connected',
      fix:
        dev?.state === 'unauthorized'
          ? 'accept the USB debugging prompt on the phone'
          : 'connect the device (adb devices)',
    });
    return checks;
  }
  checks.push({ name: `device ${serial}`, ok: true, detail: dev.props.model ?? 'connected' });
  if (serial.startsWith('emulator-')) {
    try {
      const { stdout } = await run('ps', ['-axo', 'args'], { timeout: 10_000 });
      const port = serial.slice('emulator-'.length);
      const line = stdout
        .split('\n')
        .find((l) => /qemu-system/.test(l) && l.includes(`-port ${port}`));
      const gpu = line && /-gpu (\S+)/.exec(line)?.[1];
      checks.push({
        name: 'emulator gpu',
        ok: gpu === 'host',
        warn: gpu !== 'host',
        detail: gpu ?? 'unknown (no -gpu flag seen)',
        ...(gpu !== 'host' && {
          fix: 'start the emulator with -gpu host: software rendering makes every read many times slower',
        }),
      });
    } catch {
      // no ps: nothing to say
    }
  }
  const d = new AndroidDevice(serial, adb);
  try {
    const t = Date.now();
    const hello = await d.open();
    checks.push({
      name: 'agent',
      ok: true,
      detail: `${hello.agentVersion} on Android ${hello.osVersion} (SDK ${hello.sdk}), ${d.lastStartWasCold ? 'started' : 'already running'} in ${Date.now() - t} ms`,
    });
    const tree = await d.tree();
    checks.push({
      name: 'screen read',
      ok: tree.nodes.length > 0,
      detail: `${tree.nodes.length} nodes in ${tree.elapsedMs} ms`,
    });
  } catch (e) {
    const de = e as DeviceError;
    checks.push({
      name: 'agent',
      ok: false,
      detail: `${de.code ?? 'ERROR'}: ${de.message}`,
      ...(de.hint && { fix: de.hint }),
    });
  } finally {
    d.close();
  }
  return checks;
}

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
  let signing;
  try {
    signing = phoneSigningFromEnv();
  } catch (e) {
    out.push(warn('iPhone signing', 'not set (needed for iPhones only)', (e as DeviceError).hint));
    return out;
  }
  try {
    const profile = await readProfile(signing.profile);
    const days = profile.expires
      ? Math.floor((Date.parse(profile.expires) - now) / 86_400_000)
      : undefined;
    const ids = (
      await run('security', ['find-identity', '-v', '-p', 'codesigning', signing.keychain])
    ).stdout;
    const identity = profile.certSha1.some((h) => ids.includes(h));
    out.push({
      name: 'iPhone signing',
      ok: identity && (days === undefined || days > 0),
      ...(days !== undefined && days < 30 && { warn: true }),
      detail: `${profile.appId} (team ${profile.team}), ${days === undefined ? 'no expiry' : `expires in ${days} days`}, ${identity ? 'identity in the keychain' : 'no identity of the profile in the keychain'}`,
      ...(!identity && { fix: "import the profile's development certificate into the keychain" }),
    });
    for (const udid of await listPhones().catch(() => [] as string[]))
      out.push({
        name: `iPhone ${udid}`,
        ok: profile.devices.includes(udid),
        detail: profile.devices.includes(udid)
          ? 'connected by USB, in the profile'
          : 'connected by USB, not in the profile',
        ...(!profile.devices.includes(udid) && {
          fix: "add the phone's UDID to the profile and download it again",
        }),
      });
  } catch (e) {
    out.push({ name: 'iPhone signing', ok: false, detail: (e as Error).message });
  }
  return out;
}

/** What is connected: Android devices (with their state) and booted simulators; iPhones are under iOS. */
async function deviceList(adb: Adb): Promise<Check[]> {
  const out: Check[] = [];
  for (const d of await adb.devices().catch(() => []))
    out.push({
      name: `android ${d.serial}`,
      ok: d.state === 'device',
      detail: `${d.state}${d.props.model ? `, ${d.props.model}` : ''}`,
      ...(d.state === 'unauthorized' && { fix: 'accept the USB debugging prompt on the phone' }),
      ...(d.state === 'offline' && { fix: 'reconnect the cable, or restart the emulator' }),
    });
  for (const s of await new Simctl().list().catch(() => []))
    if (s.state === 'Booted')
      out.push({ name: `simulator ${s.udid}`, ok: true, detail: `${s.name}, booted` });
  return out;
}
