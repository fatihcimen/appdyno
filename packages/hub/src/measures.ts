import { execFile } from 'node:child_process';
import { inCall, must, type Device } from '@appdyno/core';
import { loud, writeDashboard, type Noise } from '@appdyno/perf';
import { measureHistory, type PastMeasure } from './history.js';
import {
  byPerson,
  CHANGE_HINT,
  claim,
  CONNECTION_HINT,
  JOURNEY_ITERATIONS,
  type JourneyAnswer,
  NO_ANSWER_HINT,
  NO_APP_HINT,
  opsFor,
  perfLaunchOp,
  perfScrollOp,
  PROBE_HINT,
  release,
  ServerContext,
  type ToolResult,
} from '@appdyno/ops';

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
  launch: (app: string, say: (line: string) => void) => Promise<MeasureWords>;
  scroll: (app: string, say: (line: string) => void) => Promise<MeasureWords>;
  /** A flow's journey, kept as any is: what a window says of it, and all of it for one to compare. */
  journey: (
    file: string,
    app: string | undefined,
    say: (line: string) => void,
  ) => Promise<{ said: MeasureWords; ran: JourneyAnswer }>;
  dashboard: () => Promise<void>;
  /** What was measured here before, for an app. */
  history: (app: string) => Promise<PastMeasure[]>;
};

/**
 * What a refusal of a measure, a link, a push or a condition says to do, in a person's words: a tool's hint is said to
 * whoever calls it, and here that is a person at a button. A hint not here is not shown, and the refusal's own words
 * stand alone.
 */
export const PERSON_HINTS = new Map([
  [
    PROBE_HINT,
    'Go back to the screen to measure, then measure once more: the frame probe stays in the app until it quits',
  ],
  [NO_ANSWER_HINT, 'The device did not answer. Try again.'],
  [CONNECTION_HINT, 'The device is not connected, or stopped answering. Try once more.'],
  [CHANGE_HINT, 'Nothing was done. Change it and try again.'],
  [NO_APP_HINT, "Give the app's id, as the Apps pane lists it."],
  [
    byPerson('by --allow-apps'),
    'The hub was started with a list of allowed apps that leaves this one out.',
  ],
  [
    byPerson('by --allow-urls'),
    'The hub was started with a list of allowed links that leaves this one out.',
  ],
]);

/** What may stand behind a number, as the dashboard marks it. */
const NOISE: Record<string, string> = {
  mirrored: 'stream running',
  'high-host-load': 'loaded Mac',
  'high-device-load': 'loaded device',
  'hot-device': 'hot device',
  'debuggable-build': 'debug build',
  'device-state-unread': 'device state unread',
};

/** Whether a number is one to judge by: a line for the pane, and all of it for a look closer. */
const judged = (app: string, runs: string, data: { virtualDevice: boolean; noise: string[] }) => {
  // a mark is said where all of it is, and is no alarm on a line of its own, as on the dashboard
  const marks = data.noise.map((n) => NOISE[n] ?? n);
  const alarms = loud(data.noise as Noise[]).map((n) => NOISE[n] ?? n);
  const relative = data.virtualDevice ? ['virtual device: compare only with its kind'] : [];
  return {
    detail: [runs, ...alarms].join(', '),
    why: [app, runs, ...relative, ...marks].join(', '),
  };
};

/** Who acts in a window: a person, whose calls are no agent's to show. */
export const WINDOW = 'appdyno window';

/** Operations over a device already open in a window: a second driver object would be a second agent on it. */
export const windowContext = (ctx: ServerContext, device: Device) =>
  new ServerContext(
    ctx.policy,
    [{ list: () => Promise.resolve([]), handles: (s) => s === device.serial, open: () => device }],
    {
      device: device.serial,
      measurements: ctx.measurementsDir,
      perf: ctx.perfDir,
      tool: WINDOW,
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
      return (await inCall({ progress: say }, work)).data;
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
      // the window keeps what it measures to judge the next one by, as a baseline is kept
      const input = scroll.input.parse({ app, repeats: 3 });
      const data = await held(say, () => scroll.handler(input));
      const out = scroll.output.parse(data);
      const jank = out.jankMedianPercent;
      const ran = out.rounds.length;
      // a list that stopped moving ends the rounds early, after progress said each one asked for
      const asked = typeof input.repeats === 'number' ? input.repeats : ran;
      const rounds =
        ran < asked ? `${ran} of ${asked} rounds` : `${ran} round${ran === 1 ? '' : 's'}`;
      return {
        title: 'Scroll',
        value:
          jank === undefined ? 'too few frames' : `${Math.round(jank)}% jank, ${out.frozen} frozen`,
        flagged: out.findings.length > 0,
        ...judged(app, rounds, out),
      };
    },
    journey: async (file, app, say) => {
      const flow = must(opsFor(own).flow, 'flow');
      const input = flow.input.parse({ action: 'run', file, iterations: JOURNEY_ITERATIONS });
      const data = await held(say, async () => {
        // a flow that names no app takes the one in front, so that two builds can run one file
        (await own.session()).select(app);
        return flow.handler(input);
      });
      const { journey: ran } = flow.output.parse(data) as { journey?: JourneyAnswer };
      if (!ran) throw new Error('that flow kept no journey');
      return {
        ran,
        said: {
          title: 'Journey',
          value: ran.totalMs === undefined ? 'not measured' : `${Math.round(ran.totalMs)} ms`,
          flagged: ran.totalMs === undefined,
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
