import type { CpuProfile } from '@appdyno/core';
import {
  functionDiff,
  loadMeasurement,
  writeDashboard,
  runKeys,
  latestRuns,
  saveBaseline,
  addToBaseline,
  loadBaseline,
  loadBudgets,
  type KeyReport,
  type PerfRecord,
  reportKey,
  exitCode,
  toJson,
  toJUnit,
  toText,
} from '@appdyno/perf';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { CompareOut } from './schemas.js';
import { defineOp, READ, reply, ToolError } from '../tool.js';
import { Scenario, rewriteDashboard } from './shared.js';

const MeasurementId = z.string().max(40).optional().describe('a perf_profile id');

export function perfCompareOp(ctx: ServerContext) {
  return defineOp({
    name: 'perf_compare',
    title: 'Compare with the baseline',
    description:
      'The newest runs against the baseline and budgets in .appdyno/perf/; a change counts only when statistically and practically significant. budget: budgets only; baseline: adds the newest run, `replace` starts over; dashboard: writes the page; functions: what moved between two perf_profile ids. No device needed.',
    input: z
      .object({
        action: z
          .enum(['compare', 'budget', 'baseline', 'dashboard', 'functions'])
          .default('compare'),
        from: MeasurementId,
        to: MeasurementId,
        app: z.string().max(200).optional(),
        scenario: Scenario,
        deviceClass: z.string().max(200).optional(),
        last: z.number().int().min(1).max(20).default(1).describe('newest runs to pool'),
        replace: z.boolean().optional(),
        format: z.enum(['text', 'json', 'junit']).default('text'),
      })
      .strict(),
    output: CompareOut,
    annotations: READ,
    run: async ({ action, from, to, app, scenario, deviceClass, last, replace, format }) => {
      const dir = ctx.measurementsDir;
      const project = ctx.perfDir;
      if (action === 'functions') {
        const profile = async (id: string | undefined) => {
          const held = id ? await loadMeasurement<CpuProfile>(dir, id) : undefined;
          if (held?.kind !== 'cpu-profile')
            throw new ToolError(
              `give from and to: the ids perf_profile answered${id ? `; ${id} is no profile kept here` : ''}`,
              'NOT_FOUND',
            );
          return held.value;
        };
        const functions = functionDiff(await profile(from), await profile(to));
        return reply(
          [
            `functions, ms of CPU in each second, ${from} to ${to}:`,
            ...(functions.length
              ? functions
                  .slice(0, 15)
                  .map(
                    (f) =>
                      `${f.changeMs > 0 ? '+' : ''}${f.changeMs} ${f.symbol} (${f.beforeMs} to ${f.afterMs})`,
                  )
              : ['no function moved past the floor of 20 ms a second and a quarter of itself']),
          ].join('\n'),
          { failed: false, exitCode: 0, reports: [], functions: functions.slice(0, 50) },
        );
      }
      if (action === 'dashboard') {
        const file = await writeDashboard(dir, project, app ? { app } : {});
        return reply(`dashboard: ${file}`, { failed: false, exitCode: 0, reports: [], file });
      }
      const keys = await runKeys(dir, {
        ...(app && { app }),
        ...(scenario && { scenario }),
        ...(deviceClass && { deviceClass }),
      });
      if (keys.length === 0)
        throw new ToolError('no measured runs: run a perf_ operation first', 'NOT_FOUND');
      if (action === 'baseline') {
        const lines: string[] = [];
        const files: string[] = [];
        let left = 0;
        for (const k of keys) {
          const [newest = []] = await latestRuns(dir, k);
          // a reference taken under load would hide every later change; a number of the device's own in the same run stands
          const loudOf = (r: PerfRecord) => r.noise.filter((n) => n !== 'debuggable-build');
          const clean = newest.filter((r) => loudOf(r).length === 0);
          const noisy = newest.filter((r) => loudOf(r).length > 0);
          const said = [...new Set(noisy.flatMap(loudOf))].join(', ');
          if (clean.length === 0) {
            left++;
            lines.push(`not added, ${said}: measure ${k.scenario} again`);
            continue;
          }
          const file = await saveBaseline(
            project,
            addToBaseline(k, await loadBaseline(project, k), clean, replace),
          );
          files.push(file);
          lines.push(
            `baseline: ${file}`,
            ...(noisy.length ? [`left out, ${said}: ${noisy.map((r) => r.kind).join(', ')}`] : []),
          );
        }
        await rewriteDashboard(ctx);
        return reply(lines.join('\n'), {
          failed: left > 0,
          exitCode: left > 0 ? 1 : 0,
          reports: [],
          baselines: files,
        });
      }
      const rules = await loadBudgets(project);
      const reports: KeyReport[] = await Promise.all(
        keys.map(async (k) => {
          const r = reportKey(
            k,
            await latestRuns(dir, k, last),
            await loadBaseline(project, k),
            rules,
          );
          return action === 'budget' ? { ...r, comparisons: [] } : r;
        }),
      );
      const code = exitCode(reports);
      const out =
        format === 'json'
          ? toJson(reports)
          : format === 'junit'
            ? toJUnit(reports)
            : toText(reports);
      return reply(out, { failed: code !== 0, exitCode: code, reports });
    },
  });
}
