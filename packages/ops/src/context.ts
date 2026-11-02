import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  reportProgress,
  stateDir,
  type Device,
  type DeviceProvider,
  type ScreenElement,
} from '@appdyno/core';
import { checkApp, checkDevice, type Policy } from './policy.js';
import { refused, Session } from './session.js';
import { ToolError } from './tool.js';

type Saved = {
  serial: string;
  app?: string;
  shown?: ScreenElement[];
  lastActionAt?: number;
};

function recall(file: string): Saved | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Saved;
  } catch {
    return undefined;
  }
}

/** The server's devices: the sessions opened so far and which one tools act on by default. */
export class ServerContext {
  private readonly sessions = new Map<string, Session>();
  currentSerial: string | undefined;

  constructor(
    readonly policy: Policy,
    /** Listed in this order; of those that handle a serial, the last one opens it. */
    readonly providers: DeviceProvider[],
    private readonly defaults: {
      device?: string;
      app?: string;
      measurements?: string;
      /** A file to keep the selection and the diff baseline in between processes (the command line). */
      remember?: string;
    } = {},
  ) {
    this.saved = defaults.remember ? recall(defaults.remember) : undefined;
  }

  private readonly saved: Saved | undefined;

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
    if (!provider) throw new ToolError(`no driver takes the device ${serial}`, 'NOT_FOUND');
    reportProgress(`connecting to ${serial}`);
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
      const saved = this.saved?.serial === serial ? this.saved : undefined;
      s = new Session(
        await this.open(serial).catch(refused),
        app ?? this.defaults.app ?? saved?.app,
      );
      s.shown = saved?.shown;
      s.lastActionAt = saved?.lastActionAt;
      this.sessions.set(serial, s);
    } else if (app) s.appId = app;
    this.currentSerial = serial;
    return s;
  }

  /** The session of `serial`, else the default device (the configured one, or the only allowed one). */
  async session(serial?: string): Promise<Session> {
    if (serial) return this.sessions.get(serial) ?? this.use(serial);
    if (this.currentSerial) return this.sessions.get(this.currentSerial)!;
    const named = this.defaults.device ?? this.saved?.serial;
    if (named) return this.use(named);
    const ready = (await this.devices().catch(refused)).filter(
      (d) => d.state === 'device' && this.allowed(d.serial),
    );
    if (ready.length === 1) return this.use(ready[0]!.serial);
    throw new ToolError(
      ready.length === 0
        ? 'no connected device this server may drive (list_devices)'
        : 'more than one device: pick one with use_device',
      ready.length === 0 ? 'DEVICE_GONE' : 'INVALID_ARGUMENT',
    );
  }

  close() {
    const s = this.currentSerial ? this.sessions.get(this.currentSerial) : undefined;
    if (s && this.defaults.remember) {
      const saved: Saved = {
        serial: s.device.serial,
        ...(s.appId && { app: s.appId }),
        ...(s.shown && { shown: s.shown }),
        ...(s.lastActionAt && { lastActionAt: s.lastActionAt }),
      };
      mkdirSync(dirname(this.defaults.remember), { recursive: true, mode: 0o700 });
      writeFileSync(this.defaults.remember, JSON.stringify(saved), { mode: 0o600 });
    }
    for (const x of this.sessions.values()) x.device.close();
  }
}
