import { join } from 'node:path';
import {
  Adb,
  AndroidDevice,
  IosPhoneDevice,
  IosSimulatorDevice,
  Simctl,
  listPhones,
  stateDir,
  type Simulator,
} from 'appdyno';
import { checkApp, checkDevice, type Policy } from './policy.js';
import { Session, type DriveableDevice } from './session.js';
import { ToolError } from './tool.js';

/** A simulator is named by its id; anything else is an adb serial. */
const SIMULATOR_ID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
/** An iPhone's UDID. */
const PHONE_ID = /^[0-9A-F]{8}-[0-9A-F]{16}$|^[0-9a-f]{40}$/;

/** The server's devices: the sessions opened so far and which one tools act on by default. */
export class ServerContext {
  private readonly sessions = new Map<string, Session>();
  currentSerial: string | undefined;

  constructor(
    readonly policy: Policy,
    readonly adb: Pick<Adb, 'devices'> = new Adb(),
    private readonly defaults: { device?: string; app?: string; measurements?: string } = {},
    // a phone unplugged for a moment (or rebooting) is waited for, up to 30 s, on read-only calls
    private readonly makeDevice: (serial: string) => DriveableDevice = (serial) =>
      SIMULATOR_ID.test(serial)
        ? new IosSimulatorDevice(serial)
        : PHONE_ID.test(serial)
          ? new IosPhoneDevice(serial)
          : new AndroidDevice(serial, new Adb(), 30_000),
    /** Booted simulators (none when Xcode is missing). */
    readonly simulators: () => Promise<Simulator[]> = () =>
      new Simctl()
        .list()
        .then((l) => l.filter((d) => d.state === 'Booted'))
        .catch(() => []),
    /** iPhones connected by USB (UDIDs). */
    readonly phones: () => Promise<string[]> = () => listPhones().catch(() => []),
  ) {}

  /** Where measurements and their raw outputs are stored (this machine only). */
  get measurementsDir(): string {
    return this.defaults.measurements ?? join(stateDir(), 'measurements');
  }

  allowed(serial: string) {
    return !this.policy.devices || this.policy.devices.test(serial);
  }

  /** Opens `serial` (starting its agent) and makes it the default device. */
  async use(serial: string, app?: string): Promise<Session> {
    checkDevice(this.policy, serial);
    if (app) checkApp(this.policy, app);
    let s = this.sessions.get(serial);
    if (!s) {
      const device = this.makeDevice(serial);
      await device.open();
      s = new Session(device, app ?? this.defaults.app);
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
    const ready = (await this.adb.devices()).filter(
      (d) => d.state === 'device' && this.allowed(d.serial),
    );
    if (ready.length === 1) return this.use(ready[0]!.serial);
    throw new ToolError(
      ready.length === 0
        ? 'sürülebilecek bağlı cihaz yok (list_devices)'
        : 'birden çok cihaz var: use_device ile birini seç',
    );
  }

  close() {
    for (const s of this.sessions.values()) s.device.close();
  }
}
