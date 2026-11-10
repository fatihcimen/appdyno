import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/** When a process started, as `ps` says it; empty when it has gone. */
export const startOf = (pid: number) => {
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

/** Whether a process of this Mac runs, by its pid alone; EPERM: it runs, as another user. */
export const processAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export const isAlive = (o: Pick<Owner, 'pid' | 'started'>) =>
  o.started !== '' && startOf(o.pid) === o.started;

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

/** `file` made with this owner in it, whole from its first byte, unless it is there: a file half written read as no owner. */
function claim(file: string, tool: string) {
  const mine = `${file}.${process.pid}.new`;
  writeFileSync(mine, JSON.stringify(thisOwner(tool)), { mode: 0o600 });
  try {
    linkSync(mine, file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  } finally {
    rmSync(mine, { force: true });
  }
}

/**
 * A dead holder's file moved aside, which one process alone can do to it: what moved is read back, and a live one, which
 * another process had put there meanwhile, goes back. Two processes that each removed it took it over both.
 */
// shortcut: a third process may claim it in the moment a live one is aside, and both hold; a lock of the system's
// (flock) closes that if three ever race for one dead holder's file
function putAside(file: string) {
  const aside = `${file}.${process.pid}.old`;
  try {
    renameSync(file, aside);
  } catch {
    return; // another process moved it first
  }
  try {
    if (ownerIn(aside)) linkSync(aside, file);
  } catch {
    // a third process claimed it in that moment: the shortcut above
  } finally {
    rmSync(aside, { force: true });
  }
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
  for (let tries = 1; !claim(file, tool); tries++) {
    const holder = ownerIn(file);
    if (holder) throw busy(holder);
    if (tries === 3) throw new Error(`${file} was left by a dead process again and again`);
    putAside(file);
  }
  try {
    return await body();
  } finally {
    rmSync(file, { force: true });
  }
}
