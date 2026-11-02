import { join } from 'node:path';
import { stateDir, type Device, type DeviceProvider } from '@appdyno/core';
import { checkApp, checkDevice, type Policy } from './policy.js';
import { refused, Session } from './session.js';
import { ToolError } from './tool.js';

/** The server's devices: the sessions opened so far and which one tools act on by default. */
export class ServerContext {
  private readonly sessions = new Map<string, Session>();
  currentSerial: string | undefined;

  constructor(
    readonly policy: Policy,
    /** Listed in this order; of those that handle a serial, the last one opens it. */
    readonly providers: DeviceProvider[],
    private readonly defaults: { device?: string; app?: string; measurements?: string } = {},
  ) {}

  /** Where measurements and their raw outputs are stored (this machine only). */
  get measurementsDir(): string {
    return this.defaults.measurements ?? join(stateDir(), 'measurements');
  }

  allowed(serial: string) {
    return !this.policy.devices || this.policy.devices.test(serial);
  }

  /** The devices of every provider. */
  async devices() {
    return (await Promise.all(this.providers.map((p) => p.list()))).flat();
  }

  private async open(serial: string): Promise<Device> {
    const provider = this.providers.findLast((p) => p.handles(serial));
    if (!provider) throw new ToolError(`no driver takes the device ${serial}`);
    const device = provider.open(serial);
    await device.open();
    return device;
  }

  /** Opens `serial` (starting its agent) and makes it the default device. */
  async use(serial: string, app?: string): Promise<Session> {
    checkDevice(this.policy, serial);
    if (app) checkApp(this.policy, app);
    let s = this.sessions.get(serial);
    if (!s) {
      s = new Session(await this.open(serial).catch(refused), app ?? this.defaults.app);
      this.sessions.set(serial, s);
    } else if (app) s.appId = app;
    this.currentSerial = serial;
    return s;
  }

  /** The session of `serial`, else the default device (the configured one, or the only allowed one). */
  async session(serial?: string): Promise<Session> {
    if (serial) return this.sessions.get(serial) ?? this.use(serial);
    if (this.currentSerial) return this.sessions.get(this.currentSerial)!;
    if (this.defaults.device) return this.use(this.defaults.device);
    const ready = (await this.devices().catch(refused)).filter(
      (d) => d.state === 'device' && this.allowed(d.serial),
    );
    if (ready.length === 1) return this.use(ready[0]!.serial);
    throw new ToolError(
      ready.length === 0
        ? 'no connected device this server may drive (list_devices)'
        : 'more than one device: pick one with use_device',
    );
  }

  close() {
    for (const s of this.sessions.values()) s.device.close();
  }
}
