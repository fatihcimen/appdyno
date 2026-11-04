import { execFile } from 'node:child_process';
import { inCall, type Device } from '@appdyno/core';
import { writeDashboard } from '@appdyno/perf';
import { claim, release } from '../claims.js';
import { ServerContext } from '../context.js';
import { perfLaunchOp } from '../perf/launch.js';
import { perfScrollOp } from '../perf/scroll.js';
import type { ToolResult } from '../tool.js';

/** What a window's pane says of a measure. */
export type MeasureWords = { title: string; value: string; detail: string; why: string };

/** The real measures of a window: the ones an agent calls, kept with the same runs. */
export type WindowMeasures = {
  launch(app: string, say: (line: string) => void): Promise<MeasureWords>;
  scroll(app: string, say: (line: string) => void): Promise<MeasureWords>;
  dashboard(): Promise<void>;
};

/** What may stand behind a number, as the dashboard marks it. */
const NOISE: Record<string, string> = {
  mirrored: 'with a stream running',
  'high-host-load': 'on a loaded Mac',
  'high-device-load': 'on a loaded device',
  'hot-device': 'on a hot device',
  'debuggable-build': 'a debug build',
};

/** Whether a number is one to judge by: a line for the pane, and all of it for a look closer. */
const judged = (app: string, runs: string, data: { virtualDevice: boolean; noise: string[] }) => {
  const marks = data.noise.map((n) => NOISE[n] ?? n);
  const relative = data.virtualDevice ? ['virtual device: compare only with its kind'] : [];
  return {
    detail: [runs, ...marks].join('  ·  '),
    why: [app, runs, ...relative, ...marks].join(', '),
  };
};

/**
 * Over a device already open in a window: a second driver object would be a second agent on it. A person's measure
 * holds the device as an agent's session does, for as long as it runs.
 */
export function windowMeasures(ctx: ServerContext, device: Device): WindowMeasures {
  const { serial } = device;
  const own = new ServerContext(
    ctx.policy,
    [{ list: async () => [], handles: (s) => s === serial, open: () => device }],
    {
      device: serial,
      measurements: ctx.measurementsDir,
      perf: ctx.perfDir,
      tool: 'appdyno window',
    },
  );
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
        value: jank === undefined ? 'too few frames' : `${jank}% jank, ${out.frozen} frozen`,
        ...judged(app, `${out.rounds.length} rounds`, out),
      };
    },
    dashboard: async () => {
      const file = await writeDashboard(ctx.measurementsDir, ctx.perfDir);
      execFile('open', [file]);
    },
  };
}
