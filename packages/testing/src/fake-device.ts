import { ANDROID_PAGES, androidScreen } from '@appdyno/driver-android';
import {
  DeviceActions,
  must,
  type ActOptions,
  type AppManager,
  type CrashesQuery,
  type CrashReport,
  type Device,
  type DeviceEvents,
  type DeviceSettings,
  type LaunchMode,
  type LogsQuery,
  type MeasureSource,
  type Mirror,
  type ScreenRecorder,
  type SystemView,
} from '@appdyno/core';
import { DeviceError, type ActParams, type Hello, type Point, type Tree } from '@appdyno/protocol';
import { LACKS } from './fake-measures.js';
import { SCREENS, tree } from './fake-screens.js';

/** A part of the port a test did not give: whatever is asked of it but `given`, it refuses. */
const notGiven = (what: string, given: object = {}): object =>
  new Proxy(given, {
    get: (has, key) =>
      (Reflect.get(has, key) as unknown) ??
      (() => Promise.reject(new DeviceError('UNSUPPORTED', `this fake has no ${what}`))),
  });

/** What a call of the device answers: what `work` throws is the promise's rejection, as it is a device's. */
const answer = <T>(work: () => T) =>
  new Promise<T>((resolve) => {
    resolve(work());
  });

export class FakeDevice extends DeviceActions implements Device {
  readonly platform = 'android' as const;
  readonly platformScreen = androidScreen;
  readonly settingsPages = ANDROID_PAGES;
  virtual = true;
  lastStartWasCold = true;
  // a device that names no app a call's link opens in, as an iPhone, for the guard every input passes
  apps = notGiven('apps', { opener: () => Promise.resolve(undefined) }) as AppManager;
  recorder = notGiven('recorder') as ScreenRecorder;
  mirror = notGiven('mirror') as Mirror;
  settings: DeviceSettings = {
    get: () => Promise.resolve('none'),
    set: () => Promise.resolve(undefined),
  };
  events = notGiven('events') as DeviceEvents;
  /** An agent without `wait`: the caller polls. */
  waitChange: Device['waitChange'] = () => Promise.resolve(undefined);
  dismissKeyboard: Device['dismissKeyboard'] = () => Promise.resolve();
  launchAlongside = (_pkg: string) => undefined;
  hello: Hello = {
    agentVersion: '0.1.0',
    protocol: { major: 2 },
    platform: 'android',
    osVersion: '15',
    sdk: 35,
    model: 'Fake Phone',
    screen: { w: 1080, h: 2400, density: 420, rotation: 0 },
  };
  screen = 'home';
  permissionUp = false;
  calls: { name: string; args: unknown[] }[] = [];
  typed: string[] = [];
  fail: DeviceError | undefined;
  /** Off: an action answers as an agent does at its deadline, with the screen still moving. */
  settles = true;
  /** What a settle says it watched for a system alert, as an iPhone's runner does. */
  idleMs: number | undefined;
  /** Thrown by open: a device that cannot start its agent. */
  openError: DeviceError | undefined;

  constructor(readonly serial = 'emulator-5580') {
    super();
  }

  private record(name: string, ...args: unknown[]) {
    this.calls.push({ name, args });
    if (this.fail) throw this.fail;
  }

  /** The swipes a list on the screen takes to reach its end: until then each moves what is shown. */
  listEnd = Number.POSITIVE_INFINITY;
  private swiped = 0;

  /** A recorded screen, shown as it is in place of the fake app's. */
  fixture: Tree | undefined;

  current(): Tree {
    if (this.fixture) return structuredClone(this.fixture);
    const t = tree(must(SCREENS[this.screen], `the screen ${this.screen}`));
    if (this.swiped > 0) {
      t.nodes.push({
        p: -1,
        w: 0,
        c: 'android.widget.TextView',
        t: `Row ${this.swiped}`,
        b: [0, 900, 1080, 1000],
        f: 17,
      });
      t.hash = `${t.hash}+${this.swiped}`;
    }
    if (this.permissionUp) {
      t.windows.push({
        type: 1,
        pkg: 'com.android.permissioncontroller',
        layer: 2,
        b: [0, 800, 1080, 1600],
        active: true,
        focused: true,
      });
      t.nodes.push(
        { p: -1, w: 1, c: 'android.widget.FrameLayout', b: [0, 800, 1080, 1600], f: 17 },
        {
          p: t.nodes.length,
          w: 1,
          c: 'android.widget.Button',
          id: 'com.android.permissioncontroller:id/permission_allow_foreground_only_button',
          t: 'Uygulamayı kullanırken',
          b: [100, 1000, 980, 1100],
          f: 19,
        },
      );
      t.hash = `${t.hash}+perm`;
    }
    return t;
  }

