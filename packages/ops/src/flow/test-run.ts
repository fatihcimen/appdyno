import { existsSync, statSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, basename, dirname, relative, resolve } from 'node:path';
import { isThisProcess, must, safeName } from '@appdyno/core';
import {
  type CaseFailure,
  type TestSuite,
  type TestCase,
  type RunResult,
  isFlaky,
  junitXml,
  stepsInOrder,
} from '@appdyno/flows';
import type { ServerContext } from '../context.js';
import { mediaRestored } from '../media.js';
import type { Session } from '../session.js';
import { restoreConditions } from '../settings.js';
import { ToolError } from '../tool.js';
import { journeyText, measureJourney, type JourneyAnswer } from './journey.js';
import type { FlowRunner } from './runner.js';
import { preparedCommand } from './prepare.js';
import { isShared, readFlow } from './shared.js';

/** The `.flow` files the words name: a file, or every one under a directory, in name order. */
export function flowFiles(paths: string[]): string[] {
  const files = paths.flatMap((p) => {
    if (!existsSync(p)) throw new ToolError(`no such file or directory: ${p}`, 'NOT_FOUND');
    if (!statSync(p).isDirectory()) return [p];
    return (
      (readdirSync(p, { recursive: true }) as string[])
        // a folder's shared setup and teardown, and what else a project marks so, are no tests of their own
        .filter((f) => extname(f) === '.flow' && !isShared(f))
        .sort()
        .map((f) => join(p, f))
    );
  });
  // a CI job that found nothing to run has not passed
  if (files.length === 0) throw new ToolError(`no .flow files in ${paths.join(', ')}`, 'NOT_FOUND');
  return files;
}

/**
 * The files holding any of `tags`, or all with none given, and none of `exclude`. A file that cannot be read stays,
 * to fail as such: its tags are not known, and a broken file must not leave a run unseen.
 */
export function flowsTagged(files: string[], tags: string[] = [], exclude: string[] = []) {
  const chosen = files.filter((file) => {
    let have: string[];
    try {
      have = readFlow(file).tags;
    } catch {
      return true;
    }
    const wanted = tags.length === 0 || tags.some((t) => have.includes(t));
    return wanted && !exclude.some((t) => have.includes(t));
  });
  if (chosen.length === 0)
    throw new ToolError(
      `no flow of ${files.length} is selected by ${[...tags.map((t) => `--tag ${t}`), ...exclude.map((t) => `--exclude-tag ${t}`)].join(' ')}`,
      'NOT_FOUND',
    );
  return chosen;
}

export type TestOptions = {
  files: string[];
  /** In order; none: the context's default device. */
  devices: string[];
  artifacts: string;
  junit: string;
  params?: Record<string, string>;
  /** An env file's values, as a replay takes them. */
  fromFile?: Record<string, string>;
  /** Each file as a performance scenario, this many times: see `measureJourney`. */
  iterations?: number;
  /** How many times a file that failed on a step runs again, whole, from its first step. */
  retries?: number;
  /** A file that passed only on a retry fails the run: for a job that must not go green on a flaky file. */
  failOnFlaky?: boolean;
  log?: (line: string) => void;
};

/** What stands between two goes at a file, said at the first retry of a run. */
const RETRY_RESETS =
  "a retry is a new run of the whole file: the failed attempt's teardown runs, the mock rules, device settings and added media its steps changed are put back, then the setup runs again and the file from its first step; the app keeps running with its data unless the setup stops or clears it, and other apps and a server's data are not touched";

/** What a report line shows of a message, whose next lines are for a person reading the one failure. */
const firstLine = (s: string) => must(s.split('\n')[0], 'a first line');

/** One go at a file: how its run ended, or what kept it from one. */
type Attempt = { result?: RunResult; journey?: JourneyAnswer; error?: Error };

