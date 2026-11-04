import { JOURNEY_TOTAL, journeyStep, stepName } from '../record.js';
import { figure, multiples } from './figure.js';
import { deviceLabel, formatValue, when } from './format.js';
import { chip } from './marks.js';
import { partsOf } from './phases.js';
import { splitBar } from './split-bar.js';
import { tableView } from './table-view.js';
import {
  changeText,
  nameOf,
  regressedSteps,
  stepTimes,
  type AppView,
  type Scenario,
} from './view.js';

/** The steps the gate calls slower, each by its name: what a journey's reader looks for first. */
export const stepChips = (s: Scenario) =>
  regressedSteps(s).flatMap((c) => {
    const step = journeyStep(c.kind);
    return step ? [chip('critical', `${stepName(step.step)} slower ${changeText(c)}`)] : [];
  });

/** What the gate says of one kind in the newest run, where it says anything. */
const verdictOf = (s: Scenario, kind: string) =>
  s.report.comparisons.find((c) => c.kind === kind)?.verdict ?? '';

/** Each journey's newest run on each device: its steps as one bar, and every number of a step in its table. */
export function journeyFigures(v: AppView): string {
  const slots = new Map<string, number>();
  return multiples(
    v.scenarios.flatMap((s) => {
      const run = s.runs[0] ?? [];
      const steps = stepTimes(run);
      if (steps.length === 0) return [];
      const whole = run.find((r) => r.kind === JOURNEY_TOTAL)?.value;
      const about = `${whole === undefined ? '' : `${formatValue(whole, 'ms')} in all, `}${s.key.scenario}, ${when(steps[0]!.record.at)}`;
      const cls = s.key.deviceClass;
      const of = (step: string, what: string) => {
        const r = run.find((x) => {
          const k = journeyStep(x.kind);
          return k?.step === step && k.what === what;
        });
        return r ? formatValue(r.value, r.unit) : '';
      };
      return [
        figure(
          v,
          cls,
          about,
          stepChips(s),
          splitBar(
            partsOf(
              steps.map((x) => ({ name: x.name, value: x.record.value })),
              slots,
            ),
            'ms',
            `${s.key.scenario} by step on ${deviceLabel(nameOf(v, cls))}`,
          ),
          tableView(
            `Table: ${steps.length} steps, ${s.total} runs kept`,
            ['Step', 'Time', 'Against the baseline', 'Frames p95', 'Worst frame', 'Memory'],
            steps.map(({ name, record }) => {
              const step = journeyStep(record.kind)!.step;
              return [
                name,
                formatValue(record.value, record.unit),
                verdictOf(s, record.kind),
                of(step, 'frames_p95_ms'),
                of(step, 'frames_worst_ms'),
                of(step, 'memory_kb'),
              ];
            }),
          ),
        ),
      ];
    }),
  );
}
