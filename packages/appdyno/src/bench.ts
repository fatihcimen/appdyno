import { execFile } from 'node:child_process';
import { freemem, loadavg, totalmem } from 'node:os';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { buildScreen } from '@appdyno/core';
import { Adb, AndroidDevice } from '@appdyno/driver-android';

const run = promisify(execFile);

/** An element a benchmark looks up: its label or id, and its centre in tap units. */
export type BenchElement = { label: string; id?: string; x: number; y: number };

/**
 * What a benchmark needs of a device driver. Each call is one measured operation; `tapAndRead` is an
 * action followed by that driver's own way of waiting for the screen and reading it.
 */
export interface BenchDriver {
  readonly name: string;
  setup(): Promise<void>;
  teardown(): Promise<void>;
  read(): Promise<BenchElement[]>;
  tap(p: { x: number; y: number }): Promise<void>;
  tapAndRead(p: { x: number; y: number }): Promise<{ reads?: number; settled?: boolean }>;
  /** Replaces the text of the field at `p`; `verified` when the driver read it back. */
  typeText(p: { x: number; y: number }, text: string): Promise<{ verified?: boolean }>;
  screenshot(): Promise<{ bytes: number }>;
  /** Stops the driver's on-device server and measures the next read from nothing. */
  coldRead?(): Promise<void>;
  /** A new client connection to the running on-device server (one round trip). */
  reconnect?(): Promise<void>;
}

/** This project's driver: the host library and the on-device agent. */
export function appdynoDriver(serial: string, adb = new Adb()): BenchDriver {
  let d = new AndroidDevice(serial, adb);
  let lastHash: string | undefined;
  const SETTLE = { quietMs: 200, maxMs: 3_000 };
  return {
    name: 'appdyno',
    async setup() {
      await d.open();
    },
    async teardown() {
      await d.stopAgent();
    },
    async read() {
      const s = buildScreen(await d.tree(), { platform: 'android' });
      lastHash = s.hash;
      return s.list.map((e) => ({ label: e.label, ...(e.id && { id: e.id }), x: e.x, y: e.y }));
    },
    async tap(p) {
      await d.tap(p, { settle: false });
    },
    async tapAndRead(p) {
      const r = await d.tap(p, {
        settle: SETTLE,
        read: 'tree',
        ...(lastHash && { before: lastHash }),
      });
      const s = buildScreen(r.tree!, { platform: 'android' });
      lastHash = s.hash;
      return { reads: r.settle?.reads ?? 0, settled: r.settle?.settled ?? false };
    },
    async typeText(p, text) {
      const r = await d.typeText(text, { at: p, replace: true, settle: false });
      return { verified: r.verified };
    },
    async screenshot() {
      const s = await d.screenshot({ format: 'jpeg', quality: 80, maxPx: 1024 });
      return { bytes: s.data.length };
    },
    async coldRead() {
      await d.stopAgent();
      d = new AndroidDevice(serial, adb);
      await d.tree();
    },
    async reconnect() {
      d.close();
      d = new AndroidDevice(serial, adb);
      await d.open();
    },
  };
}

export type Stats = {
  n: number;
  failed: number;
  p50: number;
  p90: number;
  p95: number;
  max: number;
  mean: number;
};

export function stats(ms: number[], failed: number): Stats {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p: number) => {
    if (s.length === 0) return NaN;
    const k = (s.length - 1) * p;
    const i = Math.floor(k);
    const j = Math.min(i + 1, s.length - 1);
    return Math.round(s[i]! + (s[j]! - s[i]!) * (k - i));
  };
  const mean = s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : NaN;
  return {
    n: s.length,
    failed,
    p50: q(0.5),
    p90: q(0.9),
    p95: q(0.95),
    max: s.length ? Math.round(s.at(-1)!) : NaN,
    mean,
  };
}

export type Environment = {
  at: string;
  hostLoad: number[];
  hostFreeMemPct: number;
  hostMemoryPressureFreePct?: number;
  deviceLoad?: string;
  emulatorGpu?: string;
  deviceModel?: string;
};

/** The host's and the device's load and the emulator's GPU mode, recorded with every result. */
export async function environment(adb: Adb, serial: string): Promise<Environment> {
  const env: Environment = {
    at: new Date().toISOString(),
    hostLoad: loadavg().map((x) => Math.round(x * 100) / 100),
    hostFreeMemPct: Math.round((freemem() / totalmem()) * 100),
  };
  try {
    const { stdout } = await run('memory_pressure', [], { timeout: 10_000 });
    const m = /free percentage: (\d+)%/.exec(stdout);
    if (m) env.hostMemoryPressureFreePct = Number(m[1]);
  } catch {
    // not macOS
  }
  env.deviceLoad = (await adb.exec(serial, 'cat /proc/loadavg').catch(() => '')).trim();
  env.deviceModel = (await adb.exec(serial, 'getprop ro.product.model').catch(() => '')).trim();
  try {
    const { stdout } = await run('ps', ['-axo', 'args'], { timeout: 10_000 });
    const port = /^emulator-(\d+)$/.exec(serial)?.[1];
    const line = stdout
      .split('\n')
      .find((l) => /qemu-system/.test(l) && (!port || l.includes(`-port ${port}`)));
    const gpu = line && /-gpu (\S+)/.exec(line)?.[1];
    if (gpu) env.emulatorGpu = gpu;
  } catch {
    // no ps
  }
  return env;
}

