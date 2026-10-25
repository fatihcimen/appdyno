import {
  DeviceError,
  type ActOptions,
  type ActParams,
  type AndroidPerf,
  type Hello,
  type Point,
  type Tree,
  type WireNode,
} from 'appdyno';
import type { DriveableDevice } from '../src/session.js';

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

export const SCREENS: Record<string, Node[]> = {
  home: [
    { t: 'Ana sayfa', b: [0, 100, 1080, 200] },
    { c: 'android.widget.Button', t: 'Form', b: [0, 300, 1080, 400], f: 19, go: 'form' },
    { c: 'android.widget.Button', t: 'İzin', b: [0, 500, 1080, 600], f: 19, go: 'permission' },
  ],
  form: [
    { t: 'Bilgiler', b: [0, 100, 1080, 200] },
    {
      c: 'android.widget.EditText',
      id: 'dev.app:id/name',
      h: 'Adınız',
      b: [0, 300, 1080, 400],
      f: 1 | 4 | 16 | 128,
    },
    { c: 'android.widget.Button', t: 'Gönder', b: [0, 500, 1080, 600], f: 19, go: 'sent' },
  ],
  sent: [
    { t: 'Bilgiler', b: [0, 100, 1080, 200] },
    {
      c: 'android.widget.EditText',
      id: 'dev.app:id/name',
      h: 'Adınız',
      b: [0, 300, 1080, 400],
      f: 1 | 4 | 16 | 128,
    },
    { c: 'android.widget.Button', t: 'Gönder', b: [0, 500, 1080, 600], f: 19, go: 'sent' },
    { t: 'Gönderildi', id: 'dev.app:id/result', b: [0, 700, 1080, 800] },
  ],
};

export class FakeDevice implements DriveableDevice {
  readonly platform = 'android' as const;
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

  constructor(readonly serial = 'emulator-5580') {}

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
  tap(p: Point, opts?: ActOptions) {
    return this.act({ kind: 'tap', x: p.x, y: p.y }, opts);
  }
  longPress(p: Point, durationMs = 800, opts?: ActOptions) {
    return this.act({ kind: 'longPress', x: p.x, y: p.y, durationMs }, opts);
  }
  swipe(from: Point, to: Point, durationMs = 300, opts?: ActOptions) {
    return this.act({ kind: 'swipe', from, to, durationMs }, opts);
  }
  key(key: Parameters<DriveableDevice['key']>[0], opts?: ActOptions) {
    return this.act({ kind: 'key', key }, opts);
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
  async screenshot() {
    this.record('screenshot');
    return {
      meta: { w: 460, h: 1024, format: 'jpeg' as const, bytes: 3 },
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
  close() {}

  /** Canned measurements; `jank` sets the share of janky frames, `memKb` the PSS per read. */
  jank = 4;
  memKb = [100_000, 110_000, 112_000, 113_000, 114_000, 115_000, 116_000];
  private memRead = 0;
  get perf(): AndroidPerf {
    const m = <T>(value: T, raw: string) => ({ value, raw, at: '2026-10-25T00:00:00.000Z' });
    return {
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
          { pssKb, javaHeapKb: 20_000, nativeHeapKb: 30_000, graphicsKb: 10_000 },
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
      launch: async (_pkg: string, o: { mode?: 'cold' | 'warm' } = {}) => {
        this.record('perf.launch', o.mode);
        return m(
          {
            mode: o.mode ?? 'cold',
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
      frameTimeline: async () => {
        return m(
          {
            frames: 50,
            janky: 5,
            jankyPercent: 10,
            appDeadlineMissed: 4,
            bufferStuffing: 1,
            surfaceFlinger: 0,
            p50Ms: 9,
            p95Ms: 30,
            worstMs: 45,
          },
          '"ts","dur","jank_type"',
        );
      },
    } as unknown as AndroidPerf;
  }
}
