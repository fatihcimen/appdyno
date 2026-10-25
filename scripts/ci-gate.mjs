// Regression gate of the nightly latency suite: each operation's p50 against the median p50 of the last
// five passing runs in the history; slower by more than 20 % and 10 ms fails. The run is then appended to
// the history (a failed run too, marked, so a regression stays visible but never becomes the baseline).
// Usage: node scripts/ci-gate.mjs <latency.json> <history.jsonl>
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [current, historyPath] = process.argv.slice(2);
const [result] = JSON.parse(readFileSync(current, 'utf8'));
const history = existsSync(historyPath)
  ? readFileSync(historyPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  : [];
const recent = history.filter((h) => h.passed).slice(-5);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : undefined;
};
const failures = [];
const rows = [];
for (const [op, s] of Object.entries(result.ops)) {
  const base = median(recent.map((h) => h.ops[op]?.p50).filter((x) => x !== undefined));
  const slower = base !== undefined && s.p50 > base * 1.2 && s.p50 - base > 10;
  if (s.failed > 0) failures.push(`${op}: ${s.failed} failed`);
  if (slower) failures.push(`${op}: p50 ${s.p50} ms against ${base} ms`);
  rows.push(
    `${slower || s.failed ? 'FAIL' : 'ok  '} ${op}: p50 ${s.p50} ms${base !== undefined ? ` (baseline ${base} ms)` : ' (no baseline yet)'}`,
  );
}
const entry = {
  at: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim(),
  passed: failures.length === 0,
  env: result.before,
  ops: Object.fromEntries(
    Object.entries(result.ops).map(([k, v]) => [k, { p50: v.p50, p95: v.p95, failed: v.failed }]),
  ),
};
appendFileSync(historyPath, `${JSON.stringify(entry)}\n`);
console.log(rows.join('\n'));
if (failures.length) {
  console.error(`regression: ${failures.join('; ')}`);
  process.exit(1);
}
