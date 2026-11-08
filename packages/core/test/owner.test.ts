import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { must } from '../src/must.js';
import {
  exclusively,
  heldElsewhere,
  isAlive,
  isThisProcess,
  processAlive,
  ownerGone,
  ownerIn,
  thisOwner,
} from '../src/index.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'appdyno-owner-')), 'a', 'held.json');
const busy = (o: { tool: string }) => new Error(`held by ${o.tool}`);

describe('one at a time', () => {
  it('refuses a second holder in this process, and frees it at the end', async () => {
    const f = file();
    let inner: unknown;
    await exclusively(f, 'first', busy, async () => {
      inner = await exclusively(f, 'second', busy, () => Promise.resolve('ran')).catch(
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
    });
    expect(inner).toBe('held by first');
    expect(existsSync(f)).toBe(false);
    await expect(exclusively(f, 'third', busy, () => Promise.resolve('ran'))).resolves.toBe('ran');
  });

  it('frees it when the body fails', async () => {
    const f = file();
    await expect(
      exclusively(f, 'x', busy, () => {
        return Promise.reject(new Error('it failed'));
      }),
    ).rejects.toThrow('it failed');
    expect(existsSync(f)).toBe(false);
  });

  it('takes over what a dead process left', async () => {
    const f = file();
    const dead = spawnSync('true').pid;
    await exclusively(f, 'held', busy, () => {
      writeFileSync(f, JSON.stringify({ ...thisOwner('old'), pid: dead }));
      expect(ownerIn(f)).toBeUndefined();
      return Promise.resolve();
    });
    writeFileSync(f, JSON.stringify({ ...thisOwner('old'), pid: dead }));
    await expect(exclusively(f, 'new', busy, () => Promise.resolve('ran'))).resolves.toBe('ran');
  });

  it('reads a broken file as no owner', async () => {
    const f = file();
    await exclusively(f, 'x', busy, () => {
      writeFileSync(f, 'not json');
      expect(ownerIn(f)).toBeUndefined();
      return Promise.resolve();
    });
  });
});

/** A process that runs until killed, and what a file would say of it. */
function otherProcess() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  const pid = must(child.pid, 'its pid');
  const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
  }).trim();
  const kill = async () => {
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
  };
  return { owner: { pid, started, tool: 'other', since: 'then' }, kill };
}

describe('who owns a file', () => {
  it('tells a running process from one that is gone, by its pid alone', () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(spawnSync('true').pid)).toBe(false);
  });

  it('knows this process, a live one and a dead one', async () => {
    const me = thisOwner('here');
    expect(me.pid).toBe(process.pid);
    expect(isAlive(me)).toBe(true);
    expect(isThisProcess(me)).toBe(true);
    expect(heldElsewhere(me)).toBe(false);
    expect(ownerGone(me)).toBe(false);
    const other = otherProcess();
    const { owner } = other;
    expect(isAlive(owner)).toBe(true);
    expect(isThisProcess(owner)).toBe(false);
    expect(heldElsewhere(owner)).toBe(true);
    expect(ownerGone(owner)).toBe(false);
    await other.kill();
    expect(isAlive(owner)).toBe(false);
    expect(heldElsewhere(owner)).toBe(false);
    expect(ownerGone(owner)).toBe(true);
  });

  it('tells a pid used again by another process from its first owner', () => {
    const before = { ...thisOwner('here'), started: 'long ago' };
    expect(isThisProcess(before)).toBe(false);
    expect(isAlive(before)).toBe(false);
    expect(ownerGone(before)).toBe(true);
  });

  it('holds no file with no owner to anyone: a command line’s stays until asked', () => {
    expect(isThisProcess(undefined)).toBe(false);
    expect(heldElsewhere(undefined)).toBe(false);
    expect(ownerGone(undefined)).toBe(false);
  });

  it('reads a file of another shape as no owner', () => {
    const f = file();
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify({ pid: process.pid }));
    expect(ownerIn(f)).toBeUndefined();
  });
});
