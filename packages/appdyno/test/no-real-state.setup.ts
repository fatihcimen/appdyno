import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Runs in every worker of a unit test run, before any test: a call on this Mac's own state folder is a breach, whoever
 * makes it and whatever swallows the error, as the prune's own `catch` did. It throws, and it leaves a line that fails the
 * run at its end (`no-real-state.teardown.ts`). Real traces were pruned this way once, by tests that looked at them.
 */
const REAL = join(userInfo().homedir, 'Library/Caches/appdyno').toLowerCase();

/** Every call that takes a path first, or a path second for those that copy or move. */
const CALLS = [
  'access',
  'appendFile',
  'chmod',
  'copyFile',
  'cp',
  'exists',
  'lstat',
  'mkdir',
  'mkdtemp',
  'open',
  'opendir',
  'readdir',
  'readFile',
  'readlink',
  'realpath',
  'rename',
  'rm',
  'rmdir',
  'stat',
  'symlink',
  'truncate',
  'unlink',
  'utimes',
  'writeFile',
];

const breachFile = process.env.APPDYNO_TEST_BREACH_FILE;
if (breachFile === undefined)
  throw new Error('APPDYNO_TEST_BREACH_FILE is missing: vitest.config.ts sets it');
const note = fs.appendFileSync;

/** A test of this guard itself sets this: what it provokes is no breach. */
export const provoked = { now: false };

const isReal = (p: unknown): p is string | URL | Buffer => {
  const path = p instanceof URL ? p.pathname : Buffer.isBuffer(p) ? p.toString() : p;
  return typeof path === 'string' && `${resolve(path).toLowerCase()}/`.startsWith(`${REAL}/`);
};

const watch = (on: Record<string, unknown>, name: string, promised = false) => {
  const real = on[name];
  if (typeof real !== 'function') return;
  on[name] = function (this: unknown, ...args: unknown[]) {
    const hit = args.slice(0, 2).find(isReal);
    if (hit === undefined) return real.apply(this, args) as unknown;
    if (!provoked.now) note(breachFile, `${name} ${String(hit)}\n`);
    const refused = new Error(`a unit test reached this Mac's own state: ${name} ${String(hit)}`);
    if (promised) return Promise.reject(refused);
    throw refused;
  };
};

for (const call of CALLS) {
  watch(fs, call);
  watch(fs, `${call}Sync`);
  watch(fs.promises, call, true);
}
syncBuiltinESMExports();
