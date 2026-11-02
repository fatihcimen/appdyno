import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Capability, HeapReading, Measured, MeasureSource } from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { checkApp } from './policy.js';
import { refused, type Session } from './session.js';
import { HeapOut, LaunchOut, ProfileOut, ScrollOut, SnapshotOut, TraceOut } from './schemas.js';
import { swipeLine } from './steps.js';
import { ACT, defineOp, DESTRUCTIVE, READ, reply, ToolError, type Op } from './tool.js';

const Device = z
  .string()
  .max(64)
  .optional()
  .describe('device (list_devices); default: the selected device');
const App = z
  .string()
  .max(200)
  .optional()
  .describe('package or bundle id; default: the selected app');

/** Jank above this share of frames is worth a finding (Android vitals counts a session slow above 25 %). */
const JANK_PERCENT = 10;

/** What a device without the measure is told it lacks. */
const MEASURE_NAME: Record<Capability, string> = {
  cpu: 'CPU',
  memory: 'memory',
  frames: 'frames',
  resetFrames: 'frames',
  vitals: 'the device state',
  launch: 'launch time',
  cpuProfile: 'a CPU profile',
  heap: 'a heap dump',
  frameTrace: 'a frame trace',
};

const HEAP: Record<HeapReading['kind'], { store: string; label: string }> = {
  hprof: { store: 'heap-dump', label: 'heap dump' },
  memgraph: { store: 'heap-graph', label: 'memory graph (Xcode)' },
};

/**
 * Stores a measurement (its values and the raw tool output they came from) under `dir`; returns the id
 * and the files. Nothing leaves the machine.
 */
export async function store(dir: string, kind: string, value: unknown, raw: string) {
  const id = `pm-${randomBytes(4).toString('hex')}`;
  await mkdir(dir, { recursive: true });
  const json = join(dir, `${id}.json`);
  const txt = join(dir, `${id}.txt`);
  await writeFile(json, JSON.stringify({ id, kind, at: new Date().toISOString(), value }, null, 2));
  await writeFile(txt, raw);
  return { id, json, txt };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return undefined;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
};
const kb = (n?: number) => (n === undefined ? '?' : `${(n / 1024).toFixed(1)} MB`);

/** The device's measure, or a refusal that names what it lacks. */
function measure<K extends Capability>(s: Session, k: K): NonNullable<MeasureSource[K]> {
  const source = s.device.measure;
  const f = source?.[k] as ((...a: unknown[]) => unknown) | undefined;
  if (!f) throw new ToolError(`${s.device.serial} cannot measure ${MEASURE_NAME[k]}`);
  return f.bind(source) as NonNullable<MeasureSource[K]>;
}

