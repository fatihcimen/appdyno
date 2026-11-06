import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HELD_BY_HUB, endWithHub } from '../src/lifetime.js';
import { childFile } from './child-file.js';

const dir = mkdtempSync(join(tmpdir(), 'appdyno-hub-dies-'));
const processes = join(dir, 'processes.mjs');
const started: ChildProcess[] = [];
const commands: number[] = [];

beforeAll(() => childFile('test/hub-dies.child.ts', processes));

afterAll(() => {
  for (const pid of commands) signalled(pid, 'SIGKILL');
  for (const c of started) c.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
});

function signalled(pid: number, signal: NodeJS.Signals | 0) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** A hub with one command under way, and that command's pid. */
async function hubWith(behaviour: string) {
  const hub = spawn(process.execPath, [processes, 'hub', behaviour], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  started.push(hub);
  const pid = await new Promise<number>((resolve, reject) => {
    let said = '';
    hub.stdout.on('data', (chunk) => {
      said += String(chunk);
      const up = /up (\d+)/.exec(said);
      if (up) resolve(Number(up[1]));
    });
    hub.once('exit', () => reject(new Error(`the hub ended first: ${said}`)));
  });
  commands.push(pid);
  return { hub, pid };
}

describe('a hub that dies with no word', () => {
  it('takes its command with it', async () => {
    const { hub, pid } = await hubWith('runs');
    expect(signalled(pid, 0)).toBe(true);
    hub.kill('SIGKILL');
    await expect.poll(() => signalled(pid, 0), { timeout: 20_000 }).toBe(false);
  });

  it('takes one that refuses a Ctrl-C too', async () => {
    const { hub, pid } = await hubWith('refuses');
    hub.kill('SIGKILL');
    await expect.poll(() => signalled(pid, 0), { timeout: 30_000 }).toBe(false);
  });
});

describe('a command', () => {
  const stream = () => ({ once: vi.fn(), resume: vi.fn(), unref: vi.fn() });

  it('with no hub leaves its stdin alone', () => {
    vi.stubEnv(HELD_BY_HUB, '');
    const stdin = stream();
    endWithHub(stdin as never, vi.fn());
    expect(stdin.resume).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('keeps the word to itself, and is not held by its stdin', () => {
    vi.stubEnv(HELD_BY_HUB, '1');
    const stdin = stream();
    const signal = vi.fn();
    endWithHub(stdin as never, signal);
    expect(process.env[HELD_BY_HUB]).toBeUndefined();
    expect(stdin.unref).toHaveBeenCalledOnce();
    expect(signal).not.toHaveBeenCalled();
    vi.useFakeTimers();
    stdin.once.mock.calls[0]![1]();
    expect(signal.mock.calls).toEqual([['SIGINT']]);
    vi.advanceTimersByTime(60_000);
    expect(signal.mock.calls).toEqual([['SIGINT'], ['SIGKILL']]);
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
});
