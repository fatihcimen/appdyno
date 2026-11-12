import { existsSync, statSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, basename, dirname, relative, resolve } from 'node:path';
import { must, safeName } from '@appdyno/core';
import {
  type CaseFailure,
  type TestSuite,
  type TestCase,
  type RunResult,
  isFlaky,
  junitXml,
} from '@appdyno/flows';
import type { ServerContext } from '../context.js';
import type { Session } from '../session.js';
import { ToolError } from '../tool.js';
import { journeyText, measureJourney, type JourneyAnswer } from './journey.js';
import type { FlowRunner } from './runner.js';
import { readFlow } from './shared.js';

/** The `.flow` files the words name: a file, or every one under a directory, in name order. */
export function flowFiles(paths: string[]): string[] {
  const files = paths.flatMap((p) => {
    if (!existsSync(p)) throw new ToolError(`no such file or directory: ${p}`, 'NOT_FOUND');
    if (!statSync(p).isDirectory()) return [p];
    return (readdirSync(p, { recursive: true }) as string[])
      .filter((f) => extname(f) === '.flow')
      .sort()
      .map((f) => join(p, f));
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
  log?: (line: string) => void;
};

/** What a report line shows of a message, whose next lines are for a person reading the one failure. */
const firstLine = (s: string) => must(s.split('\n')[0], 'a first line');

/** One go at a file: how its run ended, or what kept it from one. */
type Attempt = { result?: RunResult; journey?: JourneyAnswer; error?: Error };

/**
 * Every file on every device, one after another. A failure leaves the screenshot and tree of its moment
 * under `artifacts`, and the next file still runs. A screenshot shows what the screen shows, a secret
 * typed into a plain field included. A retry is a new run of the whole file, so a failed step never
 * passes within one, and a file that passed only on a retry is reported as flaky with what failed.
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

  const once = async (s: Session, file: string, evidence: string): Promise<Attempt> => {
    const replay = {
      evidence,
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
    }
  };

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
        ? await once(s, file, evidence)
        : { ...(openError && { error: openError }) };
      // a run that ended on a step may end otherwise; what kept a file from running would again
      while (s && go.result?.failure && retried.length < retries) {
        const failed = failureOf(file, go);
        retried.push(failed);
        log(`  retry ${label}, attempt ${retried.length} of ${retries + 1}: ${failed.message}`);
        go = await once(s, file, join(evidence, `attempt-${retried.length + 1}`));
      }
      const { result, journey } = go;
      const ms = Date.now() - t0;
      const attempts = retried.length > 0 ? ` on attempt ${retried.length + 1}` : '';
      const said = attempts && `passed${attempts} of ${retries + 1}`;
      const steps = journey ? journeyText(journey) : result?.steps.map(runner.lineOf).join('\n');
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
        continue;
      }
      const failure = failureOf(file, go);
      log(`  FAIL ${label}: ${failure.message}`);
      for (const x of result?.failure?.saved ?? []) log(`       ${x}`);
      cases.push({ ...held, failure });
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
  if (flaky.length > 0) log(`flaky, passed only on a retry: ${flaky.join(', ')}`);
  return { passed: failed === 0, flaky, suites };
}
