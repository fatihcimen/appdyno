import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidAgentLauncher, agentApk } from '../src/agent.js';

const SERIAL = 'emulator-5640';
const LISTENING = '0000: 00000002 00000000 00010000 0001 01 138017 @appdyno_f40fc8831e0ed474\n';
const CONNECTED = '0000: 00000003 00000000 00000000 0001 03 142134 @appdyno_f40fc8831e0ed474\n';

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
  const device = async (sockets: string) => {
    const { sha256 } = await agentApk();
    const ran: string[] = [];
    const adb = {
      exec: async (_: string, command: string) => {
        ran.push(command);
        if (command.startsWith('sha256sum')) return `${sha256} agent.apk`;
        if (command.startsWith('cat ')) return 'AGENT_CONFLICT: UI automation is held\n';
        if (command.includes('/proc/net/unix')) return sockets;
        if (command.startsWith('pgrep')) return '1234\n';
        return '';
      },
      startDetached: async () => ({ close: () => undefined }),
      open: async () => {
        throw new Error('no such socket');
      },
    } as unknown as Adb;
    return { launcher: new AndroidAgentLauncher(adb, SERIAL), ran };
  };
  const killed = (ran: string[]) => ran.filter((c) => /&& kill 1234/.test(c));

  it('is left to a host connected to it, as a test run from a state folder of its own is', async () => {
    const { launcher, ran } = await device(LISTENING + CONNECTED);
    await expect(launcher.connect()).rejects.toMatchObject({
      code: 'AGENT_CONFLICT',
      message: expect.stringContaining('state folder of its own'),
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
