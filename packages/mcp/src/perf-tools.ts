import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CpuProfile, Measured, ProfileEntry } from 'appdyno';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { checkApp } from './policy.js';
import { refused, type DriveableDevice, type Session } from './session.js';
import { HeapOut, LaunchOut, ProfileOut, ScrollOut, SnapshotOut, TraceOut } from './schemas.js';
import { ACT, DESTRUCTIVE, READ, reply, ToolError, type Tool, type ToolResult } from './tool.js';
import { swipeLine } from './tools.js';

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

const tool = <S extends z.ZodObject>(
  title: string,
  description: string,
  input: S,
  output: z.ZodObject,
  annotations: Tool['annotations'],
  handler: (args: z.infer<S>) => Promise<ToolResult>,
): Tool => ({
  title,
  description,
  input,
  output,
  annotations,
  handler: handler as Tool['handler'],
});

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

export function perfTools(ctx: ServerContext, measurementsDir: string): Record<string, Tool> {
  const appOf = (s: Session, app?: string) => {
    const pkg = checkApp(ctx.policy, app ?? s.appId ?? '');
    if (!pkg) throw new ToolError('give app (or select one with use_device)');
    return pkg;
  };
  const virtual = (s: Session) => s.device.platform === 'ios' || /^emulator-/.test(s.device.serial);
  const relative = (s: Session) =>
    virtual(s) ? ' (virtual device: relative, compare only with the same kind of device)' : '';
  const save = async (kind: string, m: Measured<unknown>[], value: unknown) =>
    store(measurementsDir, kind, value, m.map((x) => `## ${x.at}\n${x.raw}`).join('\n\n'));

  return {
    perf_snapshot: tool(
      'Performance snapshot',
      "The app's CPU now (2 s), its memory, its frames since the last measure and the device's state (load, heat). The measurement id and the raw output are kept.",
      z
        .object({
          device: Device,
          app: App,
          cpuWindowMs: z.number().int().min(500).max(10_000).default(2_000),
        })
        .strict(),
      SnapshotOut,
      READ,
      async ({ device, app, cpuWindowMs }) => {
        const s = await ctx.session(device);
        const pkg = appOf(s, app);
        if (s.device.iosPerf) {
          const cpu = await s.device.iosPerf.cpu(pkg, cpuWindowMs).catch(refused);
          const mem = await s.device.iosPerf.memory(pkg).catch(refused);
          const saved = await save('snapshot', [cpu, mem], { cpu: cpu.value, memory: mem.value });
          return reply(
            [
              `measurement ${saved.id}${relative(s)}`,
              `CPU: ${cpu.value.percent}% (of one core, ${cpu.value.windowMs} ms)`,
              `memory: physical footprint ${kb(mem.value.footprintKb)}${mem.value.peakKb !== undefined ? ` (peak ${kb(mem.value.peakKb)})` : ''}`,
              'no frame measure on a simulator',
              `raw output: ${saved.txt}`,
            ].join('\n'),
            {
              id: saved.id,
              raw: saved.txt,
              virtualDevice: virtual(s),
              cpuPercent: cpu.value.percent,
              footprintKb: mem.value.footprintKb,
            },
          );
        }
        const perf = perfOf(s.device);
        const [cpu, mem, frames, vitals] = [
          await perf.cpu(pkg, cpuWindowMs).catch(refused),
          await perf.memory(pkg).catch(refused),
          await perf.frames(pkg).catch(refused),
          await perf.vitals().catch(refused),
        ];
        const value = {
          cpu: cpu.value,
          memory: mem.value,
          frames: frames.value,
          vitals: vitals.value,
        };
        const saved = await save('snapshot', [cpu, mem, frames, vitals], value);
        const f = frames.value;
        return reply(
          [
            `measurement ${saved.id}${relative(s)}`,
            `CPU: ${cpu.value.percent}% (of one core, ${cpu.value.windowMs} ms)`,
            `memory: PSS ${kb(mem.value.pssKb)}, Java ${kb(mem.value.javaHeapKb)}, native ${kb(mem.value.nativeHeapKb)}, graphics ${kb(mem.value.graphicsKb)}`,
            `frames (since the last reset): ${f.totalFrames}, janky ${f.jankyPercent}%, frozen ${f.frozenFrames}${f.p95Ms !== undefined ? `, p95 ${f.p95Ms} ms` : ''}${f.fewFrames ? ' (few frames: the share means little)' : ''}`,
            ...(f.frames?.worstWindow
              ? [
                  `worst second: ${f.frames.worstWindow.slow} missed of ${f.frames.worstWindow.frames} frames, mean ${f.frames.worstWindow.avgMs} ms`,
                ]
              : []),
            `device: load ${vitals.value.load?.join(' ') ?? '?'}, CPU pressure ${vitals.value.cpuPressure ?? '?'}, thermal ${vitals.value.thermalStatus ?? '?'}`,
            `raw output: ${saved.txt}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            cpuPercent: cpu.value.percent,
            pssKb: mem.value.pssKb,
            ...(mem.value.javaHeapKb !== undefined && { javaHeapKb: mem.value.javaHeapKb }),
            ...(mem.value.nativeHeapKb !== undefined && { nativeHeapKb: mem.value.nativeHeapKb }),
            frames: {
              total: f.totalFrames,
              jankyPercent: f.jankyPercent,
              frozen: f.frozenFrames,
              ...(f.p95Ms !== undefined && { p95Ms: f.p95Ms }),
            },
            ...(vitals.value.load && { deviceLoad: vitals.value.load }),
          },
        );
      },
    ),
    perf_scroll: tool(
      'Scroll performance',
      'Measure frames and memory while scrolling a list: each round resets the frames, swipes `swipes` times, and reads frames and memory once the list stops. Up or down only.',
      z
        .object({
          device: Device,
          app: App,
          direction: z.enum(['up', 'down']).default('up'),
          swipes: z.number().int().min(1).max(10).default(5),
          repeats: z.number().int().min(1).max(5).default(3),
        })
        .strict(),
      ScrollOut,
      ACT,
      async ({ device, app, direction, swipes, repeats }) => {
        const s = await ctx.session(device);
        const pkg = appOf(s, app);
        const perf = perfOf(s.device);
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
          const m0 = await perf.memory(pkg).catch(refused);
          await perf.resetFrames(pkg).catch(refused);
          for (let i = 0; i < swipes; i++) {
            const { from, to } = swipeLine(size, { direction, distance: size.h * 0.4 });
            await s.device.swipe(from, to, 300, { settle: false }).catch(refused);
          }
          await new Promise((x) => setTimeout(x, 1_500));
          const f = await perf.frames(pkg).catch(refused);
          const m1 = await perf.memory(pkg).catch(refused);
          all.push(m0, f, m1);
          rounds.push({
            jankyPercent: f.value.jankyPercent,
            frozen: f.value.frozenFrames,
            frames: f.value.totalFrames,
            ...(f.value.p95Ms !== undefined && { p95Ms: f.value.p95Ms }),
            memStartKb: m0.value.pssKb,
            memEndKb: m1.value.pssKb,
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
    ),
    perf_launch: tool(
      'Launch time',
      "The app's launch time: cold (stopped, then started) or warm (back from the background); the first launch warms up, then `repeats` launches, median. The app restarts.",
      z
        .object({
          device: Device,
          app: App,
          mode: z.enum(['cold', 'warm']).default('cold'),
          repeats: z.number().int().min(1).max(10).default(3),
        })
        .strict(),
      LaunchOut,
      DESTRUCTIVE,
      async ({ device, app, mode, repeats }) => {
        const s = await ctx.session(device);
        const pkg = appOf(s, app);
        if (s.device.iosPerf) {
          const m = await s.device.iosPerf.launch(pkg, { mode, repeats }).catch(refused);
          s.acted();
          const saved = await save('launch', [m], m.value);
          const med = m.value.medianMs;
          return reply(
            [
              `measurement ${saved.id}${relative(s)}`,
              `${mode} launch (until the first screen is read): ${m.value.samplesMs.map((x) => `${x} ms`).join(', ')}`,
              `median: ${med} ms`,
              `raw output: ${saved.txt}`,
            ].join('\n'),
            {
              id: saved.id,
              raw: saved.txt,
              virtualDevice: virtual(s),
              mode,
              samples: m.value.samplesMs.map((x) => ({ totalMs: x })),
              medianMs: med,
              excessive: med >= (mode === 'cold' ? 5_000 : 2_000),
            },
          );
        }
        const m = await perfOf(s.device).launch(pkg, { mode, repeats }).catch(refused);
        s.acted();
        const saved = await save('launch', [m], m.value);
        const limit = mode === 'cold' ? 5_000 : 2_000; // Android vitals: excessive cold ≥ 5 s, warm ≥ 2 s
        const med = m.value.medianMs;
        return reply(
          [
            `measurement ${saved.id}${relative(s)}`,
            `${mode} launch: ${m.value.samples.map((x) => `${x.totalMs ?? '?'} ms (${x.state ?? '?'})`).join(', ')}`,
            `median: ${med === undefined ? 'not measured' : `${med} ms`}${med !== undefined && med >= limit ? ` (excessive: threshold ${limit} ms)` : ''}`,
            `raw output: ${saved.txt}`,
          ].join('\n'),
          {
            id: saved.id,
            raw: saved.txt,
            virtualDevice: virtual(s),
            mode,
            samples: m.value.samples.map((x) => ({
              ...(x.totalMs !== undefined && { totalMs: x.totalMs }),
              ...(x.state && { state: x.state }),
            })),
            ...(med !== undefined && { medianMs: med }),
            excessive: med !== undefined && med >= limit,
          },
        );
      },
    ),
    perf_profile: tool(
      'CPU profile',
      "Where the app's CPU time goes: sampling for `seconds` (the app must be debuggable or profileable), the functions that take the most. Optionally scrolls during the recording.",
      z
        .object({
          device: Device,
          app: App,
          seconds: z.number().int().min(1).max(30).default(3),
          scroll: z.enum(['up', 'down']).optional(),
        })
        .strict(),
      ProfileOut,
      READ,
      async ({ device, app, seconds, scroll }) => {
        const s = await ctx.session(device);
        const pkg = appOf(s, app);
        const h = s.device.hello!;
        const size = (await s.current()).window ?? { w: h.screen.w, h: h.screen.h };
        const during = scroll
          ? async () => {
              await new Promise((x) => setTimeout(x, 300));
              for (let i = 0; i < 4; i++) {
                const { from, to } = swipeLine(size, { direction: scroll, distance: size.h * 0.4 });
                await s.device.swipe(from, to, 300, { settle: false });
              }
            }
          : undefined;
        const m: Measured<CpuProfile & { appTop?: ProfileEntry[] }> = await (
          s.device.iosPerf ?? perfOf(s.device)
        )
          .cpuProfile(pkg, seconds * 1000, during)
          .catch(refused);
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
    ),
    perf_heap: tool(
      'Heap dump',
      "The app's heap into a file on this machine (Android: Java HPROF, opened with a memory analyser; iOS simulator: an Xcode memory graph and the leak count). For a suspected leak, after perf_scroll.",
      z.object({ device: Device, app: App }).strict(),
      HeapOut,
      READ,
      async ({ device, app }) => {
        const s = await ctx.session(device);
        const pkg = appOf(s, app);
        await mkdir(measurementsDir, { recursive: true });
        if (s.device.iosPerf) {
          const file = join(measurementsDir, `heap-${pkg}-${Date.now()}.memgraph`);
          const m = await s.device.iosPerf.heapGraph(pkg, file).catch(refused);
          const saved = await save('heap-graph', [m], m.value);
          return reply(
            `measurement ${saved.id}\nmemory graph (Xcode): ${m.value.file} (${(m.value.bytes / 1048576).toFixed(1)} MB)${m.value.leaks !== undefined ? `; ${m.value.leaks} leaks, ${m.value.leakedBytes} bytes` : ''}`,
            { id: saved.id, file: m.value.file, bytes: m.value.bytes },
          );
        }
        const file = join(measurementsDir, `heap-${pkg}-${Date.now()}.hprof`);
        const m = await perfOf(s.device).heapDump(pkg, file).catch(refused);
        const saved = await save('heap-dump', [m], m.value);
        return reply(
          `measurement ${saved.id}\nheap dump: ${m.value.file} (${(m.value.bytes / 1048576).toFixed(1)} MB)`,
          { id: saved.id, file: m.value.file, bytes: m.value.bytes },
        );
      },
    ),
    perf_trace: tool(
      'Frame trace',
      "Record the frame timeline (Android 12+: each frame's time and why it was late; iOS: animation hitches, their ratio and causes, an Instruments trace). Optionally scrolls during the recording.",
      z
        .object({
          device: Device,
          app: App,
          seconds: z.number().min(1).max(30).default(5),
          scroll: z.enum(['up', 'down']).optional(),
        })
        .strict(),
      TraceOut,
      ACT,
      async ({ device, app, seconds, scroll }) => {
        const s = await ctx.session(device);
        const pkg = appOf(s, app);
        const h = s.device.hello!;
        const size = (await s.current()).window ?? { w: h.screen.w, h: h.screen.h };
        const during = scroll
          ? async () => {
              await new Promise((x) => setTimeout(x, 500));
              for (let i = 0; i < 4; i++) {
                const { from, to } = swipeLine(size, { direction: scroll, distance: size.h * 0.4 });
                await s.device.swipe(from, to, 300, { settle: false });
              }
            }
          : undefined;
        if (s.device.hitches) {
          const v = await s.device.hitches(pkg, seconds, during).catch(refused);
          if (scroll) s.acted();
          const saved = await save(
            'hitches',
            [{ value: v, raw: v.tracePath, at: new Date().toISOString() }],
            v,
          );
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
        const m = await perfOf(s.device)
          .frameTimeline(pkg, seconds * 1000, during)
          .catch(refused);
        if (scroll) s.acted();
        const saved = await save('frame-timeline', [m], m.value);
        const v = m.value;
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
    ),
  };
}

/** The device's performance tools; an iOS simulator has none yet. */
function perfOf(d: DriveableDevice) {
  if (!d.perf)
    throw new ToolError(
      `no performance measures on ${d.platform === 'ios' ? 'iOS' : d.platform} here yet`,
    );
  return d.perf;
}
