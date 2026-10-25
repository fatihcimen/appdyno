import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DeviceError } from '@appdyno/protocol';

const run = promisify(execFile);

const UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
export const assertUdid = (u: string) => {
  if (!UDID.test(u)) throw new DeviceError('INVALID_ARGUMENT', `not a simulator id: ${u}`);
  return u;
};

const BUNDLE = /^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$/;
export const assertBundle = (b: string) => {
  if (!BUNDLE.test(b)) throw new DeviceError('INVALID_ARGUMENT', `not a bundle id: ${b}`);
  return b;
};

export type Simulator = {
  udid: string;
  name: string;
  state: string;
  runtime: string;
  deviceType?: string;
};

/** The simulator tool, always for one named simulator (never "booted": other simulators may run). */
export class Simctl {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async exec(args: string[], timeoutMs = 60_000): Promise<string> {
    try {
      const { stdout } = await run('xcrun', ['simctl', ...args], {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        env: this.env,
      });
      return stdout;
    } catch (e) {
      const err = e as { stderr?: string; message: string; killed?: boolean };
      if (err.killed)
        throw new DeviceError('TIMEOUT', `simctl ${args[0]} took over ${timeoutMs} ms`);
      const msg = (err.stderr || err.message).trim().split('\n').slice(-2).join(' ').slice(0, 300);
      throw new DeviceError(
        /Invalid device|not found/i.test(msg) ? 'NOT_FOUND' : 'INTERNAL',
        `simctl ${args[0]}: ${msg}`,
      );
    }
  }

  async list(): Promise<Simulator[]> {
    const j = JSON.parse(await this.exec(['list', '-j', 'devices'])) as {
      devices: Record<
        string,
        {
          udid: string;
          name: string;
          state: string;
          deviceTypeIdentifier?: string;
          isAvailable?: boolean;
        }[]
      >;
    };
    return Object.entries(j.devices).flatMap(([runtime, ds]) =>
      ds
        .filter((d) => d.isAvailable !== false)
        .map((d) => ({
          udid: d.udid,
          name: d.name,
          state: d.state,
          runtime,
          ...(d.deviceTypeIdentifier && { deviceType: d.deviceTypeIdentifier }),
        })),
    );
  }

  async state(udid: string): Promise<string | undefined> {
    return (await this.list()).find((d) => d.udid === assertUdid(udid))?.state;
  }

  /** Boots and waits until the simulator has finished booting. */
  async boot(udid: string) {
    if ((await this.state(udid)) !== 'Booted') await this.exec(['boot', assertUdid(udid)], 120_000);
    await this.exec(['bootstatus', udid, '-b'], 300_000);
  }

  async shutdown(udid: string) {
    if ((await this.state(udid)) === 'Booted')
      await this.exec(['shutdown', assertUdid(udid)], 120_000);
  }

  install(udid: string, appPath: string) {
    return this.exec(['install', assertUdid(udid), appPath], 300_000);
  }
  launch(udid: string, bundle: string) {
    return this.exec(
      ['launch', '--terminate-running-process', assertUdid(udid), assertBundle(bundle)],
      60_000,
    );
  }
  async terminate(udid: string, bundle: string) {
    await this.exec(['terminate', assertUdid(udid), assertBundle(bundle)], 60_000).catch(
      (e: unknown) => {
        // not running is not an error
        if (!(
          e instanceof DeviceError && /found nothing to terminate|not running/i.test(e.message)
        ))
          throw e;
      },
    );
  }
  openUrl(udid: string, url: string) {
    return this.exec(['openurl', assertUdid(udid), url], 60_000);
  }
  setLocation(udid: string, lat: number, lon: number) {
    return this.exec(['location', assertUdid(udid), 'set', `${lat},${lon}`]);
  }
  /** grant, revoke or reset a privacy service (location, photos, …) for an app. */
  privacy(udid: string, action: 'grant' | 'revoke' | 'reset', service: string, bundle: string) {
    return this.exec(['privacy', assertUdid(udid), action, service, assertBundle(bundle)]);
  }
  async appContainer(udid: string, bundle: string): Promise<string> {
    return (await this.exec(['get_app_container', assertUdid(udid), assertBundle(bundle)])).trim();
  }
}
