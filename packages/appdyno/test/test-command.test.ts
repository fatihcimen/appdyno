import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testCommand } from '../src/test-command.js';

/** A run's folder as a part of a split left it: one file that passed, and `videos` it says it holds. */
function partIn(dir: string, i: number, n: number, videos = 0) {
  const label = `f${i}.flow`;
  const record = {
    schema: 1,
    id: `20261116T101500Z-000${i}`,
    began: '2026-11-16T10:15:00.000Z',
    ended: '2026-11-16T10:15:42.000Z',
    verdict: 'PASS',
    why: [],
    command: ['appdyno', 'test', 'flows', '--shard', `${i}/${n}`],
    shard: { i, n },
    tool: { version: '1.3.0' },
    host: { os: 'darwin 25.6.0', arch: 'arm64', load1: 1 },
    repo: { commit: 'c'.repeat(40), dirty: false },
    devices: [],
    cases: [
      {
        device: 'emulator-5554',
        file: `flows/${label}`,
        label,
        outcome: 'passed',
        ms: 900,
        start: { changed: {} },
        attempts: [{ n: 1, outcome: 'passed', ms: 900, evidence: {} }],
        rerun: `appdyno test flows/${label} --device emulator-5554`,
      },
    ],
    contents: {
      shots: 0,
      painted: 0,
      videos,
      trees: 0,
      logs: 0,
      crashes: 0,
      hars: 0,
      bytes: 0,
      secretsListed: 0,
    },
  };
  const part = join(dir, `part-${i}`);
  mkdirSync(part, { recursive: true });
  writeFileSync(join(part, 'run.json'), JSON.stringify(record));
  return part;
}

describe('appdyno test, of runs that are already there', () => {
  let dir: string;
  let out: string[];
  let errors: string[];
  /** No device is opened by any of these. */
  const run = (...words: string[]) =>
    testCommand(
      words,
      () => {
        throw new Error('a context was opened');
      },
      (line) => errors.push(line),
    );
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-test-command-'));
    out = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => out.push(line));
  });
  afterEach(() => vi.restoreAllMocks());

  it('merges the parts of a split and exits 0, with the verdict and the page said', async () => {
    const whole = join(dir, 'whole');
    const code = await run('merge', partIn(dir, 1, 2), partIn(dir, 2, 2), '--out', whole);
    expect(code).toBe(0);
    expect(out[0]).toBe('PASS: 2 passed, 0 flaky, 0 failed on 1 device in 42s');
    expect(out.at(-1)).toBe(`report: ${join(whole, 'index.html')}`);
    expect(existsSync(join(whole, 'junit.xml'))).toBe(true);
  });

  it('exits 1 where a part is missing, and 2 where the folders cannot be one run or none is named', async () => {
    const [one, three] = [partIn(dir, 1, 3), partIn(dir, 3, 3)];
    expect(await run('merge', one, three, '--out', join(dir, 'short'))).toBe(1);
    expect(out.join('\n')).toContain('because: shard 2/3 did not run');
    expect(await run('merge', one, one, '--out', join(dir, 'twice'))).toBe(2);
    expect(errors.at(-1)).toContain('f1.flow on emulator-5554');
    expect(await run('merge', one)).toBe(2);
    expect(errors.at(-1)).toContain('usage: appdyno test merge <dir>... --out dir');
  });

  it('says what a folder holds, and packs none with a video until told which way', async () => {
    const part = partIn(dir, 1, 1, 2);
    expect(await run('share', part)).toBe(0);
    expect(out[0]).toMatch(/^This folder holds:\n {2}2 videos, NOT painted/);
    const zip = join(dir, 'run.zip');
    expect(await run('share', part, '--zip', zip)).toBe(2);
    expect(errors.at(-1)).toContain('--without video');
    expect(await run('share', part, '--zip', zip, '--without', 'video')).toBe(0);
    expect(out.at(-1)).toBe(`packed in ${zip}`);
    expect(existsSync(zip)).toBe(true);
    expect(await run('share')).toBe(2);
  });

  it("writes the pull request's text again", async () => {
    const body = join(dir, 'body.md');
    expect(await run('comment', partIn(dir, 1, 1), '--out', body)).toBe(0);
    expect(readFileSync(body, 'utf8')).toContain('## appdyno test: PASS');
    expect(out.at(-1)).toBe(body);
  });

  it('exits 2 for a shard that is no part of a split, before it looks for a file', async () => {
    for (const words of ['0/2', '3/2', 'two'])
      expect(await run(join(dir, 'none'), '--shard', words), words).toBe(2);
    expect(errors.at(-1)).toContain('usage: appdyno test <dir or files>');
  });
});