  hardware() {
    return Promise.resolve({ platform: 'android' as const, controls: [] });
  }

  open() {
    return this.openError ? Promise.reject(this.openError) : Promise.resolve(this.hello);
  }
  tree() {
    return answer(() => {
      this.record('tree');
      return this.current();
    });
  }
  act(action: ActParams, opts: ActOptions = {}) {
    return answer(() => this.acted(action, opts));
  }
  private acted(action: ActParams, opts: ActOptions) {
    this.record('act', action, opts);
    if (action.kind === 'swipe') {
      const on = this.swiped + (action.to.y < action.from.y ? 1 : -1);
      this.swiped = Math.max(0, Math.min(on, this.listEnd));
    }
    if (action.kind === 'tap') {
      if (this.permissionUp && action.y >= 1000 && action.y <= 1100) this.permissionUp = false;
      else {
        const hit = must(SCREENS[this.screen], `the screen ${this.screen}`).find(
          (n) =>
            n.go &&
            action.x >= n.b[0] &&
            action.x <= n.b[2] &&
            action.y >= n.b[1] &&
            action.y <= n.b[3],
        );
        if (hit?.go === 'permission') this.permissionUp = true;
        else if (hit?.go) this.screen = hit.go;
      }
    }
    const t = this.current();
    return {
      ...(opts.settle && {
        settle: {
          settled: this.settles,
          ms: 120,
          reads: 1,
          ...(this.idleMs && { idleMs: this.idleMs }),
        },
      }),
      ...(opts.read === 'tree' && { tree: t }),
      ...(opts.read === 'hash' && { hash: t.hash }),
    };
  }
  async typeText(
    text: string,
    opts: { at?: Point; replace?: boolean; submit?: boolean } & ActOptions = {},
  ) {
    this.record('typeText', opts);
    this.typed.push(text);
    const r = await this.act({ kind: 'key', key: 'tab' }, opts);
    return { ...r, mode: 'setText' as const, verified: true, focusMs: 5 };
  }
  screenshot(): ReturnType<Device['screenshot']> {
    return answer(() => {
      this.record('screenshot');
      return {
        meta: { w: 460, h: 1024, format: 'jpeg' as const, bytes: 3 },
        data: Buffer.from([1, 2, 3]),
      };
    });
  }
  clearLocation() {
    return answer(() => this.record('clearLocation'));
  }
  openView(view: SystemView) {
    return answer(() => this.record('openView', view));
  }
  /** A row to tap, as a device with no link to an app's page answers. */
  settingsRow: string | undefined;
  openSettings(to: Parameters<Device['openSettings']>[0]) {
    return answer(() => {
      this.record('openSettings', to);
      return this.settingsRow ? { row: this.settingsRow } : {};
    });
  }
  foreground() {
    return answer(() => must(this.current().windows.at(-1), 'a window').pkg);
  }
  setClipboard(text: string) {
    return answer(() => this.record('setClipboard', text));
  }
  setOrientation(r: 0 | 1 | 2 | 3) {
    return answer(() => this.record('setOrientation', r));
  }
  openUrl(url: string, pkg?: string) {
    return answer(() => this.record('openUrl', url, pkg));
  }
  launch(pkg: string) {
    return answer(() => {
      this.record('launch', pkg);
      this.screen = 'home';
    });
  }
  terminate(pkg: string) {
    return answer(() => this.record('terminate', pkg));
  }
  setLocation(lat: number, lon: number) {
    return answer(() => this.record('setLocation', lat, lon));
  }
  getClipboard() {
    return Promise.resolve(undefined);
  }
  audit(): ReturnType<Device['audit']> {
    return Promise.resolve({ engine: 'rules', issues: [], truncated: false, elapsedMs: 1 });
  }
  agentUp = false;
  stopAgent() {
    this.agentUp = false;
    return Promise.resolve();
  }
  /** What `logs` finds, and what it was asked. */
  logLines: string[] = [];
  logNote: string | undefined;
  logAsked: LogsQuery | undefined;
  logs(q: LogsQuery) {
    this.logAsked = q;
    return Promise.resolve({
      lines: this.logLines,
      source: 'fake log',
      ...(this.logNote && { note: this.logNote }),
    });
  }
  crashReports: CrashReport[] = [];
  crashes(q: CrashesQuery) {
    return Promise.resolve({
      reports: this.crashReports.slice(0, q.limit),
      source: 'fake reports',
    });
  }
  /** How far ahead of this Mac the fake's clock runs. */
  clockAheadMs = 0;
  wallClock() {
    return Promise.resolve(Date.now() + this.clockAheadMs);
  }
  running = true;
  appRunning() {
    return Promise.resolve(this.running);
  }
  /** Set: the fake reports this process id, as Android does. */
  pid: string | undefined;
  appPid: FakeDevice['fakePid'] | undefined;
  /** Set: the system holds the app's process for its crash dialog, as Android's "keeps stopping" does. */
  appCrashing: ((app: string) => Promise<boolean>) | undefined;
  fakePid = () => Promise.resolve(this.pid);
  close = () => undefined;

