import { stateDir, type CpuProfile } from '@appdyno/core';
import {
  answerText,
  functionDiff,
  loadMeasurement,
  pinBaseline,
  writeDashboard,
  runKeys,
  latestRuns,
  loudOf,
  saveBaseline,
  addToBaseline,
  loadBaseline,
  loadBudgets,
  MIN_BASELINE_RUNS,
  runsIn,
  type KeyReport,
  reportKey,
  exitCode,
  toJson,
  toJUnit,
  toText,
} from '@appdyno/perf';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import type { FlowRunner } from '../flow/runner.js';
import { CompareOut } from './schemas.js';
import { DESTRUCTIVE, defineOp, reply, ToolError } from '../tool.js';
import { Scenario, pruneNow, rewriteDashboard } from './shared.js';
import { gateLooks } from './why.js';

const MeasurementId = z.string().max(40).optional();

export function perfCompareOp(ctx: ServerContext, runner: FlowRunner) {
  return defineOp({
    name: 'perf_compare',
    title: 'Compare with the baseline',
    description:
      "The newest runs against baseline and budgets in .appdyno/perf/; a change must be statistically and practically significant. why: finds a regression's cause on device; reference: its other side, on baseline's build; budget; baseline: adds the newest, `replace` resets; dashboard; functions: two perf_profile ids; prune: traces.",
    input: z
      .object({
        action: z
          .enum([
            'compare',
            'why',
            'reference',
            'budget',
            'baseline',
            'dashboard',
            'functions',
            'prune',
          ])
          .default('compare'),
        limitGb: z.number().min(0).max(10_000).optional(),
        dryRun: z.boolean().optional(),
        from: MeasurementId,
        to: MeasurementId,
        app: z.string().max(200).optional(),
        scenario: Scenario,
        deviceClass: z.string().max(200).optional(),
        last: z.number().int().min(1).max(20).default(1).describe('newest runs to use'),
        replace: z.boolean().optional(),
        format: z.enum(['text', 'json', 'junit']).default('text'),
        dsym: z.string().max(1_000).optional(),
      })
      .strict(),
    output: CompareOut,
    // the worst of its actions: `why` and `reference` replay a flow and restart the app
    annotations: DESTRUCTIVE,
    run: async ({
      action,
      limitGb,
      dryRun,
      from,
      to,
      app,
      scenario,
      deviceClass,
      last,
      replace,
      format,
      dsym,
    }) => {
      const looks = gateLooks(ctx, runner, dsym);
      const dir = ctx.measurementsDir;
      const project = ctx.perfDir;
      if (action === 'prune') {
        const r = await pruneNow(ctx, limitGb ?? ctx.traceLimitGb, dryRun);
        const gb = (bytes: number) => `${(bytes / 2 ** 30).toFixed(2)} GB`;
        const verb = dryRun ? 'would remove' : 'removed';
        return reply(
          [
            `traces and heap dumps: ${gb(r.beforeBytes)} of a limit of ${gb(r.limitBytes)}; ${verb} ${r.removed.length}, ${gb(r.beforeBytes - r.afterBytes)}; ${gb(r.afterBytes)} left`,
            ...(r.stopped ? [`nothing was removed: ${r.stopped}`] : []),
            ...(r.over && !r.stopped
              ? [
                  'still over the limit: what is left is named by a baseline or a recent run, or is under a day old',
                ]
              : []),
            ...r.removed.map((x) => `${verb}: ${x.name} (${x.bytes} bytes)`),
            ...(r.removed.length && !dryRun ? [`log: ${r.log}`] : []),
          ].join('\n'),
          {
            failed: false,
            exitCode: 0,
            reports: [],
            prune: {
              limitBytes: r.limitBytes,
              beforeBytes: r.beforeBytes,
              afterBytes: r.afterBytes,
              removed: r.removed.length,
              over: r.over,
              ...(r.stopped && { stopped: r.stopped }),
            },
          },
        );
      }
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
      if (keys.length === 0) {
        const others = deviceClass
          ? await runKeys(dir, { ...(app && { app }), ...(scenario && { scenario }) })
          : [];
        throw new ToolError(
          others.length > 0
            ? `no runs of device class ${deviceClass}: they are under ${[...new Set(others.map((k) => k.deviceClass))].join(', ')}`
            : 'no measured runs: run a perf_ operation first',
          'NOT_FOUND',
        );
      }
      if (action === 'reference') {
        const taken: Awaited<ReturnType<typeof looks.reference>>[] = [];
        for (const k of keys) taken.push(await looks.reference(k));
        const ok = taken.every((t) => t.ok);
        return reply(taken.map((t) => t.line).join('\n'), {
          failed: !ok,
          exitCode: ok ? 0 : 1,
          reports: [],
          references: taken.flatMap((t) => t.file ?? []),
        });
      }
      if (action === 'baseline') {
        const lines: string[] = [];
        const files: string[] = [];
        let left = 0;
        for (const k of keys) {
          const runs = await latestRuns(dir, k, last);
          let base = await loadBaseline(project, k);
          let anew = replace;
          let usable = 0;
          let repeated = 0;
          // oldest first, as a baseline holds them
          for (const run of runs.toReversed()) {
            // a number of the device's own in the same run stands
            const clean = run.filter((r) => loudOf(r).length === 0);
            const noisy = run.filter((r) => loudOf(r).length > 0);
            const said = [...new Set(noisy.flatMap(loudOf))].join(', ');
            if (clean.length === 0) {
              lines.push(`not added, ${said}: measure ${k.scenario} again`);
              continue;
            }
            const before = runsIn(base);
            base = addToBaseline(k, base, clean, anew);
            if (!anew && runsIn(base) === before) repeated++;
            anew = false;
            usable++;
            await pinBaseline(stateDir(), clean);
            if (noisy.length)
              lines.push(`left out, ${said}: ${noisy.map((r) => r.kind).join(', ')}`);
          }
          const held = runsIn(base);
          const short = MIN_BASELINE_RUNS - held;
          // one that cannot call a regression must not look done
          if (usable === 0 || short > 0) left++;
          const count =
            short > 0
              ? `${held} of the ${MIN_BASELINE_RUNS} runs a comparison needs, ${short} missing: it cannot call a regression yet`
              : `${held} runs`;
          if (!base || usable === 0) {
            lines.push(`baseline unchanged: ${count}`);
            continue;
          }
          const file = await saveBaseline(project, base);
          files.push(file);
          lines.push(
            [
              `baseline: ${file}: ${count}`,
              ...(repeated ? [`${repeated} already in it, not added again`] : []),
              ...(runs.length < last
                ? [
                    `only ${runs.length} of the ${last} runs asked for ${runs.length === 1 ? 'is' : 'are'} kept`,
                  ]
                : []),
            ].join('; '),
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
      if (action === 'why') {
        const answers: Awaited<ReturnType<typeof looks.why>>[] = [];
        for (const [i, report] of reports.entries()) {
          const [run = []] = await latestRuns(dir, keys[i]!);
          answers.push(await looks.why(keys[i]!, report, run));
        }
        await rewriteDashboard(ctx);
        const words =
          format === 'json'
            ? JSON.stringify({ failed: code !== 0, answers }, null, 2)
            : format === 'junit'
              ? toJUnit(reports)
              : answers.map(answerText).join('\n\n');
        return reply(words, { failed: code !== 0, exitCode: code, reports, answers });
      }
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
