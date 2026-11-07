import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { windowSends } from '../src/window-sends.js';
import { followDevice } from '../src/follow.js';
import { FakeDevice } from '../../ops/test/fake-device.js';

describe('what a window sends to its device', () => {
  let state: string;
  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'appdyno-state-'));
    process.env.APPDYNO_STATE_DIR = state;
  });
  afterEach(() => rmSync(state, { recursive: true, force: true }));

  const sendsOn = (device: FakeDevice, policy = DEFAULT_POLICY) => {
    const told: Record<string, unknown>[] = [];
    const sends = windowSends(new ServerContext(policy, []), device, () => ({
      tell: (m) => void told.push(m),
    }));
    /** What the window is told last of a link: its answer, once the op has given one. */
    const answer = async () => {
      await expect.poll(() => told.some((m) => 'ok' in m)).toBe(true);
      return told.find((m) => 'ok' in m)!;
    };
    const open = (url: string) => {
      told.length = 0;
      expect(sends.onWindow({ op: 'control', name: 'openLink', url })).toBe(true);
      return answer();
    };
    return { sends, told, open };
  };

  it("opens a link by the agent's own op, and remembers it for this device", async () => {
    const device = new FakeDevice();
    const { open, sends, told } = sendsOn(device);
    expect(await open(' app://screen/form ')).toEqual({
      op: 'answer',
      name: 'openLink',
      ok: true,
      text: 'Opened app://screen/form',
      recent: ['app://screen/form'],
    });
    expect(device.calls.filter((c) => c.name === 'openUrl')[0]?.args[0]).toBe('app://screen/form');
    await open('https://example.test/item/7');
    await open('app://screen/form');
    told.length = 0;
    sends.onWindow({ op: 'control', name: 'links' });
    expect(told).toEqual([
      {
        op: 'answer',
        name: 'openLink',
        recent: ['app://screen/form', 'https://example.test/item/7'],
      },
    ]);
  });

  it('says a refusal as the op does, with what to do, and opens nothing', async () => {
    const device = new FakeDevice();
    const { open } = sendsOn(device, { ...DEFAULT_POLICY, urls: /^https:\/\/example\.test\// });
    expect(await open('https://elsewhere.test/')).toMatchObject({
      ok: false,
      text: "this link is not on this server's allow list",
      recent: [],
    });
    expect(await open('ab')).toMatchObject({
      ok: false,
      text: expect.stringContaining('url'),
      hint: 'change that and call again: nothing was done',
    });
    expect(device.calls.some((c) => c.name === 'openUrl')).toBe(false);
  });

  it('leaves what is not its own to the rest of the window', () => {
    const { sends } = sendsOn(new FakeDevice());
    expect(sends.onWindow({ op: 'control', name: 'record' })).toBe(false);
    expect(sends.onWindow({ op: 'app', action: 'list' })).toBe(false);
  });

  it("keeps a person's own link out of what an agent is said to do", async () => {
    const device = new FakeDevice();
    const seen: Record<string, unknown>[] = [];
    const off = followDevice(device.serial, { tell: (m) => seen.push(m) });
    try {
      await sendsOn(device).open('app://screen/form');
      await new Promise((r) => setTimeout(r, 600));
      expect(seen.filter((m) => m.op === 'agent' || m.op === 'activity')).toEqual([]);
    } finally {
      off();
    }
  });
});
