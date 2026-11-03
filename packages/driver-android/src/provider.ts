import type { Check, DeviceProvider } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { Adb } from './adb.js';
import { agentApk } from './agent.js';
import { AndroidDevice } from './device.js';
import { AndroidEmulators } from './emulators.js';
import type { InstallAnswers } from './install-consent.js';
import { queryTrace } from './perf/perfetto.js';
import { traceProcessor } from './tools.js';
import { run } from '@appdyno/core';

/**
 * What this machine (and, with `serial`, that device) needs: adb, the agent build; on the device the agent
 * starting and answering, no other UI automation owner, and an emulator on the host GPU.
 */
export async function androidChecks(adb: Adb, serial?: string): Promise<Check[]> {
  const checks: Check[] = [];
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
  for (const d of await adb.devices().catch(() => []))
    checks.push({
      name: `android ${d.serial}`,
      ok: d.state === 'device',
      detail: `${d.state}${d.props.model ? `, ${d.props.model}` : ''}`,
      ...(d.state === 'unauthorized' && { fix: 'accept the USB debugging prompt on the phone' }),
      ...(d.state === 'offline' && { fix: 'reconnect the cable, or restart the emulator' }),
    });
  if (!serial) return checks;
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
  checks.push(await animationsCheck(adb, serial));
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

const SCALES = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'];

/** Animations left off (a session with `--animations off` that could not put them back) make timing lie. */
async function animationsCheck(adb: Adb, serial: string): Promise<Check> {
  const out = await adb
    .exec(serial, SCALES.map((k) => `settings get global ${k}`).join('; '))
    .catch(() => '');
  const off = out.split(/\s+/).some((v) => Number(v) === 0 && v !== '');
  return {
    name: 'animations',
    ok: !off,
    warn: off,
    detail: off ? `off (${out.trim().replace(/\s+/g, ', ')})` : 'on',
    ...(off && {
      fix: `unless a session with --animations off is running: adb -s ${serial} shell settings put global window_animation_scale 1 (and transition_animation_scale, animator_duration_scale)`,
    }),
  };
}

/** Android devices over adb, which takes any serial no later provider claims. */
/** A Mac set up for iOS alone has no adb, which is no failure of the list. */
const noAdbNoDevices = (e: unknown): never[] => {
  if (e instanceof DeviceError && e.code === 'UNSUPPORTED') return [];
  throw e;
};

export function androidProvider(
  adb: Adb = new Adb(),
  opts: { takeover?: boolean; animations?: 'on' | 'off'; installAnswers?: InstallAnswers } = {},
): DeviceProvider {
  return {
    list: async () =>
      (await adb.devices().catch(noAdbNoDevices)).map((d) => ({
        serial: d.serial,
        state: d.state,
        ready: d.state === 'device',
        ...(d.props.model && { model: d.props.model }),
      })),
    handles: () => true,
    virtual: new AndroidEmulators(adb),
    // a phone unplugged for a moment (or rebooting) is waited for, up to 30 s, on read-only calls
    open: (serial) =>
      new AndroidDevice(
        serial,
        new Adb(),
        30_000,
        opts.takeover,
        opts.animations,
        opts.installAnswers,
      ),
    doctor: (serial) => androidChecks(adb, serial),
    queryTrace,
  };
}
