import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { endChild, endPid, must } from '../src/index.js';

/** A process that has started, and so has its handlers, with what it has said by then. */
async function started(body: string, detached = false) {
  const child = spawn(process.execPath, ['-e', `${body}; console.log('up');`], {
    detached,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let said = '';
  await new Promise<void>((up) =>
    child.stdout.on('data', (d) => {
      said += String(d);
      if (said.includes('up\n')) up();
    }),
  );
  return { child, said };
}

const STAYS = 'setInterval(() => {}, 1000)';

const ended = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

describe('ending a child', () => {
  it('asks once, and an answer ends the wait', async () => {
    const { child } = await started(`${STAYS}; process.on('SIGTERM', () => process.exit(7))`);
    const at = Date.now();
    await endChild(child, { graceMs: 30_000 });
    expect(child.exitCode).toBe(7);
    expect(Date.now() - at).toBeLessThan(15_000);
  });

  it('goes through what it is asked by, in order, and then past refusing', async () => {
    const heard: string[] = [];
    const { child } = await started(
      `${STAYS}; for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => console.log(s))`,
    );
    child.stdout.on('data', (d) => heard.push(String(d).trim()));
    await endChild(child, { graceMs: 300, signals: ['SIGINT', 'SIGTERM'] });
    expect(child.signalCode).toBe('SIGKILL');
    expect(heard).toEqual(['SIGINT', 'SIGTERM']);
  });

  it('reaches what a group leader started', async () => {
    const { child, said } = await started(
      `const under = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(STAYS)}], { stdio: 'ignore' });
       console.log('under ' + under.pid); ${STAYS}`,
      true,
    );
    const under = Number(/under (\d+)/.exec(said)?.[1]);
    await endChild(child, { graceMs: 2_000, group: true });
    expect(ended(child)).toBe(true);
    await expect.poll(() => isAlive(under), { timeout: 10_000 }).toBe(false);
  });

  it('is not held by what kept its stream and left its group', async () => {
    const { child } = await started(
      `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: ['ignore', 1, 2], detached: true }).unref();`,
      true,
    );
    await endChild(child, { graceMs: 300, group: true });
    expect(ended(child)).toBe(true);
    expect(child.stdout.destroyed).toBe(true);
  });

  it('has nothing to do for what has already gone', async () => {
    const { child } = await started('');
    await once(child, 'close');
    await expect(endChild(child, { graceMs: 30_000 })).resolves.toBeUndefined();
  });
});

describe('ending a process by its pid', () => {
  it('goes through what it is asked by until it has gone, and adds no kill of its own', async () => {
    const heard: string[] = [];
    const { child } = await started(
      `${STAYS}; process.on('SIGTERM', () => console.log('SIGTERM'))`,
    );
    child.stdout.on('data', (d) => heard.push(String(d).trim()));
    const pid = must(child.pid, 'its pid');
    await endPid(pid, { signals: ['SIGTERM'], graceMs: 300, pollMs: 20 });
    expect(isAlive(pid)).toBe(true);
    await endPid(pid, { signals: ['SIGTERM', 'SIGKILL'], graceMs: 2_000, pollMs: 20 });
    expect(isAlive(pid)).toBe(false);
    expect(child.signalCode).toBe('SIGKILL');
    expect(heard).toEqual(['SIGTERM', 'SIGTERM']);
  });

  it('asks no more of one the first signal ended', async () => {
    const { child } = await started(STAYS);
    const pid = must(child.pid, 'its pid');
    const at = Date.now();
    await endPid(pid, { signals: ['SIGTERM', 'SIGKILL'], graceMs: 30_000, pollMs: 20 });
    expect(Date.now() - at).toBeLessThan(15_000);
    expect(child.signalCode).toBe('SIGTERM');
  });
});

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
