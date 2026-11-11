import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { SnapshotOut } from './schemas.js';
import { defineOp, READ, reply } from '../tool.js';
import { EXTRA_NAMES, EXTRAS, type Answered, type ExtraName, type Got } from './extras.js';
import { perfTools, App, Scenario, unlessUnsupported, kb } from './shared.js';
import { frameVitals } from './vitals.js';

export function perfSnapshotOp(ctx: ServerContext) {
  const { measure, measuredApp, virtualNote, save, keep, noisy } = perfTools(ctx);
  return defineOp({
    name: 'perf_snapshot',
    title: 'Performance snapshot',
    description:
      "Performance now: the app's CPU, memory, frames since the last measure and the device's load and heat.",
    input: z
      .object({
        app: App,
        cpuWindowMs: z.number().int().min(500).max(10_000).default(2_000),
        also: z
          .array(z.enum(EXTRA_NAMES))
          .optional()
          .describe(
            'energy (says if a model); anonMemory: by process state, bitmaps; surface: a SurfaceView or game; startInfo: why it last started; battery: wake locks, wakeups, jobs',
          ),
        batteryWindowMs: z.number().int().min(1_000).max(600_000).default(30_000),
        scenario: Scenario,
      })
      .strict(),
    output: SnapshotOut,
    annotations: READ,
    run: async ({ app, cpuWindowMs, batteryWindowMs, also = [], scenario }) => {
      const s = await ctx.session();
      const pkg = measuredApp(s, app);
      const readCpu = measure(s, 'cpu');
      const readMemory = measure(s, 'memory');
      const cpu = await readCpu(pkg, cpuWindowMs);
      const behind = cpu.value.behind;
      const mem = await readMemory(pkg);
      const source = s.device.measure;
      const frames = await unlessUnsupported(source.frames(pkg));
      const vitals = await unlessUnsupported(source.vitals());
      const keptAs = scenario ?? 'idle';
      const asked = {
        ctx,
        s,
        pkg,
        scenario: keptAs,
        windowMs: cpuWindowMs,
        batteryMs: batteryWindowMs,
        measure,
      };
      const lacking: ExtraName[] = [];
      const got: (Got & { name: ExtraName })[] = [];
      for (const name of EXTRA_NAMES) {
        if (!also.includes(name)) continue;
        const x = await EXTRAS[name](asked);
        if (x) got.push({ ...x, name });
        else lacking.push(name);
      }
      const saved = await save(
        'snapshot',
        [cpu, mem, frames, vitals, ...got.map((g) => g.measured)].flatMap((x) => x ?? []),
        {
          cpu: cpu.value,
          memory: mem.value,
          ...(frames && { frames: frames.value }),
          ...(vitals && { vitals: vitals.value }),
          ...Object.fromEntries(got.map((g) => [g.name, g.measured.value])),
        },
      );
      const f = frames?.value;
      const play = frameVitals(f?.histogram ? [f.histogram] : []);
      const noise = await keep(s, {
        app: pkg,
        scenario: keptAs,
        source: 'perf_snapshot',
        raw: saved.txt,
        startedNs: got.find((g) => g.startedNs !== undefined)?.startedNs,
        metrics: [
          ...(behind
            ? []
            : [
                {
                  kind: 'cpu.percent' as const,
                  unit: 'percent' as const,
                  samples: [cpu.value.percent],
                },
              ]),
          { kind: 'memory.kb', unit: 'kb', samples: [mem.value.kb] },
          ...play.metrics,
          ...got.flatMap((g) => g.metrics),
        ],
      });
      const m = mem.value;
      const v = vitals?.value;
      return reply(
        [
          `measurement ${saved.id}${virtualNote(s)}`,
          `CPU: ${cpu.value.percent}% (of one core, ${cpu.value.windowMs} ms)${behind ? `, with ${behind} in front: a phone stops an app behind, so this says nothing of it and is not kept` : ''}`,
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
            : [
                source.framesByProbe
                  ? 'no frame measure on a simulator without the probe'
                  : s.device.virtual
                    ? 'no frame counter on this virtual device'
                    : 'no frame counter on a phone: perf_scroll and perf_trace record its hitches',
              ]),
          ...(f?.limits ? [f.limits] : []),
          ...(f?.histogram && f.frozenFrames > 0
            ? [
                "frozen frames here are the system's summary, which on some phones counts a stall more than once: perf_scroll reads them from the frame rows",
              ]
            : []),
          ...play.lines,
          ...(v
            ? [
                `device: load ${v.load?.join(' ') ?? '?'}${v.parkedKernelThreads ? ` (${v.parkedKernelThreads} of it kernel threads asleep, no CPU)` : ''}, CPU pressure ${v.cpuPressure ?? '?'}, thermal ${v.thermalStatus ?? '?'}`,
              ]
            : []),
          ...got.map((g) => g.line),
          ...(lacking.length ? [`not measurable here: ${lacking.join(', ')}`] : []),
          ...noisy(noise),
          `raw output: ${saved.txt}`,
        ].join('\n'),
        {
          id: saved.id,
          raw: saved.txt,
          virtualDevice: s.device.virtual,
          cpuPercent: cpu.value.percent,
          ...(behind && { cpuBehind: behind }),
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
              ...play.shares,
            },
          }),
          ...(v?.load && { deviceLoad: v.load }),
          ...got.reduce<Answered>((all, g) => ({ ...all, ...g.data }), {}),
          ...(lacking.length && { lacking }),
          noise,
        },
      );
    },
  });
}
