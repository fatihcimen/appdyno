import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  commentRun,
  envValues,
  flowFiles,
  flowsFor,
  flowsTagged,
  JOURNEY_ITERATIONS,
  mergeRuns,
  paramsOf,
  readRun,
  shardOf,
  shareLines,
  ToolError,
  zipRun,
  type ServerContext,
} from '@appdyno/ops';
import { COMMANDS, usage } from './usage.js';

/** What the command line's context takes of `test`'s flags. */
type Opens = (values: {
  share?: boolean;
  measurements?: string;
  'update-baselines'?: boolean;
}) => ServerContext;

/** The words as they were typed, a param's value left out: what a run's record says ran. */
const asRun = (words: string[]) => {
  const name = (pair: string) => pair.split('=')[0] ?? '';
  return [
    'appdyno',
    'test',
    ...words.map((w, i) =>
      words[i - 1] === '--param'
        ? name(w)
        : w.startsWith('--param=')
          ? `--param=${name(w.slice('--param='.length))}`
          : w,
    ),
  ];
};

const one = (words: string[]) => (words.length === 1 ? words[0] : undefined);

/** Words parsed by a command's flags, or undefined where they are wrong: a usage error, said with what was wrong. */
function wordsOf<T>(
  name: Parameters<typeof usage>[0],
  parse: () => T,
  err: (line: string) => void,
) {
  try {
    return parse();
  } catch (e) {
    if (!String((e as { code?: unknown }).code).startsWith('ERR_PARSE_ARGS')) throw e;
    err(`${(e as Error).message}\n${usage(name)}`);
    return undefined;
  }
}

/** `test merge|share|comment`: what is made of runs that are already there, with no device. */
const OF_RUNS: Record<string, (rest: string[], err: (line: string) => void) => number> = {
  merge: (rest, err) => {
    const words = wordsOf(
      'test merge',
      () =>
        parseArgs({ args: rest, allowPositionals: true, options: COMMANDS['test merge'].flags }),
      err,
    );
    if (!words) return 2;
    const { values, positionals } = words;
    if (positionals.length === 0 || !values.out) {
      err(usage('test merge'));
      return 2;
    }
    const { record, page } = mergeRuns(positionals, values.out, {
      ...(values['allow-mixed'] && { allowMixed: true }),
      ...(values.junit && { junit: values.junit }),
      ...(values['pr-body'] && { prBody: values['pr-body'] }),
    });
    console.log(readFileSync(join(values.out, 'verdict.txt'), 'utf8').trimEnd());
    console.log(`report: ${String(page)}`);
    return record.verdict === 'PASS' ? 0 : 1;
  },
  share: (rest, err) => {
    const words = wordsOf(
      'test share',
      () =>
        parseArgs({ args: rest, allowPositionals: true, options: COMMANDS['test share'].flags }),
      err,
    );
    if (!words) return 2;
    const { values, positionals } = words;
    const dir = one(positionals);
    if (!dir) {
      err(usage('test share'));
      return 2;
    }
    if (!values.zip) {
      console.log(shareLines(readRun(dir)).join('\n'));
      return 0;
    }
    const packed = zipRun(dir, values.zip, {
      ...(values.with && { with: values.with }),
      ...(values.without && { without: values.without }),
    });
    console.log(shareLines({ ...readRun(dir), contents: packed.contents }).join('\n'));
    console.log(`packed in ${packed.file}`);
    return 0;
  },
  comment: (rest, err) => {
    const words = wordsOf(
      'test comment',
      () =>
        parseArgs({ args: rest, allowPositionals: true, options: COMMANDS['test comment'].flags }),
      err,
    );
    if (!words) return 2;
    const { values, positionals } = words;
    const dir = one(positionals);
    if (!dir) {
      err(usage('test comment'));
      return 2;
    }
    console.log(commentRun(dir, values.out));
    return 0;
  },
};

/** One of them, by its word: what it was given wrong is a usage error, exit 2, as a wrong flag is. */
function ofRuns(run: (typeof OF_RUNS)[string], rest: string[], err: (line: string) => void) {
  try {
    return run(rest, err);
  } catch (e) {
    if (!(e instanceof ToolError) || e.code !== 'INVALID_ARGUMENT') throw e;
    err(e.message);
    return 2;
  }
}

/**
 * `test`: flow files on one or more devices, with the run's record, verdict, page, JUnit and pull request text in its
 * artifacts folder; exit 1 when the verdict is FAIL.
 */
export async function testCommand(rest: string[], open: Opens, err: (line: string) => void) {
  const ofRun = Object.hasOwn(OF_RUNS, rest[0] ?? '') ? OF_RUNS[rest[0] ?? ''] : undefined;
  if (ofRun) return ofRuns(ofRun, rest.slice(1), err);
  const words = wordsOf(
    'test',
    () => parseArgs({ args: rest, allowPositionals: true, options: COMMANDS.test.flags }),
    err,
  );
  if (!words) return 2;
  const { values, positionals } = words;
  const iterations = Number(values.iterations ?? JOURNEY_ITERATIONS);
  const retries = Number(values.retries ?? 0);
  const shard = values.shard === undefined ? undefined : shardOf(values.shard);
  if (
    positionals.length === 0 ||
    (values.shard !== undefined && !shard) ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    !Number.isInteger(retries) ||
    retries < 0
  ) {
    err(usage('test'));
    return 2;
  }
  if (values.measure && retries > 0) {
    err(
      `--measure takes no --retries: the gate would compare what a failed go left with what a later one read\n${usage('test')}`,
    );
    return 2;
  }
  const artifacts = values.artifacts ?? 'appdyno-artifacts';
  const files = flowsTagged(flowFiles(positionals), values.tag, values['exclude-tag']);
  const ctx = open({
    ...(values.share && { share: true }),
    ...(values.measurements && { measurements: values.measurements }),
    ...(values['update-baselines'] && { 'update-baselines': true }),
  });
  try {
    const { passed } = await flowsFor(ctx).test({
      files,
      devices: values.device ?? [],
      artifacts,
      junit: values.junit ?? join(artifacts, 'junit.xml'),
      params: paramsOf(values.param),
      ...(values['env-file'] && {
        fromFile: envValues(values['env-file']),
        envFile: values['env-file'],
      }),
      command: asRun(rest),
      ...(shard && { shard }),
      ...(values['pr-body'] && { prBody: values['pr-body'] }),
      ...(values['no-report'] && { report: false }),
      retries,
      ...(values['fail-on-flaky'] && { failOnFlaky: true }),
      ...(values.measure && { iterations }),
      log: (line) => console.log(line),
    });
    return passed ? 0 : 1;
  } finally {
    await ctx.end().catch(() => []);
    ctx.close();
  }
}
