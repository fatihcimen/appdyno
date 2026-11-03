import { androidScreen } from '@appdyno/driver-android';
import {
  DeviceActions,
  type ActOptions,
  type CrashesQuery,
  type CrashReport,
  type Device,
  type LaunchMode,
  type LogsQuery,
  type MeasureSource,
} from '@appdyno/core';
import {
  DeviceError,
  type ActParams,
  type Hello,
  type Point,
  type Tree,
  type WireNode,
} from '@appdyno/protocol';

type Node = Partial<WireNode> & { b: [number, number, number, number]; go?: string };

/** A screen of the fake app: its nodes (a tap inside a node with `go` opens that screen). */
const tree = (nodes: Node[], pkg = 'dev.app', hash?: string): Tree => ({
  windows: [{ type: 1, pkg, layer: 1, b: [0, 0, 1080, 2400], active: true, focused: true }],
  nodes: [
    { p: -1, w: 0, c: 'android.widget.FrameLayout', b: [0, 0, 1080, 2400], f: 17 },
    ...nodes.map(({ go: _go, ...n }) => ({
      p: 0,
      w: 0,
      c: 'android.widget.TextView',
      f: 17,
      ...n,
    })),
  ],
  truncated: false,
  elapsedMs: 3,
  hash: hash ?? JSON.stringify(nodes.map((n) => [n.c, n.id, n.b])),
});

/** A row that holds its name and state as texts of their own, as a settings list does. */
const row = (name: string, state: string, y: number, go?: string): Node[] => [
  {
    c: 'android.widget.LinearLayout',
    d: `${name} ${state}`,
    b: [0, y, 1080, y + 100],
    f: 19,
    ...(go && { go }),
  },
  { t: name, b: [100, y + 10, 500, y + 50] },
  { t: state, b: [100, y + 50, 500, y + 90] },
];
const settings = (wifi: string, go?: string): Node[] => [
  { t: 'Ayarlar', b: [0, 100, 1080, 200] },
  ...row('Wi-Fi', wifi, 300, go),
  ...row('Bluetooth', 'Off', 400),
  ...row('Hotspot', 'Off', 500),
];

/** A row and a control of its name at its very place, as a phone's list draws them. */
const doubled = (name: string, y: number, go?: string): Node[] =>
  ['android.widget.LinearLayout', 'android.widget.Button'].map((c) => ({
    c,
    t: name,
    b: [0, y, 1080, y + 100],
    f: 19,
    ...(go && { go }),
  }));

const FORM: Node[] = [
  { t: 'Bilgiler', b: [0, 100, 1080, 200] },
  {
    c: 'android.widget.EditText',
    id: 'dev.app:id/name',
    h: 'Adınız',
    b: [0, 300, 1080, 400],
    f: 1 | 4 | 16 | 128,
  },
  { c: 'android.widget.Button', t: 'Gönder', b: [0, 500, 1080, 600], f: 19, go: 'sent' },
];

export const SCREENS: Record<string, Node[]> = {
  settings: settings('On', 'settingsOff'),
  settingsOff: settings('Off'),
  doubled: [
    ...doubled('General', 300, 'home'),
    ...doubled('Camera', 400),
    ...doubled('Fonts', 500),
  ],
  login: [
    {
      c: 'android.widget.EditText',
      id: 'dev.app:id/user',
      h: 'User',
      b: [0, 100, 1080, 200],
      f: 149,
    },
    {
      c: 'android.widget.EditText',
      id: 'dev.app:id/pass',
      h: 'Password',
      b: [0, 300, 1080, 400],
      f: 1 | 4 | 16 | 128 | 512,
    },
    { c: 'android.widget.Button', t: 'Add', b: [0, 500, 500, 600], f: 19 },
    { c: 'android.widget.Button', t: 'Add', b: [500, 500, 1080, 600], f: 19 },
    {
      c: 'android.widget.Button',
      id: 'android:id/button1',
      t: 'OK',
      b: [0, 700, 1080, 800],
      f: 19,
      go: 'home',
    },
    { t: 'Merhaba s3cr3t-pass', id: 'dev.app:id/greeting', b: [0, 900, 1080, 1000] },
  ],
  home: [
    { t: 'Ana sayfa', b: [0, 100, 1080, 200] },
    { c: 'android.widget.Button', t: 'Form', b: [0, 300, 1080, 400], f: 19, go: 'form' },
    { c: 'android.widget.Button', t: 'İzin', b: [0, 500, 1080, 600], f: 19, go: 'permission' },
  ],
  form: FORM,
  sent: [...FORM, { t: 'Gönderildi', id: 'dev.app:id/result', b: [0, 700, 1080, 800] }],
};

export class FakeDevice extends DeviceActions implements Device {
  readonly platform = 'android' as const;
  readonly platformScreen = androidScreen;
  lastStartWasCold = true;
  hello: Hello = {
    agentVersion: '0.1.0',
    protocol: { major: 1, minor: 0 },
    platform: 'android',
    osVersion: '15',
    sdk: 35,
    model: 'Fake Phone',
    screen: { w: 1080, h: 2400, density: 420, rotation: 0 },
    capabilities: ['tree'],
  };
  screen = 'home';
  permissionUp = false;
  calls: { name: string; args: unknown[] }[] = [];
  typed: string[] = [];
  fail: DeviceError | undefined;
  /** Thrown by open: a device that cannot start its agent. */
  openError: DeviceError | undefined;

