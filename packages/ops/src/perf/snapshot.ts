import type { EnergyReading, Measured } from '@appdyno/core';
import type { Metric } from '@appdyno/perf';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { holdingCondition } from '../control.js';
import { SnapshotOut } from '../schemas.js';
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
          .array(z.enum(['threads', 'network', 'energy', 'exits', 'size']))
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
      const lacking: string[] = [];
      const extra = async <T>(what: string, get: (() => Promise<T>) | undefined) => {
        if (!also.includes(what as (typeof also)[number])) return undefined;
        const got = get && (await unlessUnsupported(get()));
        if (!got) lacking.push(what);
        return got;
      };
      const threads = await extra(
        'threads',
        source.threads && (() => measure(s, 'threads')(pkg, cpuWindowMs)),
      );
      const network = await extra(
        'network',
        source.network && (() => measure(s, 'network')(pkg, cpuWindowMs)),
      );
      const energy = await extra(
        'energy',
        source.energy &&
          (() => {
            const read = () => measure(s, 'energy')(pkg, cpuWindowMs);
            // Android reads it told it runs on battery; no other platform has this condition
            return s.device.platform === 'android' ? holdingCondition(s, 'battery', read) : read();
          }),
      );
      const exits = await extra('exits', source.exits && (() => measure(s, 'exits')(pkg)));
      const size = await extra('size', source.size && (() => measure(s, 'size')(pkg)));
      const saved = await save(
        'snapshot',
        [cpu, mem, frames, vitals, threads, network, energy, exits, size].filter(
          (x): x is Measured<never> => !!x,
        ),
        {
          cpu: cpu.value,
          memory: mem.value,
          ...(frames && { frames: frames.value }),
          ...(vitals && { vitals: vitals.value }),
          ...(threads && { threads: threads.value }),
          ...(network && { network: network.value }),
          ...(energy && { energy: energy.value }),
          ...(exits && { exits: exits.value }),
          ...(size && { size: size.value }),
        },
      );
      const noise = await keep(s, pkg, scenario ?? 'idle', 'perf_snapshot', saved.txt, [
        { kind: 'cpu.percent', unit: 'percent', samples: [cpu.value.percent] },
        { kind: 'memory.kb', unit: 'kb', samples: [mem.value.kb] },
        ...(threads
          ? [
              {
                kind: 'threads.over90_ms',
                unit: 'ms' as const,
                samples: [threads.value.worstOver90Ms],
              },
            ]
          : []),
        ...(network
          ? [
              {
                kind: 'network.rx_bytes',
                unit: 'bytes' as const,
                samples: [network.value.rxBytes],
              },
              {
                kind: 'network.tx_bytes',
                unit: 'bytes' as const,
                samples: [network.value.txBytes],
              },
            ]
          : []),
        ...(energy ? energyMetrics(energy.value) : []),
        ...(exits
          ? [
              { kind: 'exits.crashes', unit: 'count' as const, samples: [exits.value.crashes] },
              {
                kind: 'exits.anrs',
                unit: 'count' as const,
                samples: exits.value.anrs === undefined ? [] : [exits.value.anrs],
              },
            ]
          : []),
        ...(size
          ? [{ kind: 'size.bytes', unit: 'bytes' as const, samples: [size.value.bytes] }]
          : []),
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
          ...(threads
            ? [
                `threads: ${threads.value.threads
                  .slice(0, 5)
                  .map(
                    (t) =>
                      `${t.name} ${t.percent}%${t.over90Ms ? ` (${t.over90Ms} ms above 90 %)` : ''}`,
                  )
                  .join(', ')}`,
              ]
            : []),
          ...(network
            ? [
                `network: ${network.value.rxBytes} bytes in, ${network.value.txBytes} out${network.value.note ? ` (${network.value.note})` : ''}`,
              ]
            : []),
          ...(energy ? [energyText(energy.value)] : []),
          ...(exits
            ? [
                `exits: ${exits.value.crashes} crashes${exits.value.anrs === undefined ? '' : `, ${exits.value.anrs} ANRs`} of ${exits.value.total}`,
              ]
            : []),
          ...(size ? [`size: ${(size.value.bytes / 1048576).toFixed(1)} MB`] : []),
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
          ...(threads && { threads: threads.value.threads.slice(0, 10) }),
          ...(network && { rxBytes: network.value.rxBytes, txBytes: network.value.txBytes }),
          ...(energy?.value.mah !== undefined && { energyMah: energy.value.mah }),
          ...(energy?.value.mj !== undefined && { energyMj: energy.value.mj }),
          ...(energy?.value.impact !== undefined && { energyImpact: energy.value.impact }),
          ...(energy && { energyModelled: energy.value.modelled === true }),
          ...(exits && { crashes: exits.value.crashes, anrs: exits.value.anrs }),
          ...(size && { sizeBytes: size.value.bytes }),
          ...(lacking.length && { lacking }),
          noise,
        },
      );
    },
  });
}
