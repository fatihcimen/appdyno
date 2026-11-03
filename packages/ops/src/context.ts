import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  reportProgress,
  stateDir,
  type Device,
  type DeviceProvider,
  type ScreenElement,
} from '@appdyno/core';
import { claim, holder, release } from './claims.js';
import { restoreConditions } from './control.js';
import { endCapture } from './network.js';
import { checkApp, checkDevice, type Policy } from './policy.js';
import { endRecording } from './record.js';
import { reportFor } from './report.js';
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

  /** Its own copy: a replay's secrets join the list for as long as it runs. */
  readonly policy: Policy;

  constructor(
    policy: Policy,
    /** Listed in this order; of those that handle a serial, the last one opens it. */
    readonly providers: DeviceProvider[],
    private readonly defaults: {
      device?: string;
      app?: string;
      measurements?: string;
      /** The project's baselines and budgets. */
      perf?: string;
      /** A file to keep the selection and the diff baseline in between processes (the command line). */
      remember?: string;
      /** Hold a device for the session, refusing one another live process holds (`owner`: this tool, as it is shown). */
      claims?: boolean;
      owner?: string;
      /** Use a device another process holds. */
      share?: boolean;
    } = {},
  ) {
    this.policy = { ...policy, secrets: [...policy.secrets] };
    this.saved = defaults.remember ? recall(defaults.remember) : undefined;
  }

  /** These texts are not shown back until the returned function is called. */
  hide(values: string[]) {
    const added = values.filter((v) => !this.policy.secrets.includes(v));
    this.policy.secrets.push(...added);
    return () => {
      for (const v of added) this.policy.secrets.splice(this.policy.secrets.indexOf(v), 1);
    };
  }

  private readonly saved: Saved | undefined;

  /** Where measurements and their raw outputs are stored (this machine only). */
  get measurementsDir(): string {
    return this.defaults.measurements ?? join(stateDir(), 'measurements');
  }

  /** Baselines and budgets, under the project (committable). */
  get perfDir(): string {
    return (
      this.defaults.perf ?? process.env.APPDYNO_PERF_DIR ?? join(process.cwd(), '.appdyno/perf')
    );
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
  async use(serial: string, app?: string, share = false): Promise<Session> {
    checkDevice(this.policy, serial);
    if (app) checkApp(this.policy, app);
    let s = this.sessions.get(serial);
    if (!s) {
      const saved = this.saved?.serial === serial ? this.saved : undefined;
      const holds = this.defaults.claims && !share && !this.defaults.share;
      if (holds) claim(serial, this.defaults.owner ?? 'appdyno');
      s = new Session(
        await this.open(serial).catch((e: unknown) => {
          if (holds) release(serial);
          return refused(e);
        }),
        app ?? this.defaults.app ?? saved?.app,
      );
      s.shown = saved?.shown;
      s.lastActionAt = saved?.lastActionAt;
      this.sessions.set(serial, s);
      // a holder that died left its changes behind; a command line's stay until asked
      if (holds && !this.defaults.remember && s.device.settings)
        this.leftovers.set(serial, await restoreConditions(s));
    } else if (app) s.appId = app;
    this.currentSerial = serial;
    return s;
  }

  /** What the start of a session put back or could not, by device. */
  readonly leftovers = new Map<string, { restored: string[]; failed: string[] }>();

  /** Who holds a device, when this server keeps to claims. */
  heldBy(serial: string) {
    return this.defaults.claims ? holder(serial) : undefined;
  }

  /** The end of a session: conditions it changed go back (a command line's stay until asked). */
  async end(): Promise<string[]> {
    if (this.defaults.remember) return [];
    const failed: string[] = [];
    for (const s of this.sessions.values()) {
      await endRecording(s).catch((e: Error) => failed.push(`recording: ${e.message}`));
      await endCapture(s).catch((e: Error) => failed.push(`network: ${e.message}`));
      await reportFor(this)
        .close(s)
        .catch((e: Error) => failed.push(`report: ${e.message}`));
      if (s.device.settings) failed.push(...(await restoreConditions(s)).failed);
    }
    return failed;
  }

  /** Its device is going away: the agent stops first, as a runner left alive would boot a simulator again. */
  async forget(serial: string) {
    const s = this.sessions.get(serial);
    if (!s) return;
    await s.device.stopAgent().catch(() => undefined);
    s.device.close();
    this.sessions.delete(serial);
    if (this.defaults.claims) release(serial);
    if (this.currentSerial === serial) this.currentSerial = undefined;
  }

  /** The session of `serial`, else the default device (the configured one, or the only allowed one). */
  async session(serial?: string): Promise<Session> {
    if (serial) return this.sessions.get(serial) ?? this.use(serial);
    if (this.currentSerial) return this.sessions.get(this.currentSerial)!;
    const named = this.defaults.device ?? this.saved?.serial;
    if (named) return this.use(named);
    const ready = (await this.devices().catch(refused)).filter(
      (d) => d.ready && this.allowed(d.serial),
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
    if (this.defaults.claims) for (const serial of this.sessions.keys()) release(serial);
  }
}