/**
 * Every file on every device, one after another. A failure leaves the screenshot and tree of its moment
 * under `artifacts`, and the next file still runs, on the settings this run found. A screenshot shows
 * what the screen shows, a secret typed into a plain field included. A retry is a new run of the whole
 * file, so a failed step never passes within one, and a file that passed only on a retry is reported as
 * flaky with what failed. Such a file leaves the run passed, unless `failOnFlaky`. A file's setup and teardown run
 * around each go at it, and a teardown that failed is a case of its own, beside the file's: the file's own result
 * stays what its steps came to, and the run fails, as the next file starts from what the teardown left.
 */
export async function runTests(
  ctx: ServerContext,
  runner: FlowRunner,
  o: TestOptions,
): Promise<{ passed: boolean; flaky: string[]; suites: TestSuite[] }> {
  if (o.retries && o.iterations)
    throw new ToolError(
      'a measured flow is not retried: the gate would compare what a failed go left with what a later one read',
      'INVALID_ARGUMENT',
    );
  const log = o.log ?? (() => undefined);
  const retries = o.retries ?? 0;

  /**
   * What a file changed on the device goes back once it has run, so that its dark mode is no other file's, and the
   * photos it added come out where the device takes them out.
   */
  const putBack = async (s: Session, label: string) => {
    const not = (e: unknown) => ({ failed: [(e as Error).message] });
    const { failed } = await restoreConditions(s, isThisProcess).catch(not);
    const media = await mediaRestored(s.device.addedMedia, isThisProcess).catch(not);
    for (const f of [...failed, ...media.failed]) log(`  could not put back after ${label}: ${f}`);
  };

  /** One go at a file: its pictures in `kept`, a retry's evidence in a folder of its own. */
  const once = async (
    s: Session,
    file: string,
    label: string,
    kept: string,
    attempt: number,
  ): Promise<Attempt> => {
    const replay = {
      evidence: attempt > 1 ? join(kept, `attempt-${attempt}`) : kept,
      shots: kept,
      prepares: true,
      ...(o.params && { params: o.params }),
      ...(o.fromFile && { fromFile: o.fromFile }),
    };
    try {
      return o.iterations
        ? await measureJourney(ctx, runner, s, readFlow(file), file, {
            ...replay,
            iterations: o.iterations,
          })
        : { result: await runner.run(s, readFlow(file), file, replay) };
    } catch (e) {
      // a file that does not parse, a value missing: this file's failure, not the run's
      return { error: e as Error };
    } finally {
      // after a measured file's iterations, not between them: each iteration starts as the one before it ended
      await putBack(s, label);
    }
  };

  /** What a go's teardown could not clean up, a line a failure: none where it ran clean or there is none. */
  const leftBy = (file: string, { result }: Attempt) =>
    (result?.teardown?.failed ?? []).map(
      (f) =>
        `teardown ${basename(f.file ?? file)} line ${f.line}, step ${f.n}: ${firstLine(f.message)}`,
    );

  const failureOf = (file: string, { result, error }: Attempt): CaseFailure => {
    const f = result?.failure;
    return {
      message: f
        ? `${f.file ? `${basename(f.file)} ` : ''}line ${f.line}, step ${f.n}: ${firstLine(f.message)}`
        : firstLine(error?.message ?? 'failed'),
      detail: [
        f ? runner.failureText(file, f) : (error?.message ?? ''),
        ...(f?.saved ?? []).map((x) => `saved ${x}`),
      ].join('\n'),
    };
  };

  // the project's own commands this run will start, said before any does, once each
  const commands = new Set<string>();
  for (const file of o.files) {
    try {
      for (const st of stepsInOrder(readFlow(file)))
        if (st.action === 'prepare') {
          const c = preparedCommand(st, file);
          commands.add(
            `prepare ${c.name} runs the project's own command: ${c.line} (in ${c.root})`,
          );
        }
    } catch {
      // a file that cannot be read, or names no command, fails as its own case
    }
  }
  for (const line of commands) log(line);
  let resetsSaid = false;

  // a file is named by its path under the folder all of this run's share, so two smoke.flow in two folders are two
  const shared = o.files
    .map((f) => dirname(resolve(f)))
    .reduce(
      (a, b) => {
        while (relative(a, b).startsWith('..')) a = dirname(a);
        return a;
      },
      dirname(resolve(o.files[0] ?? '.')),
    );
  const suites: TestSuite[] = [];
  for (const device of o.devices.length > 0 ? o.devices : [undefined]) {
    const cases: TestCase[] = [];
    let s: Session | undefined;
    let openError: Error | undefined;
    try {
      s = device ? await ctx.use(device) : await ctx.session();
    } catch (e) {
      openError = e as Error;
    }
    const name = s?.device.serial ?? device ?? 'device';
    log(`${name}:`);
    for (const file of o.files) {
      const t0 = Date.now();
      const label = relative(shared, resolve(file));
      const evidence = join(o.artifacts, safeName(name), safeName(label));
      const retried: CaseFailure[] = [];
      let go: Attempt = s
        ? await once(s, file, label, evidence, 1)
        : { ...(openError && { error: openError }) };
      // a run that ended on a step may end otherwise; what kept a file from running would again
      while (s && go.result?.failure && retried.length < retries) {
        const failed = failureOf(file, go);
        retried.push(failed);
        log(`  retry ${label}, attempt ${retried.length} of ${retries + 1}: ${failed.message}`);
        for (const line of leftBy(file, go)) log(`       ${line}`);
        if (!resetsSaid) log(`       ${RETRY_RESETS}`);
        resetsSaid = true;
        go = await once(s, file, label, evidence, retried.length + 1);
      }
      const { result, journey } = go;
      const ms = Date.now() - t0;
      const attempts = retried.length > 0 ? ` on attempt ${retried.length + 1}` : '';
      const said = attempts && `passed${attempts} of ${retries + 1}`;
      const steps = journey ? journeyText(journey) : result && runner.linesOf(result).join('\n');
      const out = [...(result?.passed && said ? [`flaky: ${said}`] : []), steps]
        .filter(Boolean)
        .join('\n');
      for (const line of journey ? journeyText(journey).split('\n') : []) log(`       ${line}`);
      const held = { name: label, ms, ...(retried.length > 0 && { retried }), ...(out && { out }) };
      if (result?.passed) {
        log(
          said
            ? `  FLAKY ${label}: ${said} (${result.steps.length} steps, ${ms} ms)`
            : `  ok   ${label} (${result.steps.length} steps, ${ms} ms)`,
        );
        cases.push(held);
      } else {
        const failure = failureOf(file, go);
        log(`  FAIL ${label}: ${failure.message}`);
        for (const x of result?.failure?.saved ?? []) log(`       ${x}`);
        cases.push({ ...held, failure });
      }
      const left = leftBy(file, go);
      const [first] = left;
      if (first === undefined) continue;
      log(`  TEARDOWN FAILED ${label}: ${first}`);
      cases.push({
        name: `${label} (teardown)`,
        ms: 0,
        failure: { message: first, detail: left.join('\n') },
      });
    }
    suites.push({ name, cases });
  }
  mkdirSync(dirname(o.junit), { recursive: true });
  writeFileSync(o.junit, junitXml(suites));
  const flaky = suites.flatMap((x) => x.cases.filter(isFlaky).map((c) => `${x.name}/${c.name}`));
  const cases = suites.flatMap((x) => x.cases);
  const failed = cases.filter((c) => c.failure).length;
  // always, so that a run that exits 0 still shows what it took to
  log(`${cases.length - failed - flaky.length} passed, ${flaky.length} flaky, ${failed} failed`);
  const refused = !!o.failOnFlaky && flaky.length > 0;
  if (flaky.length > 0)
    log(
      `${refused ? 'failed by --fail-on-flaky: ' : ''}flaky, passed only on a retry: ${flaky.join(', ')}`,
    );
  return { passed: failed === 0 && !refused, flaky, suites };
}