export type BenchResult = {
  driver: string;
  serial: string;
  before: Environment;
  after: Environment;
  ops: Record<string, Stats & { note?: string }>;
};

const APP = 'dev.appdyno.fixture';
const TEXT_20 = 'Çağrı İşgüzar Öğün Ş'; // 20 code points, Turkish letters

/**
 * Runs the fixed operation set on the fixture app: reads on four screens of different sizes, tap
 * acknowledgements, act-and-read on an unchanged and on a new screen, typing 20 Turkish letters, a
 * screenshot, and (where the driver has them) a cold start and a reconnect.
 */
export async function benchmark(
  driver: BenchDriver,
  serial: string,
  opts: { n?: number; adb?: Adb; log?: (s: string) => void } = {},
): Promise<BenchResult> {
  const adb = opts.adb ?? new Adb();
  const log = opts.log ?? (() => undefined);
  const n = opts.n ?? 50;
  const ops: BenchResult['ops'] = {};
  const shell = (c: string) => adb.exec(serial, c, { timeoutMs: 30_000 });
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const openScreen = async (screen: string) => {
    await shell(`am start -W -a android.intent.action.VIEW -d appdyno-fixture://open/${screen} ${APP}`);
    await pause(1_200);
  };
  const home = async () => {
    await shell(`am start -W -n ${APP}/.MainActivity -f 0x10008000`);
    await pause(1_200);
  };
  const measure = async (
    name: string,
    count: number,
    fn: () => Promise<unknown>,
    between?: () => Promise<unknown>,
  ) => {
    const ms: number[] = [];
    let failed = 0;
    for (let i = 0; i < count + 3; i++) {
      const t = performance.now();
      try {
        await fn();
        if (i >= 3) ms.push(performance.now() - t); // the first three warm up
      } catch (e) {
        if (i >= 3) failed++;
        log(`${name}: ${(e as Error).message}`);
      }
      if (between) await between();
    }
    ops[name] = stats(ms, failed);
    log(`${name}: ${JSON.stringify(ops[name])}`);
  };
  const find = async (label: string | RegExp) => {
    for (let i = 0; i < 10; i++) {
      const els = await driver.read();
      const e = els.find((x) =>
        typeof label === 'string' ? x.label === label || x.id === label : label.test(x.label),
      );
      if (e) return e;
      await pause(300);
    }
    throw new Error(`no ${label} on the screen`);
  };

  const before = await environment(adb, serial);
  await shell(`pm grant ${APP} android.permission.ACCESS_FINE_LOCATION`).catch(() => undefined);
  await driver.setup();
  try {
    await home();
    await measure('read.home', n, () => driver.read());
    for (const screen of ['list', 'compose', 'showcase']) {
      await openScreen(screen);
      await measure(`read.${screen}`, n, () => driver.read());
    }
    await home();
    const title = await find('appdyno fixture');
    await measure('tap.ack', n, () => driver.tap(title));
    await driver.read();
    await measure('tapRead.unchanged', n, () => driver.tapAndRead(title));
    await home();
    await measure(
      'tapRead.navigate',
      Math.min(n, 30),
      async () => {
        const form = await find('FORM').catch(() => undefined);
        if (!form) throw new Error('no FORM button');
        const r = await driver.tapAndRead(form);
        return r;
      },
      async () => {
        await shell('input keyevent KEYCODE_BACK');
        await pause(800);
        await driver.read();
      },
    );
    await openScreen('form');
    const field = await find('name_input');
    await measure('type.20tr', n, () => driver.typeText(field, TEXT_20));
    await home();
    await measure('screenshot', n, () => driver.screenshot());
    if (driver.reconnect) await measure('reconnect', Math.min(n, 20), () => driver.reconnect!());
    if (driver.coldRead) await measure('coldRead', 5, () => driver.coldRead!());
  } finally {
    await driver.teardown().catch(() => undefined);
  }
  return { driver: driver.name, serial, before, after: await environment(adb, serial), ops };
}

/** A driver from a module file: its default export is `(serial) => BenchDriver`. */
export async function loadDriver(path: string, serial: string): Promise<BenchDriver> {
  const mod = (await import(pathToFileURL(path).href)) as {
    default: (serial: string) => BenchDriver;
  };
  return mod.default(serial);
}

export function table(results: BenchResult[]): string {
  const names = [...new Set(results.flatMap((r) => Object.keys(r.ops)))];
  const head = `| op | ${results.map((r) => `${r.driver} p50 / p95 / max (n, failed)`).join(' | ')} |`;
  const sep = `|---|${results.map(() => '---').join('|')}|`;
  const rows = names.map(
    (op) =>
      `| ${op} | ${results
        .map((r) => {
          const s = r.ops[op];
          return s ? `${s.p50} / ${s.p95} / ${s.max} ms (${s.n}, ${s.failed})` : '–';
        })
        .join(' | ')} |`,
  );
  return [head, sep, ...rows].join('\n');
}
