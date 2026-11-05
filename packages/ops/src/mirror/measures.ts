import { execFile } from 'node:child_process';
import { inCall, type Device } from '@appdyno/core';
import { writeDashboard } from '@appdyno/perf';
import { claim, release } from '../claims.js';
import { ServerContext } from '../context.js';
import { measureHistory, type PastMeasure } from './history.js';
import { JOURNEY_ITERATIONS, type JourneyAnswer } from '../flow/journey.js';
import { perfLaunchOp } from '../perf/launch.js';
import { perfScrollOp } from '../perf/scroll.js';
import { opsFor } from '../registry.js';
import type { ToolResult } from '../tool.js';

/** What a window's pane says of a measure. */
export type MeasureWords = {
  title: string;
  value: string;
  detail: string;
  why: string;
  /** The tool itself found something in it: that a measure ran says nothing of how it came out. */
  flagged: boolean;
};

/** The real measures of a window: the ones an agent calls, kept with the same runs. */
export type WindowMeasures = {
  launch(app: string, say: (line: string) => void): Promise<MeasureWords>;
  scroll(app: string, say: (line: string) => void): Promise<MeasureWords>;
  /** A flow's journey, kept as any is: what a window says of it, and all of it for one to compare. */
  journey(
    file: string,
    app: string | undefined,
    say: (line: string) => void,
  ): Promise<{ said: MeasureWords; ran: JourneyAnswer }>;
  dashboard(): Promise<void>;
  /** What was measured here before, for an app. */
  history(app: string): Promise<PastMeasure[]>;
};

/** What may stand behind a number, as the dashboard marks it. */
const NOISE: Record<string, string> = {
  mirrored: 'stream running',
  'high-host-load': 'loaded Mac',
  'high-device-load': 'loaded device',
  'hot-device': 'hot device',
  'debuggable-build': 'debug build',
};

/** Whether a number is one to judge by: a line for the pane, and all of it for a look closer. */
const judged = (app: string, runs: string, data: { virtualDevice: boolean; noise: string[] }) => {
  // a debug build is said where all of it is, and is no alarm on a line of its own, as on the dashboard
  const marks = data.noise.map((n) => NOISE[n] ?? n);
  const loud = data.noise.filter((n) => n !== 'debuggable-build').map((n) => NOISE[n] ?? n);
  const relative = data.virtualDevice ? ['virtual device: compare only with its kind'] : [];
  return {
    detail: [runs, ...loud].join(', '),
    why: [app, runs, ...relative, ...marks].join(', '),
  };
};

/** Operations over a device already open in a window: a second driver object would be a second agent on it. */
export const windowContext = (ctx: ServerContext, device: Device) =>
  new ServerContext(
    ctx.policy,
    [{ list: async () => [], handles: (s) => s === device.serial, open: () => device }],
    {
      device: device.serial,
      measurements: ctx.measurementsDir,
      perf: ctx.perfDir,
      tool: 'appdyno window',
    },
  );

/** A person's measure holds the device as an agent's session does, for as long as it runs. */
export function windowMeasures(ctx: ServerContext, device: Device): WindowMeasures {
  const { serial } = device;
  const own = windowContext(ctx, device);
  const launch = perfLaunchOp(own);
  const scroll = perfScrollOp(own);

  const held = async <T>(say: (line: string) => void, work: () => Promise<ToolResult<T>>) => {
    claim(serial, 'appdyno window');
    try {
      return (await inCall({ progress: say }, work)).data as T;
    } finally {
      release(serial);
    }
  };

  return {
    launch: async (app, say) => {
      const input = launch.input.parse({ app });
      const data = await held(say, () => launch.handler(input));
      const out = launch.output.parse(data);
      return {
        title: 'Cold launch',
        value: out.medianMs === undefined ? 'not measured' : `${out.medianMs} ms`,
        flagged: out.excessive,
        ...judged(app, `median of ${out.samples.length}`, out),
      };
    },
    scroll: async (app, say) => {
      const input = scroll.input.parse({ app });
      const data = await held(say, () => scroll.handler(input));
      const out = scroll.output.parse(data);
      const jank = out.jankMedianPercent;
      return {
        title: 'Scroll',
        value:
          jank === undefined ? 'too few frames' : `${Math.round(jank)}% jank, ${out.frozen} frozen`,
        flagged: out.findings.length > 0,
        ...judged(app, `${out.rounds.length} rounds`, out),
      };
    },
    journey: async (file, app, say) => {
      const flow = opsFor(own).flow!;
      const input = flow.input.parse({ action: 'run', file, iterations: JOURNEY_ITERATIONS });
      const data = await held(say, async () => {
        // a flow that names no app takes the one in front, so that two builds can run one file
        (await own.session()).appId = app;
        return flow.handler(input) as Promise<ToolResult<unknown>>;
      });
      const { journey: ran } = flow.output.parse(data) as { journey?: JourneyAnswer };
      if (!ran) throw new Error('that flow kept no journey');
      return {
        ran,
        said: {
          title: 'Journey',
          value: `${Math.round(ran.totalMs)} ms`,
          flagged: false,
          ...judged(ran.scenario, `median of ${ran.iterations}`, {
            virtualDevice: device.virtual,
            noise: ran.noise,
          }),
        },
      };
    },
    history: (app) => measureHistory(ctx.measurementsDir, app, serial),
    dashboard: async () => {
      const file = await writeDashboard(ctx.measurementsDir, ctx.perfDir);
      execFile('open', [file]);
    },
  };
}
