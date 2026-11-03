import {
  writeDashboard,
  runKeys,
  latestRuns,
  saveBaseline,
  addToBaseline,
  loadBaseline,
  loadBudgets,
  type KeyReport,
  reportKey,
  exitCode,
  toJson,
  toJUnit,
  toText,
} from '@appdyno/perf';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { CompareOut } from '../schemas.js';
import { type Op, defineOp, READ, reply, ToolError } from '../tool.js';
import { Scenario, rewriteDashboard } from './shared.js';

export function perfCompareOp(ctx: ServerContext): Op {
  return defineOp({
    name: 'perf_compare',
    title: 'Compare with the baseline',
    description:
      'The newest runs against the baseline and budgets in .appdyno/perf/; a change counts only when statistically and practically significant. budget: budgets only; baseline: adds the newest run to the baseline, `replace` starts it over; dashboard: writes the page, answers its path. No device needed.',
    input: z
      .object({
        action: z.enum(['compare', 'budget', 'baseline', 'dashboard']).default('compare'),
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
    run: async ({ action, app, scenario, deviceClass, last, replace, format }) => {
      const dir = ctx.measurementsDir;
      const project = ctx.perfDir;
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
          // a reference taken under load would hide every later change
          const loud = (newest[0]?.noise ?? []).filter((n) => n !== 'debuggable-build');
          if (loud.length) {
            left++;
            lines.push(`not added, ${loud.join(', ')}: measure ${k.scenario} again`);
            continue;
          }
          const file = await saveBaseline(
            project,
            addToBaseline(k, await loadBaseline(project, k), newest, replace),
          );
          files.push(file);
          lines.push(`baseline: ${file}`);
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
