import type { Capability, EnergyReading, Measured } from '@appdyno/core';
import type { Metric } from '@appdyno/perf';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { holdingCondition } from '../control.js';
import { SnapshotOut } from '../schemas.js';
import type { Session } from '../session.js';
import { type Op, defineOp, READ, reply } from '../tool.js';
import { perfTools, App, Scenario, unlessUnsupported, kb, virtual } from './shared.js';

/** A device's energy in the unit it has it in: a charge, a count of energy, or a score. */
const ENERGY_KINDS = [
  { field: 'mah', kind: 'energy.mah', unit: 'mah', says: 'mAh' },
  { field: 'mj', kind: 'energy.mj', unit: 'mj', says: 'mJ' },
  { field: 'impact', kind: 'energy.impact', unit: 'ratio', says: 'power impact' },
] as const;

const energyMetrics = (v: EnergyReading): Metric[] =>
  ENERGY_KINDS.flatMap(({ field, kind, unit }) =>
    v[field] === undefined
      ? []
      : [{ kind, unit, samples: [v[field]], ...(v.modelled && { modelled: true }) }],
  );

const energyText = (v: EnergyReading) =>
  `energy${v.modelled ? ' (a model)' : ''}: ${ENERGY_KINDS.flatMap(({ field, says }) =>
    v[field] === undefined ? [] : [`${v[field]} ${says}`],
  ).join(', ')}; ${v.note}`;

type Asked = {
  s: Session;
  pkg: string;
  windowMs: number;
  measure: ReturnType<typeof perfTools>['measure'];
};

/** The device's read of this, if it has one. */
const reads = <K extends Capability>(k: K, a: Asked) =>
  a.s.device.measure?.[k] && a.measure(a.s, k);

type Got = {
  measured: Measured<unknown>;
  metrics: Metric[];
  line: string;
  data: Record<string, unknown>;
};

/** One thing `also` can ask for: how it is read, then what is kept of it, said of it and answered. */
const extra =
  <T>(x: {
    read: (a: Asked) => Promise<Measured<T>> | undefined;
    metrics: (v: T) => Metric[];
    line: (v: T) => string;
    data: (v: T) => Record<string, unknown>;
  }) =>
  async (a: Asked): Promise<Got | undefined> => {
    const read = x.read(a);
    const m = read && (await unlessUnsupported(read));
    return (
      m && {
        measured: m,
        metrics: x.metrics(m.value),
        line: x.line(m.value),
        data: x.data(m.value),
      }
    );
  };

const EXTRAS = {
  threads: extra({
    read: (a) => reads('threads', a)?.(a.pkg, a.windowMs),
    metrics: (v) => [{ kind: 'threads.over90_ms', unit: 'ms', samples: [v.worstOver90Ms] }],
    line: (v) =>
      `threads: ${v.threads
        .slice(0, 5)
        .map((t) => `${t.name} ${t.percent}%${t.over90Ms ? ` (${t.over90Ms} ms above 90 %)` : ''}`)
        .join(', ')}`,
    data: (v) => ({ threads: v.threads.slice(0, 10) }),
  }),
  network: extra({
    read: (a) => reads('network', a)?.(a.pkg, a.windowMs),
    metrics: (v) => [
      { kind: 'network.rx_bytes', unit: 'bytes', samples: [v.rxBytes] },
      { kind: 'network.tx_bytes', unit: 'bytes', samples: [v.txBytes] },
    ],
    line: (v) => `network: ${v.rxBytes} bytes in, ${v.txBytes} out${v.note ? ` (${v.note})` : ''}`,
    data: (v) => ({ rxBytes: v.rxBytes, txBytes: v.txBytes }),
  }),
  energy: extra({
    read: (a) => {
      const read = reads('energy', a);
      if (!read) return undefined;
      const now = () => read(a.pkg, a.windowMs);
      // Android reads it told it runs on battery; no other platform has this condition
      return a.s.device.platform === 'android' ? holdingCondition(a.s, 'battery', now) : now();
    },
    metrics: energyMetrics,
    line: energyText,
    data: (v) => ({
      ...(v.mah !== undefined && { energyMah: v.mah }),
      ...(v.mj !== undefined && { energyMj: v.mj }),
      ...(v.impact !== undefined && { energyImpact: v.impact }),
      energyModelled: v.modelled === true,
    }),
  }),
  exits: extra({
    read: (a) => reads('exits', a)?.(a.pkg),
    metrics: (v) => [
      { kind: 'exits.crashes', unit: 'count', samples: [v.crashes] },
      { kind: 'exits.anrs', unit: 'count', samples: v.anrs === undefined ? [] : [v.anrs] },
    ],
    line: (v) =>
      `exits: ${v.crashes} crashes${v.anrs === undefined ? '' : `, ${v.anrs} ANRs`} of ${v.total}`,
    data: (v) => ({ crashes: v.crashes, anrs: v.anrs }),
  }),
  size: extra({
    read: (a) => reads('size', a)?.(a.pkg),
    metrics: (v) => [{ kind: 'size.bytes', unit: 'bytes', samples: [v.bytes] }],
    line: (v) => `size: ${(v.bytes / 1048576).toFixed(1)} MB`,
    data: (v) => ({ sizeBytes: v.bytes }),
  }),
};

