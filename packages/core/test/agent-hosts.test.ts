import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceError } from '@appdyno/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noting } from '../src/call.js';
import { must } from '../src/must.js';
import { agentEnded, agentMet, sharedAgent } from '../src/agent-hosts.js';
import { startOf, thisOwner, type Owner } from '../src/owner.js';
import type { RpcClient } from '../src/rpc.js';
import { deviceState } from '../src/state.js';

const SERIAL = 'emulator-5640';
const THIS_BUILD = 'a'.repeat(64);
const OTHER_BUILD = 'b'.repeat(64);

const agent = { rpc: {} as RpcClient, hello: { model: 'Pixel' } as never };
const hosts = deviceState('agent-hosts', { parse: (x: unknown) => x as Owner[] });

describe('an agent found on a device', () => {
  let state: string;
  const running: ReturnType<typeof spawn>[] = [];

  /** Another process of this Mac, using the device's agent. */
  const anotherHost = () => {
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    running.push(child);
    const pid = must(child.pid, 'its pid');
    const host = { ...thisOwner('host'), pid, started: startOf(pid) };
    hosts.write(SERIAL, [...(hosts.read(SERIAL) ?? []), host]);
    return child;
  };

  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'appdyno-hosts-'));
    process.env.APPDYNO_STATE_DIR = state;
  });
  afterEach(() => {
    for (const child of running.splice(0)) child.kill('SIGKILL');
    rmSync(state, { recursive: true, force: true });
  });

  it('is used when it is of this build', async () => {
    const reach = vi.fn(() => Promise.resolve(agent));
    const found = await sharedAgent(SERIAL, { sha256: THIS_BUILD }, THIS_BUILD, reach);
    expect(found).toMatchObject({ started: false, hello: agent.hello });
  });

  it('is replaced when it is of another build and nobody uses it', async () => {
    const reach = vi.fn(() => Promise.resolve(agent));
    expect(await sharedAgent(SERIAL, { sha256: OTHER_BUILD }, THIS_BUILD, reach)).toBeUndefined();
    expect(reach).not.toHaveBeenCalled();
  });

  it('stays under a live host of another build, which would take the device back', async () => {
    const pid = must(anotherHost().pid, 'its pid');
    const old = { ...agent, hello: { model: 'Pixel', agentVersion: '1.0.0' } as never };
    const { value: found, notes } = await noting(() =>
      sharedAgent(SERIAL, { sha256: OTHER_BUILD }, THIS_BUILD, () => Promise.resolve(old)),
    );
    expect(found).toMatchObject({ started: false });
    // the answer says whose agent it is, as its version read as this server's
    expect(notes).toEqual([
      `the agent on ${SERIAL} is 1.0.0, of another build than this one's, which pid ${pid} uses: this one's starts once that process has gone`,
    ]);
  });

  it('is replaced under a live host where it is older than this host, and that host is told why', async () => {
    anotherHost();
    const closed = vi.fn();
    const old = { rpc: { close: closed } as unknown as RpcClient, hello: { pid: 77 } as never };
    const { value: found, notes } = await noting(() =>
      sharedAgent(
        SERIAL,
        { sha256: OTHER_BUILD },
        THIS_BUILD,
        () => Promise.resolve(old),
        undefined,
        () => 'of protocol 2.0, older than this host',
      ),
    );
    expect(found).toBeUndefined();
    expect(closed).toHaveBeenCalledOnce();
    const why = 'it was of protocol 2.0, older than this host';
    expect(notes).toEqual([`the agent on ${SERIAL} is replaced by this host's: ${why}`]);
    const ended = deviceState('agent-ended', { parse: (x: unknown) => x as object });
    expect(ended.read(SERIAL)).toEqual({ pid: 77, by: process.pid, why });
  });

  it('goes once that host has gone', async () => {
    const child = anotherHost();
    await new Promise((gone) => {
      child.once('exit', gone);
      child.kill('SIGKILL');
    });
    const reach = vi.fn(() => Promise.resolve(agent));
    expect(await sharedAgent(SERIAL, { sha256: OTHER_BUILD }, THIS_BUILD, reach)).toBeUndefined();
  });

  it('is started anew when it has gone from under a live host', async () => {
    anotherHost();
    const gone = () => Promise.reject(new DeviceError('AGENT_UNAVAILABLE', 'nothing listens'));
    expect(await sharedAgent(SERIAL, { sha256: OTHER_BUILD }, THIS_BUILD, gone)).toBeUndefined();
  });

  it('is left to a live host when this one cannot speak to it, and says who that is', async () => {
    const child = anotherHost();
    const refused = () =>
      Promise.reject(new DeviceError('AGENT_VERSION_MISMATCH', 'agent protocol 1, host 2'));
    await expect(
      sharedAgent(SERIAL, { sha256: OTHER_BUILD }, THIS_BUILD, refused),
    ).rejects.toMatchObject({
      code: 'AGENT_VERSION_MISMATCH',
      message: expect.stringContaining(String(child.pid)) as unknown,
    });
  });

  describe('whose hello ran out of time', () => {
    const late = () => Promise.reject(new DeviceError('TIMEOUT', 'hello did not answer'));

    it('is asked once more, with the whole of the time a hello has, where a live host uses it', async () => {
      anotherHost();
      const reach = vi.fn<(s: object, ms?: number) => Promise<typeof agent>>(() =>
        Promise.resolve(agent),
      );
      reach.mockImplementationOnce(late);
      const found = await sharedAgent(SERIAL, { sha256: THIS_BUILD }, THIS_BUILD, reach);
      expect(found).toMatchObject({ started: false });
      expect(reach.mock.calls.map(([, ms]) => ms)).toEqual([undefined, 10_000]);
    });

    it('is left running under a live host when it is silent again, and the refusal says who uses it', async () => {
      const child = anotherHost();
      const reach = vi.fn(late);
      await expect(
        sharedAgent(SERIAL, { sha256: THIS_BUILD }, THIS_BUILD, reach),
      ).rejects.toMatchObject({
        code: 'AGENT_UNAVAILABLE',
        retryable: true,
        message: `the agent on ${SERIAL} did not answer in 10 s, and was left running: pid ${String(child.pid)} uses it`,
      });
      expect(reach).toHaveBeenCalledTimes(2);
    });

    it('is started anew when its process is dead, or when nobody else uses it', async () => {
      const alone = vi.fn(late);
      expect(await sharedAgent(SERIAL, { sha256: THIS_BUILD }, THIS_BUILD, alone)).toBeUndefined();
      // its own to end: no second go holds up the start of another
      expect(alone).toHaveBeenCalledTimes(1);
      anotherHost();
      const dead = () => false;
      expect(
        await sharedAgent(SERIAL, { sha256: THIS_BUILD }, THIS_BUILD, late, dead),
      ).toBeUndefined();
    });
  });

  it('says why another host ended the agent this one had, where it finds another in its place', () => {
    const said = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const ended = deviceState('agent-ended', { parse: (x: unknown) => x as object });
    agentMet(SERIAL, 10);
    ended.write(SERIAL, { pid: 10, by: 4242, why: 'stuck: it was restarted' });
    agentMet(SERIAL, 20, 'the agent connection closed');
    expect(said).toHaveBeenLastCalledWith(
      `the agent on ${SERIAL} stopped (pid 4242 ended it: stuck: it was restarted), and another took its place\n`,
    );
    // its own ending is its own to say, and a note of an agent before the last says nothing of this one
    agentEnded(SERIAL, 20, 'stuck: mine');
    agentMet(SERIAL, 30, 'as this process has it');
    agentMet(SERIAL, 40, 'closed');
    expect(said.mock.calls.slice(-2).map(([line]) => line)).toEqual([
      `the agent on ${SERIAL} stopped (as this process has it), and another took its place\n`,
      `the agent on ${SERIAL} stopped (closed), and another took its place\n`,
    ]);
    said.mockRestore();
  });

  it('counts this process as nobody else, however often it asks', async () => {
    const reach = vi.fn(() => Promise.resolve(agent));
    await sharedAgent(SERIAL, undefined, THIS_BUILD, reach);
    await sharedAgent(SERIAL, undefined, THIS_BUILD, reach);
    expect(hosts.read(SERIAL)).toHaveLength(1);
    expect(await sharedAgent(SERIAL, { sha256: OTHER_BUILD }, THIS_BUILD, reach)).toBeUndefined();
  });

  it('leaves the dead out of what it keeps', async () => {
    const child = anotherHost();
    await new Promise((gone) => {
      child.once('exit', gone);
      child.kill('SIGKILL');
    });
    await sharedAgent(SERIAL, undefined, THIS_BUILD, () => Promise.resolve(agent));
    expect(hosts.read(SERIAL)?.map((o) => o.pid)).toEqual([process.pid]);
  });
});
