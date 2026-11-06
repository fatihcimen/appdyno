import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceError } from '@appdyno/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedAgent } from '../src/agent-hosts.js';
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
    const host = { ...thisOwner('host'), pid: child.pid!, started: startOf(child.pid!) };
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
    const reach = vi.fn(async () => agent);
    const found = await sharedAgent(SERIAL, { sha256: THIS_BUILD }, THIS_BUILD, reach);
    expect(found).toMatchObject({ started: false, hello: agent.hello });
  });

  it('is replaced when it is of another build and nobody uses it', async () => {
    const reach = vi.fn(async () => agent);
    expect(await sharedAgent(SERIAL, { sha256: OTHER_BUILD }, THIS_BUILD, reach)).toBeUndefined();
    expect(reach).not.toHaveBeenCalled();
  });

  it('stays under a live host of another build, which would take the device back', async () => {
    anotherHost();
    const found = await sharedAgent(SERIAL, { sha256: OTHER_BUILD }, THIS_BUILD, async () => agent);
    expect(found).toMatchObject({ started: false });
  });

  it('goes once that host has gone', async () => {
    const child = anotherHost();
    await new Promise((gone) => {
      child.once('exit', gone);
      child.kill('SIGKILL');
    });
    const reach = vi.fn(async () => agent);
    expect(await sharedAgent(SERIAL, { sha256: OTHER_BUILD }, THIS_BUILD, reach)).toBeUndefined();
  });

  it('is started anew when it has gone from under a live host', async () => {
    anotherHost();
    const gone = async () => {
      throw new DeviceError('AGENT_UNAVAILABLE', 'nothing listens');
    };
    expect(await sharedAgent(SERIAL, { sha256: OTHER_BUILD }, THIS_BUILD, gone)).toBeUndefined();
  });

  it('is left to a live host when this one cannot speak to it, and says who that is', async () => {
    const child = anotherHost();
    const refused = async () => {
      throw new DeviceError('AGENT_VERSION_MISMATCH', 'agent protocol 1, host 2');
    };
    await expect(
      sharedAgent(SERIAL, { sha256: OTHER_BUILD }, THIS_BUILD, refused),
    ).rejects.toMatchObject({
      code: 'AGENT_VERSION_MISMATCH',
      message: expect.stringContaining(String(child.pid)),
    });
  });

  it('counts this process as nobody else, however often it asks', async () => {
    const reach = vi.fn(async () => agent);
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
    await sharedAgent(SERIAL, undefined, THIS_BUILD, async () => agent);
    expect(hosts.read(SERIAL)?.map((o) => o.pid)).toEqual([process.pid]);
  });
});