  /** Canned measurements; `jank` sets the share of janky frames, `memKb` the PSS per read. */
  jank = 4;
  memKb = [100_000, 110_000, 112_000, 113_000, 114_000, 115_000, 116_000];
  private memRead = 0;
  get measure() {
    const m = <T>(value: T, raw: string) => ({ value, raw, at: '2026-10-25T00:00:00.000Z' });
    return {
      ...LACKS,
      cpu: () =>
        answer(() => {
          this.record('perf.cpu');
          return m(
            { percent: 12.5, windowMs: 2000, ticks: 25, clockTicksPerSec: 100 },
            'stat a\n---\nstat b',
          );
        }),
      memory: () =>
        answer(() => {
          this.record('perf.memory');
          const pssKb = must(
            this.memKb[Math.min(this.memRead++, this.memKb.length - 1)],
            'a memory reading',
          );
          return m(
            {
              kb: pssKb,
              kind: 'pss' as const,
              javaHeapKb: 20_000,
              nativeHeapKb: 30_000,
              graphicsKb: 10_000,
            },
            `TOTAL PSS: ${pssKb}`,
          );
        }),
      frames: () =>
        answer(() => {
          this.record('perf.frames');
          return m(
            {
              totalFrames: 120,
              jankyFrames: Math.round(1.2 * this.jank),
              jankyPercent: this.jank,
              frozenFrames: 0,
              fewFrames: false,
              p95Ms: 18,
            },
            'Total frames rendered: 120',
          );
        }),
      resetFrames: () => answer(() => this.record('perf.reset')),
      /** A counter read before and after, by whatever a test made of the two. */
      async framesDuring(this: MeasureSource, app: string, _s: number, during) {
        await this.resetFrames(app);
        await during();
        return this.frames(app);
      },
      vitals: () =>
        Promise.resolve(m({ load: [1, 1, 1], cpuPressure: 2, thermalStatus: 0 }, '==load==')),
      launch: (_pkg: string, o: { mode: LaunchMode }) =>
        answer(() => {
          this.record('perf.launch', o.mode);
          return m(
            {
              mode: o.mode,
              samples: [
                { totalMs: 610, state: 'COLD' },
                { totalMs: 590, state: 'COLD' },
                { totalMs: 600, state: 'COLD' },
              ],
              medianMs: 600,
            },
            'TotalTime: 600',
          );
        }),
      cpuProfile: () =>
        Promise.resolve(
          m(
            {
              durationMs: 3000,
              samples: 2997,
              top: [{ percent: 62.1, samples: 1861, symbol: 'dev.app.Busy.loop' }],
            },
            'Samples: 2997',
          ),
        ),
      heap: (pkg: string, dir: string) =>
        Promise.resolve(
          m(
            { file: `${dir}/heap-${pkg}-1.hprof`, bytes: 60 * 1048576, kind: 'hprof' as const },
            'dumpheap',
          ),
        ),
      frameTrace: () =>
        Promise.resolve(
          m(
            {
              kind: 'timeline',
              frames: 50,
              janky: 5,
              jankyPercent: 10,
              appDeadlineMissed: 4,
              appJankPercent: 8,
              bufferStuffing: 1,
              surfaceFlinger: 0,
              p50Ms: 9,
              p95Ms: 30,
              worstMs: 45,
              frozen: 1,
            },
            '"ts","dur","jank_type"',
          ),
        ),
    } satisfies MeasureSource;
  }
}

/** With the on-screen keyboard open, until it is dismissed (`closes`: the app lets it). */
export class WithKeyboard extends FakeDevice {
  up = true;
  closes = true;
  /** Where the keyboard's window begins: 0 is a full-screen one, as a phone shows in landscape. */
  top = 1500;
  /** Words the window the keyboard shrank leaves out while it is up. */
  hides: string | undefined;
  override current(): Tree {
    const t = super.current();
    if (!this.up) return t;
    t.windows.push({
      type: 2,
      pkg: 'ime',
      layer: 3,
      b: [0, this.top, 1080, 2400],
      active: false,
      focused: false,
    });
    if (this.hides) {
      t.nodes = t.nodes.filter((n) => n.t !== this.hides);
      t.hash = `${t.hash}+shrunk`;
    }
    return t;
  }
  dismissKeyboard = () => {
    if (this.closes) this.up = false;
    return Promise.resolve();
  };
}
