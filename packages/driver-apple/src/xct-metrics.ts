import { callSignal, run, tracesDir, type Measured, type XctMetrics } from '@appdyno/core';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DeviceError } from '@appdyno/protocol';
import { launchLanguage } from './manage.js';
import { xcodeEnv } from './simctl.js';
import { parseXctMetrics } from './trace-parse.js';

/** One `measure()` test of the runner's bundle in a run of its own, and what its result bundle holds. */
export async function recordXctMetrics(
  udid: string,
  xctestrun: string,
  bundle: string,
  test: 'launch' | 'hitches',
): Promise<Measured<XctMetrics>> {
  const name = test === 'hitches' ? 'testHitches' : 'testLaunch';
  const dir = tracesDir();
  await mkdir(dir, { recursive: true });
  const resultBundle = join(dir, `xct-${test}-${Date.now()}.xcresult`);
  // with none named, each run leaves a folder of its own in Xcode's DerivedData
  const derived = `${resultBundle}.derived`;
  const failed = (why: string) =>
    new DeviceError(
      'UNSUPPORTED',
      `XCTest's ${test} metric: ${why}`,
      `the result bundle is at ${resultBundle}`,
    );
  const signal = callSignal();
  await run(
    'xcodebuild',
    [
      'test-without-building',
      '-xctestrun',
      xctestrun,
      '-destination',
      `id=${udid}`,
      `-only-testing:Runner/PerfMetricsTests/${name}`,
      '-derivedDataPath',
      derived,
      '-resultBundlePath',
      resultBundle,
    ],
    {
      env: {
        ...xcodeEnv(),
        TEST_RUNNER_APPDYNO_METRICS_APP: bundle,
        TEST_RUNNER_APPDYNO_METRICS_ARGS: launchLanguage(udid, bundle).join('\n'),
      },
      maxBuffer: 256 * 1024 * 1024,
      timeout: 600_000,
      ...(signal && { signal }),
    },
  )
    .catch((e: unknown) => {
      const { stdout, message } = e as { stdout?: string; message: string };
      throw failed((stdout ?? message).trim().split('\n').slice(-3).join(' ').slice(0, 300));
    })
    .finally(() => rm(derived, { recursive: true, force: true }));
  const { stdout } = await run(
    'xcrun',
    [
      'xcresulttool',
      'get',
      'test-results',
      'metrics',
      '--path',
      resultBundle,
      '--test-id',
      `PerfMetricsTests/${name}()`,
      '--compact',
    ],
    { env: xcodeEnv(), maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
  );
  const metrics = parseXctMetrics(stdout);
  if (!Object.keys(metrics).length) throw failed('the test ran and recorded no value');
  return {
    value: { metrics, resultBundle },
    raw: stdout,
    at: new Date().toISOString(),
    source: 'XCTest measure()',
  };
}
