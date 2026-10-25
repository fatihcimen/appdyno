import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const GATE = new URL('../../../scripts/ci-gate.mjs', import.meta.url).pathname;
const run = (
  ops: Record<string, { p50: number; p95?: number; failed?: number }>,
  history: object[],
) => {
  const dir = mkdtempSync(join(tmpdir(), 'gd-gate-'));
  const cur = join(dir, 'latency.json');
  const hist = join(dir, 'history.jsonl');
  writeFileSync(
    cur,
    JSON.stringify([
      {
        before: {},
        ops: Object.fromEntries(
          Object.entries(ops).map(([k, v]) => [k, { p95: v.p50, failed: 0, ...v }]),
        ),
      },
    ]),
  );
  writeFileSync(
    hist,
    history.map((h) => JSON.stringify(h)).join('\n') + (history.length ? '\n' : ''),
  );
  try {
    execFileSync(process.execPath, [GATE, cur, hist], { stdio: 'pipe' });
    return {
      ok: true,
      history: readFileSync(hist, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l)),
    };
  } catch {
    return {
      ok: false,
      history: readFileSync(hist, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l)),
    };
  }
};
const past = (p50: number, passed = true) => ({ passed, ops: { 'read.home': { p50 } } });

describe('nightly regression gate', () => {
  it('passes the first run and records it as a baseline', () => {
    const r = run({ 'read.home': { p50: 9 } }, []);
    expect(r.ok).toBe(true);
    expect(r.history.at(-1)).toMatchObject({ passed: true, ops: { 'read.home': { p50: 9 } } });
  });

  it('fails over 20 % and 10 ms slower than the median of the last passing runs', () => {
    const h = [past(100), past(102), past(98), past(500, false)];
    expect(run({ 'read.home': { p50: 115 } }, h).ok).toBe(true); // +15 %
    expect(run({ 'read.home': { p50: 130 } }, h).ok).toBe(false); // +30 %, +30 ms
    expect(run({ 'read.home': { p50: 15 } }, [past(9), past(9)]).ok).toBe(true); // +67 % but only 6 ms
  });

  it('fails on any failed operation and keeps a failing run out of the baseline', () => {
    const r = run({ 'read.home': { p50: 9, failed: 1 } }, [past(9)]);
    expect(r.ok).toBe(false);
    expect(r.history.at(-1)!.passed).toBe(false);
  });
});
