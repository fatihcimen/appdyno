import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { must } from '@appdyno/core';
import { opsFor, type Op, type ServerContext } from '@appdyno/ops';
import { COMMANDS, usage } from './usage.js';

type Ops = Record<string, Op>;

const say = async (ops: Ops, name: string, args: Record<string, unknown>) => {
  const op = must(ops[name], `the ${name} tool`);
  const { blocks } = await op.handler(op.input.parse(args));
  return blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
};

/** Until `ms` pass, if any are given, or a person stops it, whichever is first. */
const forThisLong = (ms?: number) =>
  new Promise<void>((done) => {
    const timer = ms === undefined ? undefined : setTimeout(done, ms);
    process.once('SIGINT', () => {
      clearTimeout(timer);
      done();
    });
  });

type TimelineRun = {
  /** What happens during it: what a flow does, or a person's hands while it waits. */
  during: (ops: Ops) => Promise<unknown>;
  dir?: string;
  log: (line: string) => void;
};

/**
 * One timeline in one process. What failed during it is still written: that is the one a person wants to see.
 * @internal the bin's own, and the published types have none of what it takes
 */
export async function recordTimeline(ops: Ops, { during, dir, log }: TimelineRun) {
  log(await say(ops, 'report', { action: 'timeline', ...(dir && { dir }) }));
  let failed: unknown;
  await during(ops).catch((e: unknown) => (failed = e));
  log(await say(ops, 'report', { action: 'stop' }));
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- what failed during it, thrown on as it came
  if (failed !== undefined) throw failed;
}

type Settings = {
  device?: string;
  app?: string;
  'flight-seconds'?: string;
  'full-urls'?: boolean;
};

/**
 * `appdyno flight`: stays until a person stops it, and says what it kept.
 * @internal the bin's own, and the published types have none of what it takes
 */
export async function flightCommand(args: string[], context: (values: Settings) => ServerContext) {
  const { values } = parseArgs({ args, options: COMMANDS.flight.flags });
  const { app, device, seconds, dir, 'full-urls': fullUrls } = values;
  if (!app) {
    console.error(usage('flight'));
    return 2;
  }
  const ctx = context({
    app,
    ...(device && { device }),
    ...(seconds && { 'flight-seconds': seconds }),
    ...(fullUrls && { 'full-urls': true }),
  });
  const ops = opsFor(ctx);
  try {
    console.log(await say(ops, 'report', { action: 'flight', ...(dir && { dir: resolve(dir) }) }));
    await forThisLong();
    console.log(await say(ops, 'report', { action: 'stop' }));
    return 0;
  } finally {
    await ctx.end().catch(() => []);
    ctx.close();
  }
}

/**
 * `appdyno timeline`: its sources run in this process, so this stays for the whole of it, as a window does.
 * @internal the bin's own, and the published types have none of what it takes
 */
export async function timelineCommand(
  args: string[],
  context: (values: Settings) => ServerContext,
) {
  const { values } = parseArgs({ args, options: COMMANDS.timeline.flags });
  const { app, device, flow, seconds, dir, 'full-urls': fullUrls } = values;
  if (!app || (!flow && !seconds)) {
    console.error(usage('timeline'));
    return 2;
  }
  const ctx = context({
    app,
    ...(device && { device }),
    ...(fullUrls && { 'full-urls': true }),
  });
  try {
    await recordTimeline(opsFor(ctx), {
      during: flow
        ? (ops) => say(ops, 'flow', { action: 'run', file: resolve(flow) }).then(console.log)
        : () => forThisLong(Number(seconds) * 1_000),
      ...(dir && { dir: resolve(dir) }),
      log: (line) => console.log(line),
    });
    return 0;
  } finally {
    await ctx.end().catch(() => []);
    ctx.close();
  }
}
