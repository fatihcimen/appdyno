import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidAgentLauncher, agentApk } from '../src/agent.js';

const SERIAL = 'emulator-5640';
const LISTENING = '0000: 00000002 00000000 00010000 0001 01 138017 @appdyno_f40fc8831e0ed474\n';
const CONNECTED = '0000: 00000003 00000000 00000000 0001 03 142134 @appdyno_f40fc8831e0ed474\n';

describe('a phone in its two ways in', () => {
  it('has one agent: what is kept of it goes by the phone', async () => {
    const state = mkdtempSync(join(tmpdir(), 'appdyno-agent-'));
    process.env.APPDYNO_STATE_DIR = state;
    writeFileSync(
      join(state, 'android-R68.json'),
      JSON.stringify({ socket: 'appdyno_a', token: 't'.repeat(32), sha256: 'a' }),
    );
    const network = new AndroidAgentLauncher({} as Adb, 'adb-R68-Ab._adb-tls-connect._tcp');
    await expect(network.address()).resolves.toMatchObject({ socket: 'appdyno_a' });
    rmSync(state, { recursive: true, force: true });
  });
});

describe('an agent that holds a device and that this host has no state of', () => {
  let state: string;

  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'appdyno-agent-'));
    process.env.APPDYNO_STATE_DIR = state;
    process.env.APPDYNO_ANDROID_AGENT = join(state, 'agent.apk');
    writeFileSync(process.env.APPDYNO_ANDROID_AGENT, 'an agent');
  });
  afterEach(() => {
    delete process.env.APPDYNO_ANDROID_AGENT;
    rmSync(state, { recursive: true, force: true });
  });

  /** A device where every start is refused, as UI automation is held, and `sockets` is its table of them. */
  const device = async (
    sockets: string,
    { answer = new Error('no such socket'), log = 'AGENT_CONFLICT: UI automation is held\n' } = {},
  ) => {
    const { sha256 } = await agentApk();
    const ran: string[] = [];
    const adb = {
      exec: (_: string, command: string) => {
        ran.push(command);
        if (command.startsWith('sha256sum')) return Promise.resolve(`${sha256} agent.apk`);
        if (command.startsWith('cat ')) return Promise.resolve(log);
        if (command.includes('/proc/net/unix')) return Promise.resolve(sockets);
        if (command.startsWith('pgrep')) return Promise.resolve('1234\n');
        return Promise.resolve('');
      },
      execIn: (_: string, command: string, input: string) => {
        ran.push(`${command} <<< ${input}`);
        return Promise.resolve();
      },
      startDetached: (_: string, command: string) => {
        ran.push(command);
        return Promise.resolve({ close: () => undefined });
      },
      open: () => {
        return Promise.reject(answer);
      },
    } as unknown as Adb;
    return { launcher: new AndroidAgentLauncher(adb, SERIAL), ran };
  };

  it('gives the agent its token in a file only the shell user reads, never on a command line', async () => {
    const { launcher, ran } = await device('');
    await launcher.connect().catch(() => undefined);
    const written = ran.find((c) => c.startsWith('umask 077; cat > '));
    const token = must(/<<< (\w+)$/.exec(must(written, 'the token written'))?.[1], 'the token');
    const started = must(
      ran.find((c) => c.includes('app_process')),
      'the start',
    );
    expect(started).toContain(
      `--token-file ${must(/cat > (\S+)/.exec(written ?? '')?.[1], 'its file')}`,
    );
    expect(ran.filter((c) => c !== written && c.includes(token))).toEqual([]);
  });
  const killed = (ran: string[]) => ran.filter((c) => c.includes('&& kill 1234'));

  it('ends at an agent of another version, which no wait would change', async () => {
    const answer = new DeviceError('AGENT_VERSION_MISMATCH', 'agent protocol 1, host 2');
    const { launcher, ran } = await device('', { answer, log: '' });
    await expect(launcher.connect()).rejects.toMatchObject({
      code: 'AGENT_VERSION_MISMATCH',
      hint: expect.stringContaining('assembleDebug') as unknown,
    });
    // the first answer ended it: a poll reads the log before it asks again
    expect(ran.filter((c) => c.startsWith('cat '))).toEqual([]);
  });

  it('is left to a host connected to it, as a test run from a state folder of its own is', async () => {
    const { launcher, ran } = await device(LISTENING + CONNECTED);
    await expect(launcher.connect()).rejects.toMatchObject({
      code: 'AGENT_CONFLICT',
      message: expect.stringContaining('state folder of its own') as unknown,
    });
    expect(killed(ran)).toEqual([]);
  });

  it('is replaced once when nobody is connected to it, as one from a cleared cache is', async () => {
    const { launcher, ran } = await device(LISTENING);
    await expect(launcher.connect()).rejects.toMatchObject({ code: 'AGENT_CONFLICT' });
    expect(killed(ran)).toHaveLength(1);
  });

  it('is replaced as it was where a device keeps its sockets from a shell', async () => {
    const { launcher, ran } = await device('');
    await expect(launcher.connect()).rejects.toMatchObject({ code: 'AGENT_CONFLICT' });
    expect(killed(ran)).toHaveLength(1);
  });
});
