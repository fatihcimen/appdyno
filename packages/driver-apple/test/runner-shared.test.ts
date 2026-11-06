import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceStateFile, startOf, thisOwner } from '@appdyno/core';
import { fakeAgentStream, TOKEN } from '../../core/test/fake-agent.js';
import { IosRunnerLauncher, type RunnerTransport } from '../src/runner.js';

const UDID = '00000000-0000-4000-8000-000000000001';

describe('a runner of another build on a simulator', () => {
  let state: string;
  let other: ReturnType<typeof spawn>;

  /** Writes what a host before this one left: its runner, and that it uses it. */
  const left = (used: boolean) => {
    writeFileSync(
      join(state, `ios-${UDID}.json`),
      JSON.stringify({ port: 1, token: TOKEN, sha256: 'b'.repeat(64) }),
    );
    const file = deviceStateFile('agent-hosts', UDID);
    mkdirSync(join(file, '..'), { recursive: true });
    const host = { ...thisOwner('host'), pid: other.pid!, started: startOf(other.pid!) };
    writeFileSync(file, JSON.stringify(used ? [host] : []));
  };

  const transport = (): RunnerTransport => ({
    build: async () => ({ xctestrun: 'x', sha256: 'a'.repeat(64) }),
    port: vi.fn(async () => {
      throw new Error('a new runner was asked for');
    }),
    open: async () => {
      const { host } = fakeAgentStream();
      return { socket: Object.assign(host, { setNoDelay: () => undefined }) as unknown as Socket };
    },
  });

  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'appdyno-runner-'));
    process.env.APPDYNO_STATE_DIR = state;
    other = spawn('sleep', ['30'], { stdio: 'ignore' });
  });
  afterEach(() => {
    other.kill('SIGKILL');
    rmSync(state, { recursive: true, force: true });
  });

  it('is used as it is while another live host uses it', async () => {
    left(true);
    const through = transport();
    const found = await new IosRunnerLauncher(UDID, through).connect();
    found.rpc.close();
    expect(found.started).toBe(false);
    expect(through.port).not.toHaveBeenCalled();
  });

  it('gives way when nobody else uses it', async () => {
    left(false);
    const through = transport();
    await expect(new IosRunnerLauncher(UDID, through).connect()).rejects.toThrow(
      'a new runner was asked for',
    );
  });

  it('waits for a start under way and shares what it brings, as two would take the phone from each other', async () => {
    let finish!: () => void;
    const held = new Promise<void>((r) => (finish = r));
    const through = transport();
    vi.mocked(through.port).mockImplementationOnce(async () => {
      await held;
      // what a start leaves as its runner answers; a real one goes on to spawn xcodebuild, which no test may
      writeFileSync(
        join(state, `ios-${UDID}.json`),
        JSON.stringify({ port: 1, token: TOKEN, sha256: 'a'.repeat(64) }),
      );
      throw new Error('this start ends here');
    });
    const first = new IosRunnerLauncher(UDID, through).connect();
    await vi.waitFor(() => expect(through.port).toHaveBeenCalledOnce());
    const second = new IosRunnerLauncher(UDID, through).connect();
    await new Promise((r) => setTimeout(r, 400));
    expect(through.port).toHaveBeenCalledOnce();
    finish();
    await expect(first).rejects.toThrow('this start ends here');
    const found = await second;
    found.rpc.close();
    expect(found.started).toBe(false);
    expect(through.port).toHaveBeenCalledOnce();
  });
});
