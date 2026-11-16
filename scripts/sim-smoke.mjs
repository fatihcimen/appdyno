// The simulator smoke: a few device suites on an iOS simulator this makes for itself, boots with no window and deletes
// after, whatever happened. It builds the runner and the fixture as scripts/ci.sh does, and writes what ran to
// .ci/smoke: report.json as vitest gives it, and device-summary.md, which names the device, its OS, the Xcode and the
// date beside each suite's counts. Exits as vitest did, and 3 where a suite ran nothing, which vitest calls a pass.
// `.github/workflows/ci.yml` runs it; on a Mac, after `pnpm build`:
//   node scripts/sim-smoke.mjs [a folder for what it writes, in place of .ci/smoke]
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Reads, taps, typing and a settle on a moving screen; keys; native views; flows replayed by the built command line. */
const SUITES = ['ios', 'keys', 'views.simulator', 'flows-ci'].map(
  (name) => `device-tests/${name}.test.ts`,
);

/**
 * A runtime as `simctl list runtimes -j` lists it, a file of vitest's JSON report, and what a summary says of a run.
 * @typedef {{ name: string; identifier: string }} DeviceType
 * @typedef {{ name: string; version: string; buildversion: string; identifier: string; isAvailable: boolean; supportedDeviceTypes: DeviceType[] }} Runtime
 * @typedef {{ name: string; startTime: number; endTime: number; assertionResults: { status: string }[] }} FileResult
 * @typedef {{ device: string; os: string; xcode: string; date: string; commit: string; seconds: Record<string, number> }} Facts
 */

/** @param {string} a @param {string} b */
const newestFirst = (a, b) => b.localeCompare(a, undefined, { numeric: true });

/**
 * The iOS runtime of the Xcode in use, by its SDK's version, else the newest there is, and on it the newest iPhone
 * with a plain name: an image's own simulators differ from one image to the next, and this pair is said in the summary.
 * @param {Runtime[]} runtimes
 * @param {string} sdk
 */
function pick(runtimes, sdk) {
  const ios = runtimes
    .filter((r) => r.isAvailable && r.name.startsWith('iOS '))
    .sort((a, b) => newestFirst(a.version, b.version));
  const runtime = ios.find((r) => r.version === sdk) ?? ios[0];
  const type = runtime?.supportedDeviceTypes
    .filter((t) => /^iPhone \d+$/.test(t.name))
    .sort((a, b) => newestFirst(a.name, b.name))[0];
  if (!runtime || !type) throw new Error('no iOS runtime with an iPhone on this Mac');
  return { runtime, type };
}

/**
 * Each suite's tests that passed, failed and were skipped, and its seconds.
 * @param {FileResult[]} files
 */
const counts = (files) =>
  files.map((f) => {
    /** @param {string} status */
    const of = (status) => f.assertionResults.filter((a) => a.status === status).length;
    const [passed, failed] = [of('passed'), of('failed')];
    const skipped = f.assertionResults.length - passed - failed;
    const seconds = Math.round((f.endTime - f.startTime) / 1000);
    return { suite: basename(f.name), passed, failed, skipped, seconds };
  });

/**
 * device-summary.md: the first table is the row docs/reference/tools-tested.md keeps of a pair that was run.
 * @param {FileResult[]} files
 * @param {Facts} facts
 */
function summary(files, facts) {
  /** @param {(string | number)[][]} rows */
  const table = (rows) =>
    rows
      .flatMap((r, i) => [r, ...(i ? [] : [r.map(() => '---')])])
      .map((r) => `| ${r.join(' | ')} |`)
      .join('\n');
  const suites = counts(files);
  return [
    '# Device summary',
    table([
      ['device', 'OS', 'Xcode', 'date'],
      [facts.device, facts.os, facts.xcode, facts.date],
    ]),
    `Commit \`${facts.commit}\`. ${Object.entries(facts.seconds)
      .map(([what, s]) => `${what} ${String(s)} s`)
      .join(', ')}.`,
    table([
      ['suite', 'passed', 'failed', 'skipped', 'seconds'],
      ...suites.map((s) => [s.suite, s.passed, s.failed, s.skipped, s.seconds]),
    ]),
    '',
  ].join('\n\n');
}

