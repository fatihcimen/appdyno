import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppManager, DeviceEvents } from '@appdyno/core';
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
    return { sends, told, open, answer };
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
    await expect
      .poll(() => told)
      .toEqual([
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

  it("lists the pushes the device takes, with the app in front, and sends one by the agent's op", async () => {
    const device = new FakeDevice();
    const pushed: unknown[] = [];
    const routes = [
      { type: 'alert', route: 'by hand', fields: ['title', 'data'], template: '{"aps":{}}' },
      { type: 'tapped', why: 'no hand' },
    ];
    device.events = {
      pushRoutes: () => routes,
      push: async (app: string, push: unknown) => {
        pushed.push([app, push]);
        return `pushed to ${app}`;
      },
    } as unknown as DeviceEvents;
    const front = await device.foreground();
    device.apps = { listApps: async () => [{ id: front }] } as unknown as AppManager;
    const { sends, told, answer } = sendsOn(device);
    sends.onWindow({ op: 'control', name: 'pushes' });
    await expect
      .poll(() => told.find((m) => 'types' in m))
      .toEqual({
        op: 'answer',
        name: 'push',
        types: routes,
        app: front,
      });
    told.length = 0;
    const args = { app: 'dev.app', type: 'alert', title: 'Order 42', data: { order: '42' } };
    expect(sends.onWindow({ op: 'control', name: 'push', args })).toBe(true);
    expect(await answer()).toMatchObject({ name: 'push', ok: true, text: 'Pushed to dev.app' });
    expect(pushed).toEqual([
      ['dev.app', { type: 'alert', title: 'Order 42', data: { order: '42' } }],
    ]);
    told.length = 0;
    sends.onWindow({ op: 'control', name: 'push', args: { ...args, payload: '{"aps":{}}' } });
    expect(await answer()).toMatchObject({
      ok: false,
      text: 'payload replaces the fields: give one or the other',
    });
    expect(pushed).toHaveLength(1);
  });

  it('opens a link in the app the pane names, the app in front first, through the policy', async () => {
    const device = new FakeDevice();
    const front = await device.foreground();
    device.apps = { listApps: async () => [{ id: front }] } as unknown as AppManager;
    const { sends, told, answer } = sendsOn(device, { ...DEFAULT_POLICY, apps: [front!] });
    sends.onWindow({ op: 'control', name: 'links' });
    await expect.poll(() => told.find((m) => 'recent' in m)).toMatchObject({ app: front });
    told.length = 0;
    sends.onWindow({ op: 'control', name: 'openLink', url: 'app://screen', app: front });
    expect(await answer()).toMatchObject({ ok: true });
    expect(device.calls.find((c) => c.name === 'openUrl')?.args).toEqual(['app://screen', front]);
    told.length = 0;
    sends.onWindow({ op: 'control', name: 'openLink', url: 'app://screen', app: 'com.other' });
    expect(await answer()).toMatchObject({ ok: false, text: expect.stringContaining('com.other') });
    expect(device.calls.filter((c) => c.name === 'openUrl')).toHaveLength(1);
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