export function perfOps(ctx: ServerContext): Op[] {
  const appOf = (s: Session, app?: string) => {
    const pkg = checkApp(ctx.policy, app ?? s.appId ?? '');
    if (!pkg) throw new ToolError('give app (or select one with use_device)');
    return pkg;
  };
  const virtual = (s: Session) => s.device.measure?.virtual === true;
  const relative = (s: Session) =>
    virtual(s) ? ' (virtual device: relative, compare only with the same kind of device)' : '';
  const save = async (kind: string, m: Measured<unknown>[], value: unknown) =>
    store(ctx.measurementsDir, kind, value, m.map((x) => `## ${x.at}\n${x.raw}`).join('\n\n'));
  /** Four swipes after `waitMs`, for a measure that records during a scroll. */
  const scroller = async (s: Session, direction: 'up' | 'down', waitMs: number) => {
    const h = s.device.hello!;
    const size = (await s.current()).window ?? { w: h.screen.w, h: h.screen.h };
    return async () => {
      await new Promise((x) => setTimeout(x, waitMs));
      for (let i = 0; i < 4; i++) {
        const { from, to } = swipeLine(size, { direction, distance: size.h * 0.4 });
        await s.device.swipe(from, to, 300, { settle: false });
      }
    };
  };

  return [
    defineOp({
      name: 'perf_snapshot',
      title: 'Performance snapshot',
      description:
        "The app's CPU now (2 s), its memory, its frames since the last measure and the device's state (load, heat). The measurement id and the raw output are kept.",
      input: z
        .object({
          device: Device,
          app: App,
          cpuWindowMs: z.number().int().min(500).max(10_000).default(2_000),
        })
        .strict(),
      output: SnapshotOut,
      annotations: READ,
      needs: 'cpu',
      run: async ({ device, app, cpuWindowMs }) => {
        const s = await ctx.session(device);
        const pkg = appOf(s, app);
        const readCpu = measure(s, 'cpu');
        const readMemory = measure(s, 'memory');
        const cpu = await readCpu(pkg, cpuWindowMs).catch(refused);
        const mem = await readMemory(pkg).catch(refused);
        const frames = await s.device.measure?.frames?.(pkg).catch(refused);
        const vitals = await s.device.measure?.vitals?.().catch(refused);
        const saved = await save(
          'snapshot',
          [cpu, mem, ...(frames ? [frames] : []), ...(vitals ? [vitals] : [])],
          {
            cpu: cpu.value,
            memory: mem.value,
            ...(frames && { frames: frames.value }),
            ...(vitals && { vitals: vitals.value }),
          },
        );
        const m = mem.value;
        const f = frames?.value;
        const v = vitals?.value;
        return reply(
          [
            `measurement ${saved.id}${relative(s)}`,
            `CPU: ${cpu.value.percent}% (of one core, ${cpu.value.windowMs} ms)`,
            m.kind === 'pss'
              ? `memory: PSS ${kb(m.kb)}, Java ${kb(m.javaHeapKb)}, native ${kb(m.nativeHeapKb)}, graphics ${kb(m.graphicsKb)}`
              : `memory: physical footprint ${kb(m.kb)}${m.peakKb !== undefined ? ` (peak ${kb(m.peakKb)})` : ''}`,
            ...(f
              ? [
                  `frames (since the last reset): ${f.totalFrames}, janky ${f.jankyPercent}%, frozen ${f.frozenFrames}${f.p95Ms !== undefined ? `, p95 ${f.p95Ms} ms` : ''}${f.fewFrames ? ' (few frames: the share means little)' : ''}`,
                  ...(f.frames?.worstWindow
                    ? [
                        `worst second: ${f.frames.worstWindow.slow} missed of ${f.frames.worstWindow.frames} frames, mean ${f.frames.worstWindow.avgMs} ms`,
                      ]
                    : []),
                ]
              : ['no frame measure on a simulator']),
            ...(v
              ? [
                  `device: load ${v.load?.join(' ') ?? '?'}, CPU pressure ${v.cpuPressure ?? '?'}, thermal ${v.thermalStatus ?? '?'}`,
                ]
              : []),
            `raw output: ${saved.txt}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            cpuPercent: cpu.value.percent,
            memoryKb: m.kb,
            memoryKind: m.kind,
            ...(m.peakKb !== undefined && { peakKb: m.peakKb }),
            ...(m.javaHeapKb !== undefined && { javaHeapKb: m.javaHeapKb }),
            ...(m.nativeHeapKb !== undefined && { nativeHeapKb: m.nativeHeapKb }),
            ...(f && {
              frames: {
                total: f.totalFrames,
                jankyPercent: f.jankyPercent,
                frozen: f.frozenFrames,
                ...(f.p95Ms !== undefined && { p95Ms: f.p95Ms }),
              },
            }),
            ...(v?.load && { deviceLoad: v.load }),
          },
        );
      },
    }),
    defineOp({
      name: 'perf_scroll',
      title: 'Scroll performance',
      description:
        'Measure frames and memory while scrolling a list: each round resets the frames, swipes `swipes` times, and reads frames and memory once the list stops. Up or down only.',
      input: z
        .object({
          device: Device,
          app: App,
          direction: z.enum(['up', 'down']).default('up'),
          swipes: z.number().int().min(1).max(10).default(5),
          repeats: z.number().int().min(1).max(5).default(3),
        })
        .strict(),
      output: ScrollOut,
      annotations: ACT,
      needs: 'frames',
      run: async ({ device, app, direction, swipes, repeats }) => {
        const s = await ctx.session(device);
        const pkg = appOf(s, app);
        const readFrames = measure(s, 'frames');
        const resetFrames = measure(s, 'resetFrames');
        const readMemory = measure(s, 'memory');
        const h = s.device.hello!;
        const size = (await s.current()).window ?? { w: h.screen.w, h: h.screen.h };
        const all: Measured<unknown>[] = [];
        const rounds: {
          jankyPercent: number;
          frozen: number;
          frames: number;
          p95Ms?: number;
          memStartKb: number;
          memEndKb: number;
        }[] = [];
        for (let r = 0; r < repeats; r++) {
          const m0 = await readMemory(pkg).catch(refused);
          await resetFrames(pkg).catch(refused);
          for (let i = 0; i < swipes; i++) {
            const { from, to } = swipeLine(size, { direction, distance: size.h * 0.4 });
            await s.device.swipe(from, to, 300, { settle: false }).catch(refused);
          }
          await new Promise((x) => setTimeout(x, 1_500));
          const f = await readFrames(pkg).catch(refused);
          const m1 = await readMemory(pkg).catch(refused);
          all.push(m0, f, m1);
          rounds.push({
            jankyPercent: f.value.jankyPercent,
            frozen: f.value.frozenFrames,
            frames: f.value.totalFrames,
            ...(f.value.p95Ms !== undefined && { p95Ms: f.value.p95Ms }),
            memStartKb: m0.value.kb,
            memEndKb: m1.value.kb,
          });
        }
        s.acted();
        const counted = rounds.filter((x) => x.frames >= 60);
        const jank = median(counted.map((x) => x.jankyPercent));
        const frozen = rounds.reduce((a, x) => a + x.frozen, 0);
        // steady state: the second round's end to the last one's (the first loads images and caches)
        const growth =
          rounds.length >= 3
            ? (rounds.at(-1)!.memEndKb - rounds[1]!.memEndKb) / rounds[1]!.memEndKb
            : undefined;
        const saved = await save('scroll', all, {
          direction,
          swipes,
          repeats,
          rounds,
          jankMedianPercent: jank,
          frozen,
          memGrowth: growth,
        });
        const notes = [
          ...(jank !== undefined && jank > JANK_PERCENT
            ? [`high jank: median ${jank}% (threshold ${JANK_PERCENT}%)`]
            : []),
          ...(frozen > 0 ? [`frozen frames: ${frozen} (over 700 ms)`] : []),
          ...(growth !== undefined && growth > 0.3
            ? [`memory grows: ${Math.round(growth * 100)}% (from round 2 to the last)`]
            : []),
        ];
        return reply(
          [
            `measurement ${saved.id}${relative(s)}`,
            ...rounds.map(
              (x, i) =>
                `round ${i + 1}: ${x.frames} frames, janky ${x.jankyPercent}%${x.p95Ms !== undefined ? `, p95 ${x.p95Ms} ms` : ''}, frozen ${x.frozen}, memory ${kb(x.memStartKb)} → ${kb(x.memEndKb)}`,
            ),
            `median jank: ${jank === undefined ? 'not enough frames' : `${jank}%`}`,
            ...(notes.length ? notes : ['no threshold exceeded']),
            `raw output: ${saved.txt}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            rounds,
            ...(jank !== undefined && { jankMedianPercent: jank }),
            frozen,
            ...(growth !== undefined && { memGrowth: Math.round(growth * 1000) / 1000 }),
            findings: notes,
          },
        );
      },
    }),
    defineOp({
      name: 'perf_launch',
      title: 'Launch time',
      description:
        "The app's launch time: cold (stopped, then started) or warm (back from the background); the first launch warms up, then `repeats` launches, median. The app restarts.",
      input: z
        .object({
          device: Device,
          app: App,
          mode: z.enum(['cold', 'warm']).default('cold'),
          repeats: z.number().int().min(1).max(10).default(3),
        })
        .strict(),
      output: LaunchOut,
      annotations: DESTRUCTIVE,
      needs: 'launch',
      run: async ({ device, app, mode, repeats }) => {
        const s = await ctx.session(device);
        const pkg = appOf(s, app);
        const m = await measure(s, 'launch')(pkg, { mode, repeats }).catch(refused);
        s.acted();
        const saved = await save('launch', [m], m.value);
        const limit = mode === 'cold' ? 5_000 : 2_000; // Android vitals: excessive cold ≥ 5 s, warm ≥ 2 s
        const { medianMs: med, until, samples } = m.value;
        // a time counted to a tool's own mark (`until`) is not the system's launch time the limit is about
        const over = !until && med !== undefined && med >= limit;
        return reply(
          [
            `measurement ${saved.id}${relative(s)}`,
            `${mode} launch${until ? ` (until ${until})` : ''}: ${samples.map((x) => `${x.totalMs ?? '?'} ms${until ? '' : ` (${x.state ?? '?'})`}`).join(', ')}`,
            `median: ${med === undefined ? 'not measured' : `${med} ms`}${over ? ` (excessive: threshold ${limit} ms)` : ''}`,
            `raw output: ${saved.txt}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            mode,
            samples: samples.map((x) => ({
              ...(x.totalMs !== undefined && { totalMs: x.totalMs }),
              ...(x.state && { state: x.state }),
            })),
            ...(med !== undefined && { medianMs: med }),
            excessive: med !== undefined && med >= limit,
          },
        );
      },
    }),
    defineOp({
      name: 'perf_profile',
      title: 'CPU profile',
      description:
        "Where the app's CPU time goes: sampling for `seconds` (the app must be debuggable or profileable), the functions that take the most. Optionally scrolls during the recording.",
      input: z
        .object({
          device: Device,
          app: App,
          seconds: z.number().int().min(1).max(30).default(3),
          scroll: z.enum(['up', 'down']).optional(),
        })
        .strict(),
      output: ProfileOut,
      annotations: READ,
      needs: 'cpuProfile',
      run: async ({ device, app, seconds, scroll }) => {
        const s = await ctx.session(device);
        const pkg = appOf(s, app);
        const profile = measure(s, 'cpuProfile');
        const during = scroll ? await scroller(s, scroll, 300) : undefined;
        const m = await profile(pkg, seconds * 1000, during).catch(refused);
        if (scroll) s.acted();
        const saved = await save('cpu-profile', [m], m.value);
        return reply(
          [
            `measurement ${saved.id}${relative(s)}`,
            `${m.value.samples} samples, ${m.value.durationMs} ms; the most time:`,
            ...m.value.top.slice(0, 10).map((e) => `%${e.percent} ${e.symbol}`),
            ...(m.value.appTop?.length
              ? [
                  "the app's own functions (with what they call):",
                  ...m.value.appTop.slice(0, 10).map((e) => `%${e.percent} ${e.symbol}`),
                ]
              : []),
            `raw output: ${saved.txt}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            samples: m.value.samples,
            top: m.value.top.map((e) => ({ percent: e.percent, symbol: e.symbol })),
            ...(m.value.appTop && {
              appTop: m.value.appTop.map((e) => ({ percent: e.percent, symbol: e.symbol })),
            }),
          },
        );
      },
    }),
    defineOp({
      name: 'perf_heap',
      title: 'Heap dump',
      description:
        "The app's heap into a file on this machine (Android: Java HPROF, opened with a memory analyser; iOS simulator: an Xcode memory graph and the leak count). For a suspected leak, after perf_scroll.",
      input: z.object({ device: Device, app: App }).strict(),
      output: HeapOut,
      annotations: READ,
      needs: 'heap',
      run: async ({ device, app }) => {
        const s = await ctx.session(device);
        const pkg = appOf(s, app);
        const dump = measure(s, 'heap');
        await mkdir(ctx.measurementsDir, { recursive: true });
        const m = await dump(pkg, ctx.measurementsDir).catch(refused);
        const v = m.value;
        const saved = await save(HEAP[v.kind].store, [m], v);
        return reply(
          `measurement ${saved.id}\n${HEAP[v.kind].label}: ${v.file} (${(v.bytes / 1048576).toFixed(1)} MB)${v.leaks !== undefined ? `; ${v.leaks} leaks, ${v.leakedBytes} bytes` : ''}`,
          { id: saved.id, file: v.file, bytes: v.bytes },
        );
      },
    }),
    defineOp({
      name: 'perf_trace',
      title: 'Frame trace',
      description:
        "Record the frame timeline (Android 12+: each frame's time and why it was late; iOS: animation hitches, their ratio and causes, an Instruments trace). Optionally scrolls during the recording.",
      input: z
        .object({
          device: Device,
          app: App,
          seconds: z.number().min(1).max(30).default(5),
          scroll: z.enum(['up', 'down']).optional(),
        })
        .strict(),
      output: TraceOut,
      annotations: ACT,
      needs: 'frameTrace',
      run: async ({ device, app, seconds, scroll }) => {
        const s = await ctx.session(device);
        const pkg = appOf(s, app);
        const record = measure(s, 'frameTrace');
        const during = scroll ? await scroller(s, scroll, 500) : undefined;
        const m = await record(pkg, seconds, during).catch(refused);
        if (scroll) s.acted();
        const v = m.value;
        if (v.kind === 'hitches') {
          const saved = await save('hitches', [m], v);
          const causes = Object.entries(v.causes)
            .map(([c, k]) => `${k}× ${c}`)
            .join('; ');
          return reply(
            [
              `measurement ${saved.id}${relative(s)}`,
              `${v.frames} frames; ${v.hitches} hitches of the app, ${v.hitchMs} ms in all, worst ${v.worstMs} ms; hitch ratio ${v.hitchRatio} ms/s`,
              ...(causes ? [`likely causes: ${causes}`] : []),
              `trace (Instruments): ${v.tracePath}`,
            ].join('\n'),
            {
              id: saved.id,
              raw: saved.txt,
              virtualDevice: virtual(s),
              frames: v.frames,
              hitches: v.hitches,
              hitchMs: v.hitchMs,
              worstMs: v.worstMs,
              hitchRatio: v.hitchRatio,
              tracePath: v.tracePath,
            },
          );
        }
        const saved = await save('frame-timeline', [m], v);
        return reply(
          [
            `measurement ${saved.id}${relative(s)}`,
            `${v.frames} frames; late by the app ${v.appDeadlineMissed} (${v.appJankPercent}%); any jank ${v.janky} (${v.jankyPercent}%: buffer stuffing ${v.bufferStuffing}, compositor ${v.surfaceFlinger})`,
            ...(virtual(s)
              ? [
                  "on a virtual device the compositor's jank is the display's prediction error, not the app's: look at the app's share",
                ]
              : []),
            `frame time p50 ${v.p50Ms} ms, p95 ${v.p95Ms} ms, worst ${v.worstMs} ms`,
            `raw output: ${saved.txt}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            frames: v.frames,
            appDeadlineMissed: v.appDeadlineMissed,
            appJankPercent: v.appJankPercent,
            jankyPercent: v.jankyPercent,
            p50Ms: v.p50Ms,
            p95Ms: v.p95Ms,
            worstMs: v.worstMs,
          },
        );
      },
    }),
  ];
}