  constructor(readonly serial = 'emulator-5580') {
    super();
  }

  private record(name: string, ...args: unknown[]) {
    this.calls.push({ name, args });
    if (this.fail) throw this.fail;
  }

  current(): Tree {
    const t = tree(SCREENS[this.screen]!);
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

  async open() {
    if (this.openError) throw this.openError;
    return this.hello;
  }
  async tree() {
    this.record('tree');
    return this.current();
  }
  async act(action: ActParams, opts: ActOptions = {}) {
    this.record('act', action, opts);
    if (action.kind === 'tap') {
      if (this.permissionUp && action.y >= 1000 && action.y <= 1100) this.permissionUp = false;
      else {
        const hit = SCREENS[this.screen]!.find(
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
      ...(opts.settle && { settle: { settled: true, ms: 120, reads: 1 } }),
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
  async screenshot(): ReturnType<Device['screenshot']> {
    this.record('screenshot');
    return {
      meta: { w: 460, h: 1024, format: 'jpeg', bytes: 3 },
      data: Buffer.from([1, 2, 3]),
    };
  }
  async foreground() {
    return this.current().windows.at(-1)!.pkg;
  }
  async setClipboard(text: string) {
    this.record('setClipboard', text);
  }
  async setOrientation(r: 0 | 1 | 2 | 3) {
    this.record('setOrientation', r);
  }
  async openUrl(url: string, pkg?: string) {
    this.record('openUrl', url, pkg);
  }
  async launch(pkg: string) {
    this.record('launch', pkg);
    this.screen = 'home';
    return 'Status: ok';
  }
  async terminate(pkg: string) {
    this.record('terminate', pkg);
  }
  async setLocation(lat: number, lon: number) {
    this.record('setLocation', lat, lon);
  }
  async getClipboard() {
    return undefined;
  }
  async audit(): ReturnType<Device['audit']> {
    return { engine: 'rules', issues: [], truncated: false, elapsedMs: 1 };
  }
  async stopAgent() {}
  /** What `logs` finds, and what it was asked. */
  logLines: string[] = [];
  logNote: string | undefined;
  logAsked: LogsQuery | undefined;
  async logs(q: LogsQuery) {
    this.logAsked = q;
    return {
      lines: this.logLines,
      source: 'fake log',
      ...(this.logNote && { note: this.logNote }),
    };
  }
  crashReports: CrashReport[] = [];
  async crashes(q: CrashesQuery) {
    return {
      reports: this.crashReports.slice(0, q.limit),
      source: 'fake reports',
    };
  }
  running = true;
  async appRunning() {
    return this.running;
  }
  /** Set: the fake reports this process id, as Android does. */
  pid: string | undefined;
  appPid: FakeDevice['fakePid'] | undefined;
  fakePid = async () => this.pid;
  close() {}

  /** Canned measurements; `jank` sets the share of janky frames, `memKb` the PSS per read. */
  jank = 4;
  memKb = [100_000, 110_000, 112_000, 113_000, 114_000, 115_000, 116_000];
  private memRead = 0;
  get measure() {
    const m = <T>(value: T, raw: string) => ({ value, raw, at: '2026-10-25T00:00:00.000Z' });
    return {
      virtual: true,
      cpu: async () => {
        this.record('perf.cpu');
        return m(
          { percent: 12.5, windowMs: 2000, ticks: 25, clockTicksPerSec: 100 },
          'stat a\n---\nstat b',
        );
      },
      memory: async () => {
        this.record('perf.memory');
        const pssKb = this.memKb[Math.min(this.memRead++, this.memKb.length - 1)]!;
        return m(
          { kb: pssKb, kind: 'pss', javaHeapKb: 20_000, nativeHeapKb: 30_000, graphicsKb: 10_000 },
          `TOTAL PSS: ${pssKb}`,
        );
      },
      frames: async () => {
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
      },
      resetFrames: async () => {
        this.record('perf.reset');
      },
      vitals: async () => {
        return m({ load: [1, 1, 1], cpuPressure: 2, thermalStatus: 0 }, '==load==');
      },
      launch: async (_pkg: string, o: { mode: LaunchMode }) => {
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
      },
      cpuProfile: async () =>
        m(
          {
            durationMs: 3000,
            samples: 2997,
            top: [{ percent: 62.1, samples: 1861, symbol: 'dev.app.Busy.loop' }],
          },
          'Samples: 2997',
        ),
      heap: async (pkg: string, dir: string) =>
        m({ file: `${dir}/heap-${pkg}-1.hprof`, bytes: 60 * 1048576, kind: 'hprof' }, 'dumpheap'),
      frameTrace: async () => {
        return m(
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
        );
      },
    } satisfies MeasureSource;
  }
}

/** With the on-screen keyboard open, until it is dismissed (`closes`: the app lets it). */
export class WithKeyboard extends FakeDevice {
  up = true;
  closes = true;
  override current(): Tree {
    const t = super.current();
    if (this.up)
      t.windows.push({
        type: 2,
        pkg: 'ime',
        layer: 3,
        b: [0, 1500, 1080, 2400],
        active: false,
        focused: false,
      });
    return t;
  }
  dismissKeyboard = async () => {
    if (this.closes) this.up = false;
  };
}
