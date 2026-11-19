import { basename, join } from 'node:path';
import { isThisProcess, must } from '@appdyno/core';
import type { CaseFailure, RunCase, RunResult } from '@appdyno/flows';
import type { ServerContext } from '../context.js';
import { mediaRestored } from '../media.js';
import { redact } from '../policy.js';
import type { Session } from '../session.js';
import { restoreConditions } from '../settings.js';
import { journeyText, measureJourney, type JourneyAnswer } from './journey.js';
import type { FlowRunner } from './runner.js';
import { cleanupFailure, readFlow } from './shared.js';
import { evidenceOf } from './test-evidence.js';

/** What a test run takes of its options to run one file. */
export type FileOptions = {
  params?: Record<string, string>;
  /** An env file's values, as a replay takes them. */
  fromFile?: Record<string, string>;
  /** Each file as a performance scenario, this many times: see `measureJourney`. */
  iterations?: number;
  /** How many times a file that failed on a step runs again, whole, from its first step. */
  retries?: number;
  /**
   * A person at a terminal started this run: a `prepare` step's command, the project's own, runs with nothing asked.
   * Else each asks the person, as a tool call's does.
   */
  prepares?: boolean;
};

/** What stands between two goes at a file, said at the first retry of a run. */
const RETRY_RESETS =
  "a retry is a new run of the whole file: the failed attempt's teardown runs, the mock rules, device settings and added media its steps changed are put back, then the setup runs again and the file from its first step; the app keeps running with its data unless the setup stops or clears it, and other apps and a server's data are not touched";

/** What a report line shows of a message, whose next lines are for a person reading the one failure. */
const firstLine = (s: string) => must(s.split('\n')[0], 'a first line');

/** One go at a file: how its run ended, or what kept it from one, and what could not be cleaned up after it. */
type Attempt = { result?: RunResult; journey?: JourneyAnswer; error?: Error; cleanup?: string[] };

/** What running a file gives its case in the record: the rest is the run's to say. */
export type FileRun = Pick<
  RunCase,
  'outcome' | 'ms' | 'attempts' | 'steps' | 'out' | 'teardown' | 'cleanup'
>;

