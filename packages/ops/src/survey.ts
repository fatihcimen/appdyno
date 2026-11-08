import { must, type Capability } from '@appdyno/core';
import {
  deviceClass,
  formatValue,
  latestRuns,
  loadRefusals,
  measureOf,
  MEASURES,
  runKeys,
  writeDashboard,
  type MeasureId,
} from '@appdyno/perf';
import type { ServerContext } from './context.js';
import { deviceInfo, keepRefusal, ROW_OF } from './perf/shared.js';
import { EXTRA_NAMES } from './perf/snapshot.js';
import { opsFor } from './registry.js';

type Call = { op: string; args?: Record<string, unknown> };

const SNAPSHOT: Call = {
  op: 'perf_snapshot',
  args: { also: EXTRA_NAMES, batteryWindowMs: 10_000 },
};
const SCROLL: Call = { op: 'perf_scroll' };
const TRACE: Call = { op: 'perf_trace', args: { scroll: 'up' } };

/** What reads each row, tried in turn until the row has a number. Names no device: each says what it cannot do. */
const READS: Record<MeasureId, Call[]> = {
  launch: [{ op: 'perf_launch' }],
  // its own scenario: a traced launch is not comparable with the plain ones
  'launch-why': [{ op: 'perf_launch', args: { repeats: 1, trace: true, scenario: 'launch-why' } }],
  frames: [SCROLL, TRACE],
  frozen: [SCROLL, TRACE],
  stalls: [SCROLL, TRACE, { op: 'perf_trace', args: { what: 'hangs', scroll: 'up' } }],
  memory: [SNAPSHOT],
  leaks: [{ op: 'perf_heap' }],
  cpu: [SNAPSHOT],
  network: [SNAPSHOT],
  energy: [SNAPSHOT],
  battery: [SNAPSHOT],
  crashes: [SNAPSHOT],
  size: [SNAPSHOT],
  // a flow of the caller's: nothing here can make one up, and no device refuses it
  journey: [],
};

type Outcome = { refused?: string; failed?: string; lacking?: string[] };

const NAME_WIDTH = Math.max(...MEASURES.map((m) => m.length)) + 2;

/**
 * Every measure on this device, by the same operations a caller has: a refusal is the answer for its row, and the
 * next row still runs. One line per measure, then the page.
 */
export async function survey(ctx: ServerContext, app: string, log: (line: string) => void) {
  const ops = opsFor(ctx);
  const session = await ctx.session();
  const dir = ctx.measurementsDir;
  const cls = deviceClass(deviceInfo(session));
  const started = Date.now();
  const since = (at: string) => Date.parse(at) >= started;

  const made = new Map<string, Promise<Outcome>>();
  const attempt = async ({ op, args }: Call): Promise<Outcome> => {
    const o = must(ops[op], `the op ${op}`);
    try {
      const { data } = await o.handler(o.input.parse({ app, ...args }));
      return { lacking: (data.lacking ?? []) as string[] };
    } catch (e) {
      const { code, message } = e as { code?: string; message: string };
      return code === 'UNSUPPORTED' ? { refused: message } : { failed: message };
    }
  };
  /** A call two rows share runs once. */
  const once = (call: Call) => {
    const id = JSON.stringify(call);
    const held = made.get(id) ?? attempt(call);
    made.set(id, held);
    return held;
  };
  const readingOf = async (row: MeasureId) => {
    const keys = await runKeys(dir, { app, deviceClass: cls });
    const newest = await Promise.all(keys.map((k) => latestRuns(dir, k, 1)));
    const got = newest.flat(2).filter((r) => since(r.at) && measureOf(r.kind) === row);
    // of a start's phases, the longest is the one to say
    return row === 'launch-why' ? got.toSorted((a, b) => b.value - a.value)[0] : got[0];
  };
  const line = (row: MeasureId, what: string) => log(`${row.padEnd(NAME_WIDTH)}${what}`);

  let read = 0;
  for (const row of MEASURES) {
    if (READS[row].length === 0) {
      line(row, 'your flow: appdyno test <file> --measure');
      continue;
    }
    const said: Outcome[] = [];
    for (const call of READS[row]) {
      if (await readingOf(row)) break;
      said.push(await once(call));
    }
    const got = await readingOf(row);
    if (got) {
      read++;
      line(row, `${formatValue(got.value, got.unit)} (${got.kind})`);
      continue;
    }
    const failed = said.flatMap((o) => o.failed ?? []);
    if (failed.length) {
      line(row, `failed: ${[...new Set(failed)].join('; ')}`);
      continue;
    }
    const lacks = (o: Outcome) => o.lacking?.some((what) => ROW_OF[what as Capability] === row);
    const kept = (await loadRefusals(dir)).find(
      (r) => r.deviceClass === cls && r.app === app && r.measure === row && since(r.at),
    );
    // a call that ran is the device not refusing, whatever the other ways to read this row said
    if (!kept && said.some((o) => !o.refused && !lacks(o))) {
      line(row, 'answered with no number to keep');
      continue;
    }
    const reason =
      kept?.reason ??
      ([...new Set(said.flatMap((o) => o.refused ?? []))].join('; ') ||
        `${session.device.serial} gives no reading of this`);
    if (!kept) await keepRefusal(ctx, session, app, row, reason);
    line(row, `cannot be read: ${reason}`);
  }
  const file = await writeDashboard(dir, ctx.perfDir, { app });
  log(`dashboard: ${file}`);
  return { read, file };
}
