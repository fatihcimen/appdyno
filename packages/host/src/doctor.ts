import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DeviceError } from '@appdyno/protocol';
import { Adb } from './adb.js';
import { agentApk } from './android/agent.js';
import { traceProcessor } from './tools.js';
import { AndroidDevice } from './android/device.js';

const run = promisify(execFile);

export type Check = { name: string; ok: boolean; warn?: boolean; detail: string; fix?: string };

/**
 * What this machine (and, with `serial`, that device) needs: Node, adb, the agent build; on the device
 * the agent starting and answering, no other UI automation owner, and an emulator on the host GPU.
 */
export async function doctor(opts: { serial?: string; adb?: Adb } = {}): Promise<Check[]> {
  const adb = opts.adb ?? new Adb();
  const checks: Check[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push({
    name: 'node',
    ok: major >= 22,
    detail: process.versions.node,
    ...(major < 22 && { fix: 'install Node 22 or newer (mise use node@22)' }),
  });
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
