import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  envValues,
  flowFiles,
  flowsFor,
  flowsTagged,
  JOURNEY_ITERATIONS,
  paramsOf,
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

/**
 * `test`: flow files on one or more devices, with the run's record, verdict, page, JUnit and pull request text in its
 * artifacts folder; exit 1 when the verdict is FAIL.
 */
export async function testCommand(rest: string[], open: Opens, err: (line: string) => void) {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: COMMANDS.test.flags,
  });
  const iterations = Number(values.iterations ?? JOURNEY_ITERATIONS);
  const retries = Number(values.retries ?? 0);
  if (
    positionals.length === 0 ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    !Number.isInteger(retries) ||
    retries < 0
  ) {
    err(usage('test'));
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