/**
 * A command's output, its failure thrown.
 * @param {string} command
 * @param {...string} args
 */
function said(command, ...args) {
  const r = spawnSync(command, args, { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${command} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * @param {string} text
 * @returns {unknown}
 */
const parsed = (text) => JSON.parse(text);

function main() {
  const out = resolve(process.argv[2] ?? join(repo, '.ci/smoke'));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const { runtimes } = /** @type {{ runtimes: Runtime[] }} */ (
    parsed(said('xcrun', 'simctl', 'list', 'runtimes', '-j'))
  );
  const { runtime, type } = pick(
    runtimes,
    said('xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version'),
  );
  const xcode = /Xcode (\S+)\s+Build version (\S+)/.exec(said('xcodebuild', '-version'));
  const udid = said(
    ...['xcrun', 'simctl', 'create', `appdyno-ci-${String(process.pid)}`],
    ...[type.identifier, runtime.identifier],
  );
  // its own simulator, by its id, at any end: a throw, a signal, the last line
  process.once('exit', () => {
    spawnSync('xcrun', ['simctl', 'shutdown', udid]);
    spawnSync('xcrun', ['simctl', 'delete', udid]);
  });
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM']))
    process.once(signal, () => process.exit(130));

  /** @type {Record<string, number>} */
  const seconds = {};
  /**
   * A step with its output shown and its seconds kept.
   * @param {string} what
   * @param {string} command
   * @param {string[]} args
   * @param {NodeJS.ProcessEnv} [env]
   */
  const step = (what, command, args, env = process.env) => {
    const from = Date.now();
    const { status } = spawnSync(command, args, { cwd: repo, stdio: 'inherit', env });
    seconds[what] = Math.round((Date.now() - from) / 1000);
    console.log(`${status === 0 ? 'ok  ' : 'FAIL'} ${what} (${String(seconds[what])}s)`);
    return status ?? 1;
  };
  const report = join(out, 'report.json');
  // an Android device named to this shell is no part of this run
  const { APPDYNO_ANDROID_SERIAL: _android, ...env } = process.env;
  const code =
    step('boot', 'xcrun', ['simctl', 'bootstatus', udid, '-b']) ||
    // the line of scripts/ci.sh: signed as Xcode signs for a simulator, where the fixture's web view has its name
    step('build', 'xcodebuild', [
      ...['build-for-testing', '-project', 'ios/Appdyno.xcodeproj', '-scheme', 'Runner', '-quiet'],
      ...['-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', 'ios/.derived'],
    ]) ||
    step(
      'suites',
      'pnpm',
      [
        ...['exec', 'vitest', 'run', '--config', 'vitest.device.config.ts'],
        ...['--reporter=default', '--reporter=json', `--outputFile.json=${report}`, ...SUITES],
      ],
      { ...env, APPDYNO_IOS_UDID: udid },
    );

  /** @type {FileResult[]} */
  let files = [];
  try {
    ({ testResults: files } = /** @type {{ testResults: FileResult[] }} */ (
      parsed(readFileSync(report, 'utf8'))
    ));
  } catch {
    // a boot or a build that failed left no report: the summary says the pair and the seconds alone
  }
  const text = summary(files, {
    device: `${type.name} simulator`,
    os: `${runtime.name} (${runtime.buildversion})`,
    xcode: xcode ? `${String(xcode[1])} (${String(xcode[2])})` : 'unknown',
    date: new Date().toISOString().slice(0, 10),
    commit: process.env.GITHUB_SHA ?? said('git', 'rev-parse', 'HEAD'),
    seconds,
  });
  writeFileSync(join(out, 'device-summary.md'), text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(text);

  const idle = counts(files).filter((s) => s.passed + s.failed === 0);
  const missing = SUITES.length - files.length;
  if (code === 0 && (idle.length || missing)) {
    console.error(
      `ran nothing: ${idle.map((s) => s.suite).join(', ') || 'a suite is not in the report'}`,
    );
    process.exit(3);
  }
  process.exit(code);
}

main();
