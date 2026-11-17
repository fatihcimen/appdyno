import { randomBytes } from 'node:crypto';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { extname, join, dirname, relative, resolve } from 'node:path';
import { safeName } from '@appdyno/core';
import {
  type RunCase,
  type RunRecord,
  type TestSuite,
  isFlaky,
  stepsInOrder,
  suitesOf,
  verdictOf,
} from '@appdyno/flows';
import type { ServerContext } from '../context.js';
import type { Session } from '../session.js';
import { ToolError } from '../tool.js';
import type { FlowRunner } from './runner.js';
import { preparedCommand } from './prepare.js';
import { inShard, type Shard } from './shard.js';
import { isShared, readFlow } from './shared.js';
import { fileRunner, type FileOptions, type FileRun } from './test-file.js';
import {
  appFacts,
  changedOn,
  contentsOf,
  deviceFacts,
  rerunOf,
  runFacts,
  saveRecord,
  writeRun,
  type RunFiles,
} from './test-record.js';

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

export type TestOptions = FileOptions &
  RunFiles & {
    files: string[];
    /** In order; none: the context's default device. */
    devices: string[];
    artifacts: string;
    /** A file that passed only on a retry fails the run: for a job that must not go green on a flaky file. */
    failOnFlaky?: boolean;
    /**
     * This part alone of `files` split in `n`: the rest are other jobs'. A part no file falls to runs nothing and
     * passes, as the split is the same on every machine and another part has each file.
     */
    shard?: Shard;
    /** The env file `fromFile` was read from, for the command that runs a file again. */
    envFile?: string;
    /** The command as it was run, a param's value left out: what the record says ran. */
    command?: string[];
    log?: (line: string) => void;
  };

/** The project's own commands a run of `files` will start, each said once, before any does. */
function preparesOf(files: string[]) {
  const commands = new Set<string>();
  for (const file of files) {
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
  return commands;
}

/** The folder all of a run's files share: a file is named by its path under it, so two smoke.flow in two folders are two. */
const sharedBy = (files: string[]) =>
  files
    .map((f) => dirname(resolve(f)))
    .reduce(
      (a, b) => {
        while (relative(a, b).startsWith('..')) a = dirname(a);
        return a;
      },
      dirname(resolve(files[0] ?? '.')),
    );

/**
 * Every file on every device, one after another. A failure leaves the picture, tree and log of its moment
 * under `artifacts`, and the next file still runs, on the settings this run found. The picture is painted over where
 * an element is a password field or holds a secret; what the app drew with no element behind it still shows. A retry
 * is a new run of the whole file, so a failed step never passes within one, and a file that passed only on a retry is
 * reported as flaky with what failed. Such a file leaves the run passed, unless `failOnFlaky`. A file's setup and
 * teardown run around each go at it, and a teardown that failed is a case of its own in JUnit, beside the file's: the
 * file's own result stays what its steps came to, and the run fails, as the next file starts from what the teardown
 * left. What this tool could not clean up after a file, a setting it could not put back, is a case of its own the same
 * way, and the files after it on that device are not run, each with why. The run's record is kept after each file, and the folder's verdict, page, JUnit and pull request text are
 * written from it at the end.
 */
export async function runTests(
  ctx: ServerContext,
  runner: FlowRunner,
  o: TestOptions,
): Promise<{
  passed: boolean;
  flaky: string[];
  suites: TestSuite[];
  record: RunRecord;
  /** The run's page, where one was written. */
  page?: string;
}> {
  if (o.retries && o.iterations)
    throw new ToolError(
      'a measured flow is not retried: the gate would compare what a failed go left with what a later one read',
      'INVALID_ARGUMENT',
    );
  const log = o.log ?? (() => undefined);
  const shared = sharedBy(o.files);
  const labelOf = (file: string) => relative(shared, resolve(file));
  const files = o.shard ? inShard(o.files, labelOf, o.shard) : o.files;
  if (o.shard) log(`shard ${o.shard.i}/${o.shard.n}: ${files.length} of ${o.files.length} files`);
  for (const line of preparesOf(files)) log(line);
  const run = fileRunner(ctx, runner, o, log);
  const began = new Date();
  const id = `${began.toISOString().replace(/[-:]|\.\d+/g, '')}-${randomBytes(2).toString('hex')}`;
  const facts = runFacts(ctx);
  const appOf = appFacts();
  const devices: RunRecord['devices'] = [];
  const cases: RunCase[] = [];
  const record = (): RunRecord => ({
    schema: 1,
    id,
    began: began.toISOString(),
    ended: new Date().toISOString(),
    ...verdictOf(cases, { failOnFlaky: o.failOnFlaky === true }),
    command: o.command ?? [],
    ...(o.shard && { shard: o.shard }),
    ...facts,
    devices,
    cases,
    contents: contentsOf(o.artifacts, cases, ctx.policy.secrets.length),
  });
  // a part with no file opens no device
  for (const device of files.length === 0 ? [] : o.devices.length > 0 ? o.devices : [undefined]) {
    let s: Session | undefined;
    let openError: Error | undefined;
    try {
      s = device ? await ctx.use(device) : await ctx.session();
    } catch (e) {
      openError = e as Error;
    }
    const name = s?.device.serial ?? device ?? 'device';
    log(`${name}:`);
    if (s) devices.push(await deviceFacts(s));
    /** Why the files left on this device do not run: one before them was not cleaned up after. */
    let stopped: string | undefined;
    for (const file of files) {
      const label = labelOf(file);
      const evidence = join(o.artifacts, safeName(name), safeName(label));
      const changed = changedOn(name);
      if (stopped) log(`  NOT RUN ${label}: ${stopped}`);
      const ran: FileRun = stopped
        ? { outcome: 'not_run', ms: 0, attempts: [] }
        : await run(s, openError, file, label, evidence, (f) => relative(o.artifacts, f));
      const app = s && (await appOf(s));
      cases.push({
        device: name,
        file,
        label,
        ...ran,
        ...(stopped && { why: stopped }),
        ...(app && { app }),
        start: { changed },
        ...rerunOf(file, name, o),
      });
      if (ran.cleanup?.[0] && !stopped)
        stopped = `${label} was not cleaned up after (${ran.cleanup[0]}), and a file after it would start from what it left`;
      saveRecord(o.artifacts, record());
    }
  }
  const r = record();
  const { page } = writeRun(o.artifacts, r, o);
  const suites = suitesOf(r, (under) => under);
  const flaky = suites.flatMap((x) => x.cases.filter(isFlaky).map((c) => `${x.name}/${c.name}`));
  const all = suites.flatMap((x) => x.cases);
  const failed = all.filter((c) => c.failure).length;
  // before the counts, which stay the last of a run's lines but for the flaky files' names
  if (page) log(`report: ${page}`);
  // always, so that a run that exits 0 still shows what it took to
  log(`${all.length - failed - flaky.length} passed, ${flaky.length} flaky, ${failed} failed`);
  if (flaky.length > 0)
    log(
      `${o.failOnFlaky ? 'failed by --fail-on-flaky: ' : ''}flaky, passed only on a retry: ${flaky.join(', ')}`,
    );
  return { passed: r.verdict === 'PASS', flaky, suites, record: r, ...(page && { page }) };
}
