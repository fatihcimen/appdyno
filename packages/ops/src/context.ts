import { join } from 'node:path';
import {
  kindOf,
  must,
  readState,
  reportProgress,
  stateDir,
  thisOwner,
  writeState,
  NEEDS,
  type Device,
  type DeviceProvider,
  type ScreenElement,
} from '@appdyno/core';
import { DEFAULT_TRACE_LIMIT_GB } from '@appdyno/perf';
import { z } from 'zod';
import { claim, holder, release } from './claims.js';
import { endSession, sweep, type Taken } from './leftovers.js';
import { checkApp, checkDevice, type Policy } from './policy.js';
import { Session } from './session.js';
import { refused, ToolError } from './tool.js';

const Saved = z.object({
  serial: z.string(),
  app: z.string().optional(),
  shown: z.array(z.custom<ScreenElement>()).optional(),
  lastActionAt: z.number().optional(),
});

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
      traceLimitGb?: number;
      /** What a flight recorder keeps, from a person's own flag: an agent is not the one to ask for more of a screen. */
      flightSeconds?: number;
      /** Whole URLs in a timeline, query and all, from a person's own flag: it is a file that gets sent to people. */
      fullUrls?: boolean;
      autoPrune?: boolean;
      /** The project's baselines and budgets. */
      perf?: string;
      /** A file to keep the selection and the diff baseline in between processes (the command line). */
      remember?: string;
      /** Hold a device for the session, refusing one another live process holds (`tool`: this one, as it is shown). */
      claims?: boolean;
      tool?: string;
      /** Use a device another process holds. */
      share?: boolean;
      /** How to run this tool again, for a window that outlives the call that opened it. */
      mirrorCommand?: string[];
      /** A server run --silent: a request for a person sounds nowhere, in a window or out of one. */
      silent?: boolean;
      /** Reaches a person when there is no window to show a request in. */
      alertPerson?: (reason: string) => void;
      /** What a person calls the client that named itself this. */
      clientNamed?: (said: string) => string;
    } = {},
  ) {
    this.policy = { ...policy, secrets: [...policy.secrets] };
    this.saved = defaults.remember ? readState(defaults.remember, Saved) : undefined;
  }

  /** These texts are not shown back until the returned function is called. */
  hide(values: string[]) {
    const added = values.filter((v) => !this.policy.secrets.includes(v));
    this.policy.secrets.push(...added);
    return () => {
      for (const v of added) this.policy.secrets.splice(this.policy.secrets.indexOf(v), 1);
    };
  }

  private readonly saved: z.infer<typeof Saved> | undefined;

  /** Where measurements and their raw outputs are stored (this machine only). */
  /** What traces and heap dumps may take on this Mac, in GB: `--trace-limit-gb`, `APPDYNO_TRACE_LIMIT_GB`. */
  get traceLimitGb(): number {
    return this.defaults.traceLimitGb ?? DEFAULT_TRACE_LIMIT_GB;
  }

  get flightSeconds(): number | undefined {
    return this.defaults.flightSeconds;
  }

  get fullUrls(): boolean {
    return this.defaults.fullUrls === true;
  }

  /** Only a user's own entry point sets this: a kept run looks at what traces take. */
  get autoPrune(): boolean {
    return this.defaults.autoPrune === true;
  }

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

  /** What stands in the way of driving a listed device, and its fix; a read that fails says nothing. */
  async blockOf(d: { serial: string; state: string }) {
    const provider = this.providers.findLast((p) => p.handles(d.serial));
    const need = await provider?.need?.(d).catch(() => undefined);
    return need && { need, ...NEEDS[need] };
  }

  /** Driver objects warmed before their session opened: it takes the same one. */
  private readonly warmed = new Map<string, Device>();

  /**
   * What a first call on a selected device needs, started in the background: a simulator's helpers took about 400 ms of a
   * server's first read and 200 of its first touch. A device this server may not drive is left for its call to refuse.
   */
  warm(serial: string) {
    if (this.sessions.has(serial) || this.warmed.has(serial) || !this.allowed(serial)) return;
    try {
      const device = this.deviceFor(serial);
      this.warmed.set(serial, device);
      device.warm?.();
    } catch {
      // no driver takes it: its first call says so
    }
  }

  private async open(serial: string, launching: string | undefined): Promise<Device> {
    const device = this.warmed.get(serial) ?? this.deviceFor(serial);
    this.warmed.delete(serial);
    device.warm?.();
    reportProgress(`connecting to ${serial}`);
    if (launching) {
      // the launch alongside would hide whether the app ran before it, which the launch's answer says
      this.firstLaunch = {
        serial,
        app: launching,
        ran: await device.appRunning(launching).catch(() => undefined),
      };
      device.launchAlongside(launching);
    }
    await device.open();
    return device;
  }

  /** Whether the app of a first call's launch ran before that launch began alongside its device's start. */
  private firstLaunch: { serial: string; app: string; ran: boolean | undefined } | undefined;

  /** Whether `app` runs before a launch of it, asked before the launch that began alongside a start; unknown: undefined. */
  ranBeforeLaunch(s: Session, app: string): Promise<boolean | undefined> {
    const first = this.firstLaunch;
    this.firstLaunch = undefined;
    if (first?.serial === s.device.serial && first.app === app) return Promise.resolve(first.ran);
    return s.device.appRunning(app).catch(() => undefined);
  }

  /** The session a launch runs on; when it is the first call, the app starts alongside the agent. */
  sessionToLaunch(app: string | undefined) {
    const wanted = app ?? this.defaults.app ?? this.saved?.app;
    return this.session(undefined, wanted && checkApp(this.policy, wanted));
  }

  /**
   * Opens `serial` (starting its agent) and makes it the default device. `launching`: the app a first call
   * goes on to launch.
   */
  async use(serial: string, app?: string, share = false, launching?: string): Promise<Session> {
    checkDevice(this.policy, serial);
    if (app) checkApp(this.policy, app);
    let s = this.sessions.get(serial);
    if (!s) {
      // calls come in parallel: the first opens the device, the others wait for it
      const start =
        this.opening.get(serial) ??
        this.start(serial, app, share, launching).finally(() => this.opening.delete(serial));
      this.opening.set(serial, start);
      s = await start;
    }
    if (app) s.appId = app;
    this.currentSerial = serial;
    return s;
  }

  private readonly opening = new Map<string, Promise<Session>>();

  private async start(
    serial: string,
    app: string | undefined,
    share: boolean,
    launching: string | undefined,
  ) {
    const saved = this.saved?.serial === serial ? this.saved : undefined;
    const holds = this.defaults.claims && !share && !this.defaults.share;
    const tool = this.defaults.tool ?? 'appdyno';
    if (holds) claim(serial, tool);
    const owner = this.defaults.remember ? undefined : thisOwner(tool);
    const s = new Session(
      // a replay, a test run and a survey ask for a session outside any op
      await this.open(serial, launching).catch((e: unknown) => {
        if (holds) release(serial);
        return refused(e);
      }),
      app ?? this.defaults.app ?? saved?.app,
      owner,
    );
    s.shown = saved?.shown;
    s.lastActionAt = saved?.lastActionAt;
    this.sessions.set(serial, s);
    if (owner) this.leftovers.set(serial, await sweep(this, s));
    return s;
  }

  /** What the start of a session put back or could not, by device. */
  readonly leftovers = new Map<string, Taken>();

  /** Who holds a device, when this server keeps to claims. */
  heldBy(serial: string) {
    return this.defaults.claims ? holder(serial) : undefined;
  }

  /** The end of a session: conditions it changed go back (a command line's stay until asked). */
  async end(): Promise<string[]> {
    if (this.defaults.remember) return [];
    const failed: string[] = [];
    for (const s of this.sessions.values()) failed.push(...(await endSession(this, s)).failed);
    return failed;
  }

  /** Its device is going away: the agent stops first, as a runner left alive would boot a simulator again. */
  async forget(serial: string) {
    this.warmed.get(serial)?.close();
    this.warmed.delete(serial);
    const s = this.sessions.get(serial);
    if (!s) return;
    await s.device.stopAgent().catch(() => undefined);
    s.device.close();
    this.sessions.delete(serial);
    if (this.defaults.claims) release(serial);
    if (this.currentSerial === serial) this.currentSerial = undefined;
  }

  /** The device in use or named, known with nothing opened. */
  get selected(): string | undefined {
    return this.currentSerial ?? this.defaults.device ?? this.saved?.serial;
  }

  get mirrorCommand() {
    return this.defaults.mirrorCommand;
  }

  clientNamed(said: string) {
    return this.defaults.clientNamed?.(said) ?? said;
  }

  get silent() {
    return this.defaults.silent === true;
  }

  get alertPerson() {
    return this.defaults.alertPerson;
  }

  /** A device's driver object, cold: nothing on the device has started. */
  deviceFor(serial: string): Device {
    checkDevice(this.policy, serial);
    const provider = this.providers.findLast((p) => p.handles(serial));
    if (!provider) throw new ToolError(`no driver takes the device ${serial}`, 'NOT_FOUND');
    return provider.open(serial);
  }

  /** The session of `serial`, else the default device (the configured one, or the only allowed one). */
  async session(serial?: string, launching?: string): Promise<Session> {
    if (serial) return this.sessions.get(serial) ?? this.use(serial, undefined, false, launching);
    if (this.currentSerial)
      return must(this.sessions.get(this.currentSerial), 'the selected session');
    return this.use(await this.defaultSerial(), undefined, false, launching);
  }

  /** The device a call means when it names none. Opens nothing. */
  async defaultSerial(): Promise<string> {
    if (this.selected) return this.selected;
    const ready = (await this.devices().catch(refused)).filter(
      (d) => d.ready && this.allowed(d.serial),
    );
    const [only, other] = ready;
    if (only && !other) return only.serial;
    if (!only)
      throw new ToolError(
        'no connected device this server may drive (list_devices)',
        'DEVICE_GONE',
      );
    throw new ToolError(
      `more than one device this server may drive: ${ready.map((d) => `${d.serial} (${[kindOf(d), d.model].filter(Boolean).join(', ')})`).join('; ')}`,
      'INVALID_ARGUMENT',
      `pick one with use_device: ${ready.map((d) => `device "${d.serial}"`).join(' or ')}`,
    );
  }

  close() {
    const s = this.currentSerial ? this.sessions.get(this.currentSerial) : undefined;
    if (s && this.defaults.remember) {
      writeState(this.defaults.remember, {
        serial: s.device.serial,
        ...(s.appId && { app: s.appId }),
        ...(s.shown && { shown: s.shown }),
        ...(s.lastActionAt && { lastActionAt: s.lastActionAt }),
      });
    }
    for (const x of this.sessions.values()) x.device.close();
    for (const device of this.warmed.values()) device.close();
    if (this.defaults.claims) for (const serial of this.sessions.keys()) release(serial);
  }
}
