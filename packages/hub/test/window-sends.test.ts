import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { must, type AppManager, type DeviceEvents } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { windowSends } from '../src/window-sends.js';
import { followDevice } from '../src/follow.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';

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
      return must(
        told.find((m) => 'ok' in m),
        'an answer',
      );
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
    expect(device.calls.find((c) => c.name === 'openUrl')?.args[0]).toBe('app://screen/form');
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

  it("opens a call's link a person chose, as theirs, where an agent's asks them first", async () => {
    const device = new FakeDevice();
    const { open } = sendsOn(device);
    expect(await open('tel:5551234')).toMatchObject({ ok: true, text: 'Opened tel:5551234' });
    expect(device.calls.find((c) => c.name === 'openUrl')?.args[0]).toBe('tel:5551234');
  });

  it("says a refusal as the op does, with what to do in a person's words, and opens nothing", async () => {
    const device = new FakeDevice();
    const { open } = sendsOn(device, { ...DEFAULT_POLICY, urls: /^https:\/\/example\.test\// });
    expect(await open('https://elsewhere.test/')).toMatchObject({
      ok: false,
      text: "this link is not on this server's allow list",
      hint: 'The hub was started with a list of allowed links that leaves this one out.',
      recent: [],
    });
    expect(await open('ab')).toMatchObject({
      ok: false,
      text: expect.stringContaining('url') as unknown,
      hint: 'Nothing was done. Change it and try again.',
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
    const listedFor: (string | undefined)[] = [];
    device.events = {
      pushRoutes: (app?: string) => {
        listedFor.push(app);
        return Promise.resolve(routes);
      },
      push: (app: string, push: unknown) => {
        pushed.push([app, push]);
        return Promise.resolve(`pushed to ${app}`);
      },
    } as unknown as DeviceEvents;
    const front = await device.foreground();
    device.apps = { listApps: () => Promise.resolve([{ id: front }]) } as unknown as AppManager;
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
    // another app named in the pane: its build may take other routes, and the pane still starts from the one in front
    sends.onWindow({ op: 'control', name: 'pushes', app: 'dev.other' });
    await expect
      .poll(() => told.find((m) => 'types' in m))
      .toMatchObject({ types: routes, app: front });
    expect(listedFor).toEqual([front, 'dev.other']);
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
    // what the op tells an agent to do, where the pane has no words for it, is not shown
    told.length = 0;
    sends.onWindow({ op: 'control', name: 'push', args: { app: 'dev.app', type: 'tapped' } });
    expect(await answer()).toEqual({ op: 'answer', name: 'push', ok: false, text: 'no hand' });
    told.length = 0;
    sends.onWindow({ op: 'control', name: 'push', args: { type: 'alert', title: 'Order 42' } });
    expect(await answer()).toMatchObject({
      ok: false,
      hint: "Give the app's id, as the Apps pane lists it.",
    });
    expect(pushed).toHaveLength(1);
  });

  it("says why an iPhone takes no push in a person's words, and the driver's where it has none", async () => {
    const device = new FakeDevice();
    const routes = [
      {
        type: 'alert',
        why: "a real iPhone takes a push only from Apple's servers, once a person sets APNs up with `appdyno push setup apns`: else open the app's deep link, or push to a simulator",
      },
      { type: 'tapped', why: 'nothing taps a push on an iPhone but a person: push an alert' },
      { type: 'voip', why: 'no words of ours' },
    ];
    device.events = {
      pushRoutes: () => Promise.resolve(routes),
    } as unknown as DeviceEvents;
    const { sends, told } = sendsOn(device);
    sends.onWindow({ op: 'control', name: 'pushes' });
    await expect
      .poll(
        () => (told.find((m) => 'types' in m) as { types?: { why: string }[] } | undefined)?.types,
      )
      .toEqual([
        {
          type: 'alert',
          why: "An iPhone takes a push only from Apple's servers, once APNs is set up with appdyno push setup apns in Terminal. Until then, open the app's link in Links, or send the push to a simulator.",
        },
        {
          type: 'tapped',
          why: 'Only a person taps a push on an iPhone: send an alert, then tap it on the phone.',
        },
        { type: 'voip', why: 'no words of ours' },
      ]);
  });

  it('says where the links of an app would stand why a device cannot tell them', async () => {
    const device = new FakeDevice();
    const front = await device.foreground();
    device.apps = {
      listApps: () => Promise.resolve([{ id: front }]),
      links: () => Promise.reject(new Error("an iPhone's installed app is not read from here")),
    } as unknown as AppManager;
    const { sends, told } = sendsOn(device, DEFAULT_POLICY);
    sends.onWindow({ op: 'control', name: 'links' });
    await expect
      .poll(() => told.find((m) => 'recent' in m))
      .toMatchObject({
        suggested: [],
        linksWhy: "an iPhone's installed app is not read from here",
      });
  });

  it('opens a link in the app the pane names, the app in front first, through the policy', async () => {
    const device = new FakeDevice();
    const front = await device.foreground();
    const opens = [{ url: 'app://', kind: 'scheme' }];
    device.apps = {
      listApps: () => Promise.resolve([{ id: front }]),
      links: () => Promise.resolve(opens),
      opener: (_url: string, app?: string) => Promise.resolve(app),
    } as unknown as AppManager;
    const { sends, told, answer } = sendsOn(device, {
      ...DEFAULT_POLICY,
      apps: [must(front, 'the app in front')],
    });
    sends.onWindow({ op: 'control', name: 'links' });
    // and what that app opens, as open_link lists it
    await expect
      .poll(() => told.find((m) => 'recent' in m))
      .toMatchObject({ app: front, suggested: opens });
    told.length = 0;
    sends.onWindow({ op: 'control', name: 'openLink', url: 'app://screen', app: front });
    expect(await answer()).toMatchObject({ ok: true });
    expect(device.calls.find((c) => c.name === 'openUrl')?.args).toEqual(['app://screen', front]);
    told.length = 0;
    sends.onWindow({ op: 'control', name: 'openLink', url: 'app://screen', app: 'com.other' });
    expect(await answer()).toMatchObject({
      ok: false,
      text: expect.stringContaining('com.other') as unknown,
    });
    expect(device.calls.filter((c) => c.name === 'openUrl')).toHaveLength(1);
  });

  it("keeps a person's push token for the app in the pane, by no op, and says it back nowhere", async () => {
    const token = 'c0ffee'.repeat(11);
    const device = new FakeDevice();
    const kept: unknown[][] = [];
    device.events = {
      pushToken: (...args: unknown[]) => {
        if (args[1] === 'short') throw new DeviceError('INVALID_ARGUMENT', 'a token is hex');
        kept.push(args);
      },
    } as unknown as DeviceEvents;
    const seen: Record<string, unknown>[] = [];
    const off = followDevice(device.serial, { tell: (m) => seen.push(m) });
    const logged = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level),
    );
    const { sends, told, answer } = sendsOn(device, { ...DEFAULT_POLICY, apps: ['dev.app'] });
    const keep = (m: Record<string, unknown>) => {
      told.length = 0;
      expect(sends.onWindow({ op: 'control', name: 'pushToken', ...m })).toBe(true);
      return answer();
    };
    try {
      expect(await keep({ app: ' dev.app ', token: ` ${token} `, kind: 'start' })).toEqual({
        op: 'answer',
        name: 'push',
        ok: true,
        text: "Kept dev.app's start token for this session only",
      });
      expect(kept).toEqual([['dev.app', token, 'start']]);
      // each refused, with nothing kept and the token in no answer
      const refusals = [
        await keep({ app: 'com.other', token, kind: 'device' }),
        await keep({ app: '', token, kind: 'device' }),
        await keep({ app: 'dev.app', token, kind: 'session' }),
        await keep({ app: 'dev.app', token: 'short', kind: 'device' }),
      ];
      expect(refusals.map((r) => [r.ok, r.text])).toEqual([
        [false, expect.stringContaining('com.other is not an allowed app')],
        [false, 'give the app the token is for'],
        [false, 'kind: device, activity, start, voip, widget'],
        [false, 'a token is hex'],
      ]);
      expect(kept).toHaveLength(1);
      device.events = {} as DeviceEvents;
      expect(await keep({ app: 'dev.app', token, kind: 'device' })).toMatchObject({
        ok: false,
        text: 'this device takes no token a person types',
      });
      await new Promise((r) => setTimeout(r, 600));
      expect(seen.filter((m) => m.op === 'agent' || m.op === 'activity')).toEqual([]);
      const files = readdirSync(state, { recursive: true, withFileTypes: true }).filter((f) =>
        f.isFile(),
      );
      const written = files.map((f) => readFileSync(join(f.parentPath, f.name), 'utf8'));
      const logs = logged.flatMap((spy) => spy.mock.calls.flat().map(String));
      for (const said of [JSON.stringify(told), JSON.stringify(seen), ...written, ...logs])
        expect(said).not.toContain(token);
      expect(device.calls).toEqual([]);
    } finally {
      off();
      logged.forEach((spy) => spy.mockRestore());
    }
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
