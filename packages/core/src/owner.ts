import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { readState } from './state.js';

/** Who holds something for now, in a file any process can read. */
export const Owner = z.object({
  pid: z.number(),
  /** A pid alone may be some later process's: the start time tells them apart. */
  started: z.string(),
  tool: z.string(),
  since: z.string(),
});
export type Owner = z.infer<typeof Owner>;

const startOf = (pid: number) => {
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

let started: string | undefined;

const startedHere = () => (started ??= startOf(process.pid));

/** This process, as a file says it. */
export const thisOwner = (tool: string): Owner => ({
  pid: process.pid,
  started: startedHere(),
  tool,
  since: new Date().toISOString(),
});

export const isAlive = (o: Owner) => o.started !== '' && startOf(o.pid) === o.started;

/** No owner is a command line's: its process ends with the command, and what it set stays until asked. */
export const isThisProcess = (o: Owner | undefined) =>
  o?.pid === process.pid && o.started === startedHere();

export const heldElsewhere = (o: Owner | undefined) => !!o && !isThisProcess(o) && isAlive(o);

export const ownerGone = (o: Owner | undefined) => !!o && !isThisProcess(o) && !isAlive(o);

/** The live owner a file names, if any: a dead one holds nothing. */
export function ownerIn(file: string): Owner | undefined {
  const o = readState(file, Owner);
  return o && isAlive(o) ? o : undefined;
}

/**
 * `body` with `file` held, one holder at a time across processes and within this one; `busy` makes the refusal from who
 * holds it. A file left by a dead process is taken over.
 */
export async function exclusively<T>(
  file: string,
  tool: string,
  busy: (holder: Owner) => Error,
  body: () => Promise<T>,
): Promise<T> {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const take = () =>
    writeFileSync(file, JSON.stringify(thisOwner(tool)), { flag: 'wx', mode: 0o600 });
  try {
    take();
  } catch {
    const holder = ownerIn(file);
    if (holder) throw busy(holder);
    rmSync(file, { force: true });
    take();
  }
  try {
    return await body();
  } finally {
    rmSync(file, { force: true });
  }
}
