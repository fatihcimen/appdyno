import { join } from 'node:path';
import {
  DeviceQueue,
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
import { endSession, leftHere, sweep, type Taken } from './leftovers.js';
import { inputGuard } from './apps-guard.js';
import { byPerson, checkApp, checkLaunch, type Policy } from './policy.js';
import { Session } from './session.js';
import { refused, ToolError } from './tool.js';

/** How a person is reached, and what a client is called to one. */
type Person = {
  /** A server run --silent: a request for a person sounds nowhere, in a window or out of one. */
  silent?: boolean;
  /** Reaches a person when there is no window to show a request in. */
  alertPerson?: (reason: string) => void;
  /** What a person calls the client that named itself this. */
  clientNamed?: (said: string) => string;
};

/** Where measures, baselines and a command line's state are kept, and what traces may take. */
type Storage = {
  /** Where measurements and their raw outputs are stored (this machine only). */
  measurements?: string;
  /** The project's baselines and budgets. */
  perf?: string;
  /** What traces and heap dumps may take on this Mac, in GB: `--trace-limit-gb`, `APPDYNO_TRACE_LIMIT_GB`. */
  traceLimitGb?: number;
  /** Only a user's own entry point sets this: a kept run looks at what traces take. */
  autoPrune?: boolean;
  /** A file to keep the selection and the diff baseline in between processes (the command line). */
  remember?: string;
};

/** Holding a device for the session, refusing one another live process holds. */
type Claims = {
  /** Use a device another process holds. */
  share: boolean;
};

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
  /** This client's calls that act, one at a time: two sent at once both aimed at the screen before either. */
  readonly acting = new DeviceQueue();

  /** Its own copy: a replay's secrets join the list for as long as it runs. */
  readonly policy: Policy;

  readonly person: Person;

  constructor(
    policy: Policy,
    /** Listed in this order; of those that handle a serial, the last one opens it. */
    readonly providers: DeviceProvider[],
    readonly options: {
      device?: string;
      app?: string;
      storage?: Storage;
      /** What a flight recorder keeps, from a person's own flag: an agent is not the one to ask for more of a screen. */
      flightSeconds?: number;
      /** Whole URLs in a timeline, query and all, from a person's own flag: it is a file that gets sent to people. */
      fullUrls?: boolean;
      claims?: Claims;
      /** This process as a holder and as the owner of what a session leaves, as it is shown. */
      tool?: string;
      /** How to run this tool again, for a window that outlives the call that opened it. */
      mirrorCommand?: string[];
      person?: Person;
      /**
       * Where a flow's names find a value no param and no env file gives: a person's own command line's environment. A
       * server has none, as its own environment is no flow's to type.
       */
      env?: Record<string, string | undefined>;
    } = {},
  ) {
    this.policy = { ...policy, secrets: [...policy.secrets] };
    this.person = options.person ?? {};
    const remember = options.storage?.remember;
    this.saved = remember ? readState(remember, Saved) : undefined;
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

  /** What traces and heap dumps may take on this Mac, in GB. */
  get traceLimitGb(): number {
    return this.options.storage?.traceLimitGb ?? DEFAULT_TRACE_LIMIT_GB;
  }

  /** Where measurements and their raw outputs are stored (this machine only), read when asked as the state folder is. */
  get measurementsDir(): string {
    return this.options.storage?.measurements ?? join(stateDir(), 'measurements');
  }

  /** Baselines and budgets, under the project (committable). */
  get perfDir(): string {
    return (
      this.options.storage?.perf ??
      process.env.APPDYNO_PERF_DIR ??
      join(process.cwd(), '.appdyno/perf')
    );
  }

  allowed(serial: string) {
    return !this.policy.devices || this.policy.devices.test(serial) || this.allowedAs.has(serial);
  }

  /** Devices the allow list names by another name than their serial: a simulator's or an AVD's, or a model. */
  private readonly allowedAs = new Set<string>();

  /** A device the allow list lets in by one of its names, which its serial is then let in as. */
  allowAs(serial: string) {
    this.allowedAs.add(serial);
  }

  /** The one check of the allow list: a device let in by another of its names passes by its serial. */
  checkDevice(serial: string) {
    if (!this.allowed(serial))
      throw new ToolError(
        `${serial} is not allowed on this server`,
        'POLICY_DENIED',
        byPerson('by --allow-devices'),
      );
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
   * server's first read and 200 of its first touch, and its runner seconds of what needs it. A device this server may not
   * drive is left for its call to refuse.
   */
  warm(serial: string) {
    if (this.sessions.has(serial) || this.warmed.has(serial) || !this.allowed(serial)) return;
    // what another process holds, its runner with it, is left to it until a call here says otherwise
    const other = this.heldBy(serial);
    if (other && other.pid !== process.pid) return;
    try {
      const device = this.deviceFor(serial);
      this.warmed.set(serial, device);
      device.warm?.(this.options.app ?? this.saved?.app);
    } catch {
      // no driver takes it: its first call says so
    }
  }

  private async open(serial: string, launching: string | undefined, app?: string): Promise<Device> {
    const device = this.warmed.get(serial) ?? this.deviceFor(serial);
    this.warmed.delete(serial);
    device.warm?.(app);
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

  /**
   * The session a launch runs on; when it is the first call, the app starts alongside the agent. A launch in a
   * `language` starts the app itself: what began alongside would be left for the next launch, which took it for its
   * own and started nothing.
   */
  sessionToLaunch(app: string | undefined, language?: string) {
    const wanted = app ?? this.options.app ?? this.saved?.app;
    return this.session(
      undefined,
      language ? undefined : wanted && checkLaunch(this.policy, checkApp(this.policy, wanted)),
    );
  }

  /**
   * Opens `serial` (starting its agent) and makes it the default device. `launching`: the app a first call
   * goes on to launch.
   */
  async use(serial: string, app?: string, share = false, launching?: string): Promise<Session> {
    this.checkDevice(serial);
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
    if (app) s.select(app);
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
    const holds = this.options.claims && !share && !this.options.claims.share;
    const tool = this.options.tool ?? 'appdyno';
    if (holds) await claim(serial, tool);
    const owner = this.options.storage?.remember ? undefined : thisOwner(tool);
    const s = new Session(
      // a replay, a test run and a survey ask for a session outside any op
      await this.open(serial, launching, app ?? this.options.app ?? saved?.app).catch(
        (e: unknown) => {
          if (holds) release(serial);
          return refused(e);
        },
      ),
      app ?? this.options.app ?? saved?.app,
      owner,
      inputGuard(this.policy),
    );
    if (saved) s.carryOver(saved);
    this.sessions.set(serial, s);
    if (owner) this.leftovers.set(serial, await sweep(this, s));
    return s;
  }

  /** What the start of a session put back or could not, by device. */
  readonly leftovers = new Map<string, Taken>();

  /** Who holds a device, when this server keeps to claims. */
  heldBy(serial: string) {
    return this.options.claims ? holder(serial) : undefined;
  }

  /**
   * The end of a session: conditions it changed go back (a command line's stay until asked). Of the devices in
   * `handedOff`, another process puts back what is kept on disk once this one has gone.
   */
  async end(handedOff: string[] = []): Promise<string[]> {
    if (this.options.storage?.remember) return [];
    const failed: string[] = [];
    for (const [serial, s] of this.sessions)
      failed.push(...(await endSession(this, s, handedOff.includes(serial))).failed);
    return failed;
  }

  /** The devices on which this process left what outlives it, as a session's end would put back. */
  leftBehind(): string[] {
    if (this.options.storage?.remember) return [];
    return [...this.sessions].flatMap(([serial, s]) => (leftHere(s) ? [serial] : []));
  }

  /**
   * Its device is going away: what its session changed goes back while the device still answers, as at the session's
   * end, and its agent stops, as a runner left alive would boot a simulator again. What went back, or could not.
   */
  async forget(serial: string): Promise<Taken | undefined> {
    this.warmed.get(serial)?.close();
    this.warmed.delete(serial);
    const s = this.sessions.get(serial);
    if (!s) return undefined;
    const taken = this.options.storage?.remember ? undefined : await endSession(this, s);
    await s.device.stopAgent().catch(() => undefined);
    s.device.close();
    this.sessions.delete(serial);
    if (this.options.claims) release(serial);
    if (this.currentSerial === serial) this.currentSerial = undefined;
    return taken;
  }

  /** The device in use or named, known with nothing opened. */
  get selected(): string | undefined {
    return this.currentSerial ?? this.options.device ?? this.saved?.serial;
  }

  /** A device's driver object, cold: nothing on the device has started. */
  deviceFor(serial: string): Device {
    this.checkDevice(serial);
    const provider = this.providers.findLast((p) => p.handles(serial));
    if (!provider)
      throw new ToolError(
        `no driver takes the device ${serial}`,
        'NOT_FOUND',
        'list_devices names the devices',
      );
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
        'simulator action list names the simulators and emulators it can start, and boot starts one; a phone is joined by its cable',
      );
    throw new ToolError(
      `more than one device this server may drive: ${ready.map((d) => `${d.serial} (${[kindOf(d), d.model].filter(Boolean).join(', ')})`).join('; ')}`,
      'INVALID_ARGUMENT',
      `pick one with use_device: ${ready.map((d) => `device "${d.serial}"`).join(' or ')}`,
    );
  }

  /** The session tools act on by default, where one is open: nothing is opened to tell. */
  get openSession(): Session | undefined {
    return this.currentSerial ? this.sessions.get(this.currentSerial) : undefined;
  }

  close() {
    const s = this.openSession;
    const remember = this.options.storage?.remember;
    if (s && remember) {
      writeState(remember, {
        serial: s.device.serial,
        ...(s.appId && { app: s.appId }),
        ...(s.shown && { shown: s.shown }),
        ...(s.lastActionAt && { lastActionAt: s.lastActionAt }),
      });
    }
    for (const x of this.sessions.values()) x.device.close();
    for (const device of this.warmed.values()) device.close();
    if (this.options.claims) for (const serial of this.sessions.keys()) release(serial);
  }
}
