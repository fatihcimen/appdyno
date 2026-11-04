import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Who holds something for now, in a file any process can read. */
export type Owner = { pid: number; started: string; tool: string; since: string };

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

/** This process, as a file says it. */
export const thisOwner = (tool: string): Owner => ({
  pid: process.pid,
  started: startOf(process.pid),
  tool,
  since: new Date().toISOString(),
});

/** A pid alone may be some later process's: the start time tells them apart. */
const alive = (o: Owner) => startOf(o.pid) === o.started && o.started !== '';

/** The live owner a file names, if any: a dead one holds nothing. */
export function ownerIn(file: string): Owner | undefined {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8')) as Owner;
    return alive(o) ? o : undefined;
  } catch {
    return undefined;
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