type ExtraName = keyof typeof EXTRAS;

/** All of them, in the order an answer gives them. */
export const EXTRA_NAMES = Object.keys(EXTRAS) as [ExtraName, ...ExtraName[]];

export function perfSnapshotOp(ctx: ServerContext): Op {
  const { measure, appOf, virtualNote, save, keep, noisy } = perfTools(ctx);
  return defineOp({
    name: 'perf_snapshot',
    title: 'Performance snapshot',
    description:
      "The app's CPU now, memory, frames since the last measure and the device's load and heat. The measurement id and raw output are kept.",
    input: z
      .object({
        app: App,
        cpuWindowMs: z.number().int().min(500).max(10_000).default(2_000),
        also: z
          .array(z.enum(EXTRA_NAMES))
          .optional()
          .describe(
            'threads: each with its time above 90 %; network: bytes; energy: says if a model; exits: crashes, ANRs; size: on disk',
          ),
        scenario: Scenario,
      })
      .strict(),
    output: SnapshotOut,
    annotations: READ,
    needs: 'cpu',
    run: async ({ app, cpuWindowMs, also = [], scenario }) => {
      const s = await ctx.session();
      s.appPid = undefined;
      const pkg = appOf(s, app);
      const readCpu = measure(s, 'cpu');
      const readMemory = measure(s, 'memory');
      const cpu = await readCpu(pkg, cpuWindowMs);
      const mem = await readMemory(pkg);
      const source = s.device.measure!;
      const frames = source.frames && (await unlessUnsupported(source.frames(pkg)));
      const vitals = await source.vitals?.();
      const asked = { s, pkg, windowMs: cpuWindowMs, measure };
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
      const noise = await keep(s, pkg, scenario ?? 'idle', 'perf_snapshot', saved.txt, [
        { kind: 'cpu.percent', unit: 'percent', samples: [cpu.value.percent] },
        { kind: 'memory.kb', unit: 'kb', samples: [mem.value.kb] },
        ...got.flatMap((g) => g.metrics),
      ]);
      const m = mem.value;
      const f = frames?.value;
      const v = vitals?.value;
      return reply(
        [
          `measurement ${saved.id}${virtualNote(s)}`,
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
            : [
                virtual(s)
                  ? 'no frame measure on a simulator without the probe'
                  : 'no frame counter on a phone: perf_scroll and perf_trace record its hitches',
              ]),
          ...(f?.limits ? [f.limits] : []),
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
          ...Object.fromEntries(got.flatMap((g) => Object.entries(g.data))),
          ...(lacking.length && { lacking }),
          noise,
        },
      );
    },
  });
}
