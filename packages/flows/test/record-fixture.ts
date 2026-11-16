import type { RunCase, RunRecord } from '../src/index.js';

/** A case of a record, passed unless told otherwise. */
export const aCase = (label: string, over: Partial<RunCase> = {}): RunCase => ({
  device: 'emulator-5554',
  file: `flows/${label}`,
  label,
  outcome: 'passed',
  ms: 1200,
  start: { changed: {} },
  attempts: [{ n: 1, outcome: 'passed', ms: 1200, evidence: {} }],
  rerun: `appdyno test flows/${label} --device emulator-5554`,
  ...over,
});

/** A case that failed on a step, with the picture its failure left. */
export const failed = (label: string, over: Partial<RunCase> = {}): RunCase =>
  aCase(label, {
    outcome: 'failed',
    attempts: [
      {
        n: 1,
        outcome: 'failed',
        ms: 900,
        failure: {
          message: 'line 14, step 6: no element matches {"text":"Continue"}',
          detail: `flows/${label}:14: step 6 failed: tap text=Continue\nno element matches`,
          line: 14,
          n: 6,
          step: 'tap text=Continue',
        },
        evidence: {
          shot: `emulator-5554/${label}/screen.png`,
          tree: `emulator-5554/${label}/tree.json`,
        },
      },
    ],
    ...over,
  });

/** A run's record around its cases. */
export const aRecord = (cases: RunCase[], over: Partial<RunRecord> = {}): RunRecord => ({
  schema: 1,
  id: '20261116T101500Z-ab12',
  began: '2026-11-16T10:15:00.000Z',
  ended: '2026-11-16T10:21:12.000Z',
  verdict: cases.some((c) => c.outcome === 'failed') ? 'FAIL' : 'PASS',
  why: [],
  command: ['appdyno', 'test', 'flows'],
  tool: { version: '1.3.0' },
  host: { os: 'darwin 25.6.0', arch: 'arm64', load1: 2.5 },
  repo: { commit: 'a'.repeat(40), branch: 'main', dirty: false },
  devices: [
    {
      serial: 'emulator-5554',
      name: 'Pixel 8',
      platform: 'android',
      os: 'Android 15',
      virtual: true,
      conditions: { dark_mode: 'off' },
    },
  ],
  cases,
  contents: {
    shots: 1,
    painted: 1,
    videos: 0,
    trees: 1,
    logs: 0,
    crashes: 0,
    hars: 0,
    bytes: 2_097_152,
    secretsListed: 2,
  },
  ...over,
});