/** A file of a test run, with its retries: what it logs as it goes, and how it ended. */
export function fileRunner(
  ctx: ServerContext,
  runner: FlowRunner,
  o: FileOptions,
  log: (line: string) => void,
) {
  const retries = o.retries ?? 0;
  let resetsSaid = false;

  /**
   * What a file changed on the device goes back once it has run, so that its dark mode is no other file's, and the
   * photos it added come out where the device takes them out: what could not, a line each.
   */
  const putBack = async (s: Session) => {
    const not = (e: unknown) => ({ failed: [(e as Error).message] });
    const { failed } = await restoreConditions(s, isThisProcess).catch(not);
    const media = await mediaRestored(s.device.addedMedia, isThisProcess).catch(not);
    return [...failed, ...media.failed].map((f) => cleanupFailure('put back', f));
  };

  /** One go at a file: its pictures in `kept`, a retry's evidence in a folder of its own. */
  const once = async (
    s: Session,
    file: string,
    kept: string,
    attempt: number,
  ): Promise<Attempt> => {
    const replay = {
      evidence: attempt > 1 ? join(kept, `attempt-${attempt}`) : kept,
      shots: kept,
      prepares: o.prepares === true,
      ...(o.params && { params: o.params }),
      ...(o.fromFile && { fromFile: o.fromFile }),
    };
    const went: Attempt = await (async () =>
      o.iterations
        ? await measureJourney(ctx, runner, s, readFlow(file), file, {
            ...replay,
            iterations: o.iterations,
          })
        : { result: await runner.run(s, readFlow(file), file, replay) })().catch(
      // a file that does not parse, a value missing: this file's failure, not the run's
      (e: unknown) => ({ error: e as Error }),
    );
    // after a measured file's iterations, not between them: each iteration starts as the one before it ended
    const left = await putBack(s);
    return { ...went, cleanup: [...(went.result?.cleanup ?? []), ...left] };
  };

  /** What a go's teardown could not clean up, a line a failure: none where it ran clean or there is none. */
  const leftBy = (file: string, { result }: Attempt) =>
    (result?.teardown?.failed ?? []).map(
      (f) =>
        `teardown ${basename(f.file ?? file)} line ${f.line}, step ${f.n}: ${firstLine(f.message)}`,
    );

  const failureOf = (file: string, { result, error }: Attempt): CaseFailure => {
    const f = result?.failure;
    // what kept a file from running may quote it, as a line that does not parse is quoted
    const why = error && redact(ctx.policy, error.message);
    return {
      message: f
        ? `${f.file ? `${basename(f.file)} ` : ''}line ${f.line}, step ${f.n}: ${firstLine(f.message)}`
        : firstLine(why ?? 'failed'),
      // the files it left are the record's to name, by where the run's folder is read
      detail: f ? runner.failureText(file, f) : (why ?? ''),
    };
  };

  /** A go as the record keeps it: how it ended, and what its failure left, by `pathOf`. */
  const attemptOf = (
    file: string,
    go: Attempt,
    n: number,
    ms: number,
    pathOf: (file: string) => string,
  ): RunCase['attempts'][number] => {
    const f = go.result?.failure;
    if (go.result?.passed) return { n, outcome: 'passed', ms, evidence: {} };
    return {
      n,
      outcome: 'failed',
      ms,
      failure: {
        ...failureOf(file, go),
        ...(f && {
          line: f.line,
          n: f.n,
          step: f.step,
          ...(f.code && { code: f.code }),
          ...(f.file && { file: f.file }),
          ...(f.phase && { phase: f.phase }),
          ...(f.screen && { screen: f.screen }),
        }),
      },
      evidence: evidenceOf(f?.saved, pathOf),
    };
  };

  /**
   * The file on the session's device, with `evidence` for what a failure leaves, named in the record by `pathOf`: how
   * it ended, each go at it, and what its teardown left. With no session, `openError` is what kept the device from one,
   * and the file's failure.
   */
  return async (
    s: Session | undefined,
    openError: Error | undefined,
    file: string,
    label: string,
    evidence: string,
    pathOf: (file: string) => string,
  ): Promise<FileRun> => {
    const t0 = Date.now();
    const attempts: FileRun['attempts'] = [];
    const cleanup: string[] = [];
    let began = t0;
    const went = (go: Attempt) => {
      attempts.push(attemptOf(file, go, attempts.length + 1, Date.now() - began, pathOf));
      cleanup.push(...(go.cleanup ?? []));
      began = Date.now();
      return go;
    };
    let go: Attempt = went(
      s ? await once(s, file, evidence, 1) : { ...(openError && { error: openError }) },
    );
    // a run that ended on a step may end otherwise; what kept a file from running would again, and a device not put
    // back would start the retry from what the last go left
    while (s && go.result?.failure && attempts.length <= retries && cleanup.length === 0) {
      const failed = failureOf(file, go);
      log(`  retry ${label}, attempt ${attempts.length} of ${retries + 1}: ${failed.message}`);
      for (const line of leftBy(file, go)) log(`       ${line}`);
      if (!resetsSaid) log(`       ${RETRY_RESETS}`);
      resetsSaid = true;
      go = went(await once(s, file, evidence, attempts.length + 1));
    }
    const { result, journey } = go;
    const ms = Date.now() - t0;
    const said = attempts.length > 1 && `passed on attempt ${attempts.length} of ${retries + 1}`;
    const steps = journey ? journeyText(journey) : result && runner.linesOf(result).join('\n');
    const out = [...(result?.passed && said ? [`flaky: ${said}`] : []), steps]
      .filter(Boolean)
      .join('\n');
    for (const line of journey ? journeyText(journey).split('\n') : []) log(`       ${line}`);
    if (result?.passed)
      log(
        said
          ? `  FLAKY ${label}: ${said} (${result.steps.length} steps, ${ms} ms)`
          : `  ok   ${label} (${result.steps.length} steps, ${ms} ms)`,
      );
    else {
      log(`  FAIL ${label}: ${failureOf(file, go).message}`);
      for (const x of result?.failure?.saved ?? []) log(`       ${x}`);
    }
    const left = leftBy(file, go);
    if (left[0] !== undefined) log(`  TEARDOWN FAILED ${label}: ${left[0]}`);
    for (const line of cleanup) log(`  CLEANUP FAILED ${label}: ${line}`);
    return {
      outcome: !result?.passed ? 'failed' : said ? 'flaky' : 'passed',
      ms,
      attempts,
      ...(result && {
        steps: result.steps.map((r) => ({
          n: r.n,
          line: r.line,
          step: r.step,
          ms: r.ms,
          ...(r.settledMs !== undefined && { settledMs: r.settledMs }),
        })),
      }),
      ...(out && { out }),
      ...(result?.teardown && { teardown: { ok: left.length === 0, failed: left } }),
      ...(cleanup.length > 0 && { cleanup }),
    };
  };
}
