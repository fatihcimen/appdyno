import { LIVE_FIELDS, type LiveField, type LiveSample } from '@appdyno/core';
import { DtxDouble, DtxInt, greeted, type DtxClient, type DtxMessage } from './dtx.js';
import type { IpStack, TcpConnection } from './ipstack.js';
import { isDict, type Archived } from './keyed-archive.js';
import type { ServiceList } from './services.js';

const HUB = 'com.apple.instruments.dtservicehub';
const SERVICES = 'com.apple.instruments.server.services.';
const DEVICE_INFO = 1;
const SYSMON = 2;
const GRAPHICS = 3;
const CHANNELS: [number, string][] = [
  [DEVICE_INFO, 'deviceinfo'],
  [SYSMON, 'sysmontap'],
  [GRAPHICS, 'graphics.opengl'],
];
const CAPABILITIES = {
  'com.apple.private.DTXBlockCompression': 0,
  'com.apple.private.DTXConnection': 1,
};
/** The order a sample's rows come in, as `setConfig:` asked. */
const ROW = ['pid', 'cpuUsage', 'physFootprint', 'threadCount'];
const SAMPLE_MS = 1_000;
const MEGABYTE = 1024 * 1024;
/** Seconds with no row for the app before it is looked for again: a sample lists only what changed. */
const SILENT_SAMPLES = 5;

export const NO_HUB = "the phone's developer disk image is not mounted";

/** What this source never has, with why, and what its frame rate means. */
const ALWAYS: Partial<Record<LiveField, string>> = {
  jankyFrames: 'an iPhone counts frames by the second here, not each late one',
  frozenFrames: 'an iPhone counts frames by the second here, not each late one',
  networkInKbps: "an iPhone's samples hold no network by app",
  networkOutKbps: "an iPhone's samples hold no network by app",
};
export const FPS_NOTE = 'the display, not the app: a mirror alone keeps it near 20';

export const sysmonConfig = () => ({
  ur: SAMPLE_MS,
  bm: 0,
  procAttrs: ROW,
  sysAttrs: ['vmFreeCount'],
  cpuUsage: true,
  physFootprint: true,
  sampleInterval: SAMPLE_MS * 1_000_000,
});

/** A sample with nothing in it but why. */
export function unreadable(why: string, app?: string): LiveSample {
  const absent = Object.fromEntries(LIVE_FIELDS.map((f) => [f, why]));
  return { at: Date.now(), ...(app && { app }), absent };
}

const number = (v: Archived | undefined) => (typeof v === 'number' ? v : undefined);

export type AppReading = { cpuPercent?: number; memoryMb?: number; threads?: number };

/** Of one message of the system monitor, one process's row, if the message holds it. */
export function rowOf(message: Archived, pid: number): AppReading | undefined {
  const parts = Array.isArray(message) ? message : [message];
  for (const part of parts) {
    const processes = isDict(part) ? part.Processes : undefined;
    const row = isDict(processes) ? processes[String(pid)] : undefined;
    if (!Array.isArray(row)) continue;
    const of = (name: string) => number(row[ROW.indexOf(name)]);
    const memory = of('physFootprint');
    return {
      ...(of('cpuUsage') !== undefined && { cpuPercent: of('cpuUsage')! }),
      ...(memory !== undefined && { memoryMb: memory / MEGABYTE }),
      ...(of('threadCount') !== undefined && { threads: of('threadCount')! }),
    };
  }
  return undefined;
}

/** A message of the system monitor is a sample if it holds processes: the first says only that it began. */
export const isSample = (message: Archived) =>
  (Array.isArray(message) ? message : [message]).some((p) => isDict(p) && 'Processes' in p);

export const framesOf = (message: Archived) =>
  isDict(message) ? number(message.CoreAnimationFramesPerSecond) : undefined;

export function pidOf(running: Archived, app: string): number | undefined {
  if (!Array.isArray(running)) return undefined;
  const hit = running.find((p) => isDict(p) && p.bundleIdentifier === app);
  return isDict(hit) ? number(hit.pid) : undefined;
}

/** A sample a second from the phone's instruments, while it is open: they cost the phone about 6 % of a core. */
export class LiveReader {
  private pid: number | undefined;
  private silent = 0;
  private frames: number | undefined;
  private reading: AppReading = {};
  private stopped = false;

  private constructor(
    private readonly connection: TcpConnection,
    private readonly dtx: DtxClient,
    private readonly app: string | undefined,
    private readonly onSample: (s: LiveSample) => void,
  ) {}

  static async open(
    stack: IpStack,
    services: ServiceList,
    app: string | undefined,
    onSample: (s: LiveSample) => void,
  ): Promise<LiveReader | null> {
    const port = services.ports[HUB];
    if (!port) return null;
    const connection = await stack.connect(port);
    const dtx = await greeted(connection, undefined, CAPABILITIES);
    const reader = new LiveReader(connection, dtx, app, onSample);
    await reader.start();
    return reader;
  }

  private async start() {
    this.connection.onClose(() => this.lost());
    this.dtx.onPush = (m) => this.onMessage(m);
    for (const [code, name] of CHANNELS) {
      await this.dtx.call('_requestChannelWithCode:identifier:', new DtxInt(code), SERVICES + name);
    }
    await this.findApp();
    this.dtx.tell('setConfig:', [sysmonConfig()], SYSMON);
    this.dtx.tell('start', [], SYSMON);
    await this.dtx.callOn(
      GRAPHICS,
      'startSamplingAtTimeInterval:',
      new DtxDouble(SAMPLE_MS / 1000),
    );
  }

  private async findApp() {
    if (!this.app) return;
    const running = await this.dtx.callOn(DEVICE_INFO, 'runningProcesses');
    this.pid = pidOf(running, this.app);
  }

  private onMessage(m: DtxMessage) {
    if (this.stopped) return;
    if (m.channel === -GRAPHICS) {
      this.frames = framesOf(m.selector) ?? this.frames;
      return;
    }
    if (m.channel !== -SYSMON || !isSample(m.selector)) return;
    const row = this.pid === undefined ? undefined : rowOf(m.selector, this.pid);
    this.silent = row ? 0 : this.silent + 1;
    this.reading = { ...this.reading, ...row };
    if (this.silent >= SILENT_SAMPLES) {
      this.silent = 0;
      void this.findApp().catch(() => undefined);
    }
    this.onSample(this.sample());
  }

  private sample(): LiveSample {
    const away = !this.app
      ? 'no app is chosen'
      : this.pid === undefined
        ? `${this.app} is not running`
        : undefined;
    const reading = away ? {} : this.reading;
    const absent: Partial<Record<LiveField, string>> = { ...ALWAYS, fps: FPS_NOTE };
    if (away) Object.assign(absent, { cpuPercent: away, memoryMb: away, threads: away });
    return {
      at: Date.now(),
      ...(this.app && { app: this.app }),
      ...(this.frames !== undefined && { fps: this.frames }),
      ...reading,
      absent,
    };
  }

  /** Says so once if the phone goes, and tells it to stop if not. Safe twice. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.dtx.tell('stop', [], SYSMON);
    this.dtx.tell('stopSampling', [], GRAPHICS);
    this.connection.close();
  }

  private lost() {
    if (this.stopped) return;
    this.stopped = true;
    this.onSample(unreadable('the phone went away', this.app));
  }
}
