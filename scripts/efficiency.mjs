#!/usr/bin/env node
// What an agent pays for a task, with no device: the calls it takes and the characters of their answers.
//   node scripts/efficiency.mjs [--answers]     --answers: every call's whole answer as well
//
// It runs packages/ops/test/efficiency: a client in this process makes each task's calls on the recorded screens of
// the test fixtures, as a reader that follows the server's own words would, and every answer is measured as the
// client gets it, its text and its structured content. Run it before and after a change to an answer, a hint or the
// instructions. The sizes are characters: a model's tokens are about a third of them.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'appdyno-efficiency-'));
const out = join(dir, 'table.md');
const run = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', 'packages/ops/test/efficiency/efficiency.test.ts'],
  {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, APPDYNO_EFFICIENCY_OUT: out },
    encoding: 'utf8',
  },
);
try {
  console.log(readFileSync(out, 'utf8'));
  if (process.argv.includes('--answers')) console.log(readFileSync(`${out}.answers`, 'utf8'));
} catch {
  console.error(run.stdout, run.stderr);
}
rmSync(dir, { recursive: true, force: true });
if (run.status !== 0) {
  console.error(
    'the tasks no longer take the calls the test holds them to: see its output with pnpm test',
  );
  process.exit(1);
}
