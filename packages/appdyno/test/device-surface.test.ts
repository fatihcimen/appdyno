import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { must, type AppManager } from '@appdyno/core';
import { holder } from '@appdyno/ops';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { tree } from '@appdyno/testing/fake-screens.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { openDevice } from '../src/device.js';
import { connect } from '../src/library.js';

/** Its own serial: what holds a device is a file other tests of this run write too. */
const SERIAL = 'emulator-5660';
let device = new FakeDevice(SERIAL);

/** What the drivers were made with, the last time: an iPhone's signing is the fifth. */
let providersGiven: unknown[] = [];

vi.mock('../src/providers.js', () => ({
  deviceProviders: (...given: unknown[]) => [
    {
      list: () => Promise.resolve([]),
      handles: (s: string) => s.startsWith('emulator-'),
      open: () => {
        providersGiven = given;
        return device;
      },
    },
  ],
}));

beforeEach(() => {
  device = new FakeDevice(SERIAL);
});

const opened = () => openDevice(SERIAL, { app: 'dev.app', share: true });

describe('an element of a read', () => {
  it('names its nearest listed ancestor, its app and its place in the reading order', async () => {
    device.screen = 'settings';
    const d = await opened();
    const { elements } = await d.screen();
    const row = must(
      elements.find((e) => e.label === 'Wi-Fi On'),
      'the Wi-Fi row',
    );
    expect(row).toMatchObject({ pkg: 'dev.app' });
    expect(elements.map((e) => e.order)).toEqual(elements.map((_, n) => n));
    // every parent is a place in this list, of an element that comes before it
    for (const [n, e] of elements.entries())
      if (e.parent !== undefined) expect(e.parent).toBeLessThan(n);
    await d.close();
  });

  it('is under the dialog it is in, where a dialog holds it', async () => {
    device.permissionUp = true;
    const d = await opened();
    const { elements } = await d.screen();
    const allow = must(
      elements.find((e) => e.label === 'Uygulamayı kullanırken'),
      'the button',
    );
    expect(allow.pkg).toBe('com.android.permissioncontroller');
    expect(allow.parent === undefined || elements[allow.parent]?.pkg === allow.pkg).toBe(true);
    await d.close();
  });
});

describe('an aim that waits', () => {
  it('finds an element that came after the first read, and refuses at once with no wait', async () => {
    const d = await opened();
    const tree = device.tree.bind(device);
    let reads = 0;
    device.tree = () => {
      reads += 1;
      if (reads === 3) device.screen = 'form';
      return tree();
    };
    await expect(d.aim({ text: 'Bilgiler' }, { waitMs: 0 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const found = await d.aim({ text: 'Bilgiler' });
    expect(found.element.label).toBe('Bilgiler');
    expect(found.on).toBe((await d.screen()).hash);
    await d.close();
  });
});

describe('the policy a program gives', () => {
  it('hides its secrets in what a read shows, whole before the cut', async () => {
    device.screen = 'settings';
    const d = await openDevice(SERIAL, { share: true, policy: { secrets: ['Wi-Fi'] } });
    const { elements } = await d.screen();
    expect(elements.some((e) => e.label === '••• On')).toBe(true);
    expect(JSON.stringify(elements)).not.toContain('Wi-Fi');
    await d.close();
  });

  it('keeps launch and terminate to the apps it lists', async () => {
    const d = await openDevice(SERIAL, { share: true, policy: { apps: ['dev.app'] } });
    await expect(d.launch('other.app')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await expect(d.terminate('other.app')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(device.calls.some((c) => c.name === 'launch' || c.name === 'terminate')).toBe(false);
    await d.terminate('dev.app');
    expect(device.calls.at(-1)).toEqual({ name: 'terminate', args: ['dev.app'] });
    await d.close();
  });

  it('is the same object for connect, where it adds to the options of the same meaning', async () => {
    const tools = connect({
      device: SERIAL,
      share: true,
      secrets: ['Bluetooth'],
      policy: { apps: ['dev.app'], secrets: ['Wi-Fi'] },
    });
    await expect(tools.tool('launch_app', { app: 'other.app' })).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    device.screen = 'settings';
    const { text } = await tools.tool('screen', {});
    expect(text).toContain('•••');
    expect(text).not.toMatch(/Wi-Fi|Bluetooth/);
    await tools.close();
  });

  it('says a policy or a signing that is not what it takes', async () => {
    const bad = (options: object) =>
      expect(openDevice(SERIAL, { share: true, ...options })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
    await bad({ policy: { apps: 'dev.app' } });
    await bad({ policy: { secrets: [1] } });
    await bad({ policy: { urls: '^myapp:' } });
    await bad({ signing: { keychain: 'login.keychain' } });
    expect(() => connect({ policy: { write: '/tmp' as never } })).toThrow(/policy\.write/);
  });
});

describe('the signing a program gives', () => {
  it('goes to the driver of this device alone, by either entry', async () => {
    const signing = { profile: '/p/one.mobileprovision', keychainPassword: 'k' };
    const d = await openDevice(SERIAL, { share: true, signing });
    expect(providersGiven[4]).toEqual(signing);
    await d.close();
    const plain = await openDevice(SERIAL, { share: true });
    expect(providersGiven[4]).toBeUndefined();
    await plain.close();
    const tools = connect({ device: SERIAL, share: true, signing });
    await tools.tool('screen', {});
    expect(providersGiven[4]).toEqual(signing);
    await tools.close();
  });
});

const state = () => must(process.env.APPDYNO_STATE_DIR, 'APPDYNO_STATE_DIR');

describe('a picture of the screen', () => {
  it('is its bytes, or a file inside the folders the program may write in', async () => {
    const d = await opened();
    const shot = await d.screenshot({ format: 'jpeg', quality: 60 });
    expect(shot).toMatchObject({ format: 'jpeg', width: 460, height: 1024 });
    expect([...shot.data]).toEqual([1, 2, 3]);
    const to = join(state(), 'shots', 'one.jpg');
    const saved = await d.screenshot({ path: to });
    expect(saved).toEqual({ format: 'jpeg', width: 460, height: 1024, path: to });
    expect([...readFileSync(to)]).toEqual([1, 2, 3]);
    await d.close();
  });

  it('is refused outside them with nothing asked of the device, and written where policy.write says', async () => {
    const out = join(state(), '..', `appdyno-shots-${process.pid}`);
    const d = await opened();
    await expect(d.screenshot({ path: join(out, 'a.png') })).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    expect(device.calls.some((c) => c.name === 'screenshot')).toBe(false);
    await d.close();
    const allowed = await openDevice(SERIAL, { share: true, policy: { write: [out] } });
    try {
      await allowed.screenshot({ path: join(out, 'a.png') });
      expect(existsSync(join(out, 'a.png'))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
      await allowed.close();
    }
  });
});

describe('the log of an app', () => {
  it('is lines of data, secrets hidden, for the app the device was opened for', async () => {
    device.logLines = ['I/app: signed in', 'E/app: token=abcdef123456 refused for hunter2'];
    device.logNote = 'a note';
    const d = await openDevice(SERIAL, {
      app: 'dev.app',
      share: true,
      policy: { secrets: ['hunter2'] },
    });
    const logs = await d.logs({ since: 1_000, maxLines: 50, level: 'warn' });
    expect(logs).toEqual({
      lines: [{ text: 'I/app: signed in' }, { text: 'E/app: token=••• refused for •••' }],
      source: 'fake log',
      note: 'a note',
    });
    expect(device.logAsked).toEqual({
      app: 'dev.app',
      level: 'warn',
      maxLines: 50,
      timed: true,
      since: 1_000,
    });
    await d.close();
  });

  it("carries each line's time and rank where the platform tells them", async () => {
    const d = await opened();
    device.logs = () =>
      Promise.resolve({
        lines: ['a', 'b'],
        marks: [{ at: 5 }, { at: 9, level: 'error' as const }],
        source: 'logcat',
      });
    expect((await d.logs()).lines).toEqual([
      { text: 'a', at: 5 },
      { text: 'b', at: 9, level: 'error' },
    ]);
    await d.close();
  });

  it('is refused with no app to read, a count out of range, or an app the policy does not list', async () => {
    const none = await openDevice(SERIAL, { share: true, policy: { apps: ['dev.app'] } });
    await expect(none.logs()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(none.logs({ app: 'dev.app', maxLines: 0 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(none.logs({ app: 'other.app' })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await none.close();
  });
});

describe('a link', () => {
  const opens = () => device.calls.filter((c) => c.name === 'openUrl').map((c) => c.args);

  it('is opened, in the app named, and the screen it opens is waited for', async () => {
    const d = await opened();
    await expect(d.openLink(' https://example.com/a ')).resolves.toMatchObject({ settled: true });
    await d.openLink('app://item/1', { app: 'dev.app' });
    expect(opens()).toEqual([
      ['https://example.com/a', undefined],
      ['app://item/1', 'dev.app'],
    ]);
    await d.close();
  });

  it('goes through the policy a tool keeps: a scheme that reaches files, the list of links, a call', async () => {
    const d = await openDevice(SERIAL, {
      share: true,
      policy: { urls: /^https:\/\/example\.com\// },
    });
    const denied = { code: 'POLICY_DENIED' };
    await expect(d.openLink('https://other.example/')).rejects.toMatchObject(denied);
    await d.close();
    const open = await opened();
    await expect(open.openLink('file:///etc/hosts')).rejects.toMatchObject(denied);
    await expect(open.openLink('tel:112')).rejects.toMatchObject(denied);
    await expect(open.openLink('no scheme')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await open.close();
    expect(opens()).toEqual([]);
    const calls = await openDevice(SERIAL, { share: true, policy: { urls: /^tel:/ } });
    await calls.openLink('tel:112');
    expect(opens()).toEqual([['tel:112', undefined]]);
    await calls.close();
  });

  it('opens under a list of apps only where the device says it opens in one of them', async () => {
    const d = await openDevice(SERIAL, { share: true, policy: { apps: ['dev.app'] } });
    // this fake, as an iPhone, cannot tell which app a link opens in
    await expect(d.openLink('app://item/1')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    device.apps = { opener: () => Promise.resolve('dev.app') } as unknown as AppManager;
    await d.openLink('app://item/1');
    device.apps = { opener: () => Promise.resolve('other.app') } as unknown as AppManager;
    await expect(d.openLink('app://item/2')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await expect(d.openLink('app://item/3', { app: 'other.app' })).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    expect(opens()).toEqual([['app://item/1', undefined]]);
    await d.close();
  });
});

describe('the windows of a screen', () => {
  it('are listed as the device has them, with where the keyboard is while it is open', async () => {
    const d = await opened();
    expect(await d.windows()).toEqual({
      windows: [
        {
          type: 'app',
          pkg: 'dev.app',
          rect: { x: 0, y: 0, width: 1080, height: 2400 },
          layer: 1,
          active: true,
          focused: true,
        },
      ],
    });
    const t = tree([]);
    t.windows.push({ type: 2, layer: 3, b: [0, 1500, 1080, 2400], active: false, focused: false });
    device.fixture = t;
    const { windows, keyboard } = await d.windows();
    expect(windows[1]).toMatchObject({ type: 'keyboard', layer: 3 });
    expect(windows[1]).not.toHaveProperty('pkg');
    expect(keyboard).toEqual({ x: 0, y: 1500, width: 1080, height: 900 });
    await d.close();
  });
});

describe('a turn of the device', () => {
  it('is by the name a tool takes, counted from the shape the device has standing', async () => {
    const d = await opened();
    await d.setOrientation('landscape_left');
    // a tablet, wide as it stands: its own portrait is three quarter turns on
    device.hello = { ...device.hello, screen: { w: 2560, h: 1600, density: 320, rotation: 0 } };
    await d.setOrientation('portrait');
    expect(device.calls.filter((c) => c.name === 'setOrientation').map((c) => c.args)).toEqual([
      [1],
      [3],
    ]);
    await expect(d.setOrientation('sideways' as never)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await d.close();
  });
});

describe('an audit', () => {
  it('gives its issues with the elements the checks ran on and the order they are read in', async () => {
    const read = tree([
      { t: 'One', b: [0, 100, 1080, 200] },
      { t: 'Two', b: [0, 200, 1080, 300] },
      { t: 'hunter2', b: [0, 300, 1080, 400] },
    ]);
    device.audit = () =>
      Promise.resolve({
        engine: 'rules',
        issues: [
          {
            type: 'hitRegion',
            rule: 'android.touchTarget',
            message: 'hunter2 is 20 dp tall',
            b: [0, 300, 1080, 400],
            element: { c: 'android.widget.TextView', t: 'hunter2' },
          },
        ],
        truncated: false,
        elapsedMs: 1,
        // the third is read before the first
        read: { tree: read, traversal: [{ n: 3, before: 1 }] },
      });
    const d = await openDevice(SERIAL, { share: true, policy: { secrets: ['hunter2'] } });
    const audit = await d.audit({ types: ['hitRegion'], maxIssues: 5 });
    expect(audit.issues).toEqual([
      {
        type: 'hitRegion',
        rule: 'android.touchTarget',
        message: '••• is 20 dp tall',
        label: '•••',
        rect: { x: 0, y: 300, width: 1080, height: 100 },
      },
    ]);
    expect(audit.elements.map((e) => [e.label, e.order])).toEqual([
      ['One', 1],
      ['Two', 2],
      ['•••', 0],
    ]);
    expect(audit.order).toEqual([2, 0, 1].map((n) => must(audit.elements[n], 'an element').ref));
    // the audit's own read: no second one
    expect(device.calls.some((c) => c.name === 'tree')).toBe(false);
    await d.close();
  });

  it('reads the screen once where the device gives no read of its own, and refuses a kind it has not', async () => {
    const d = await opened();
    const audit = await d.audit();
    expect(audit).toMatchObject({ issues: [], truncated: false });
    expect(audit.order).toEqual(audit.elements.map((e) => e.ref));
    expect(device.calls.filter((c) => c.name === 'tree')).toHaveLength(1);
    await expect(d.audit({ types: ['colour'] })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await d.close();
  });
});

describe('the data of an app', () => {
  it('is cleared on an emulator or a simulator, and on a phone refused', async () => {
    const cleared: string[] = [];
    device.apps = {
      clearData: (app: string) => Promise.resolve(void cleared.push(app)),
    } as unknown as AppManager;
    const d = await openDevice(SERIAL, { share: true, policy: { apps: ['dev.app'] } });
    await d.clearData('dev.app');
    await expect(d.clearData('other.app')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await d.close();
    device.virtual = false;
    const phone = await opened();
    await expect(phone.clearData('dev.app')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await phone.close();
    expect(cleared).toEqual(['dev.app']);
  });
});

describe("the device's agent", () => {
  it('is ended by stopAgent, which lets the device go, and left running by close', async () => {
    const stops = vi.spyOn(device, 'stopAgent');
    const d = await openDevice(SERIAL);
    expect(holder(SERIAL)).toMatchObject({ pid: process.pid });
    await d.stopAgent();
    expect(stops).toHaveBeenCalledTimes(1);
    expect(holder(SERIAL)).toBeUndefined();
    const again = await openDevice(SERIAL);
    await again.close();
    expect(stops).toHaveBeenCalledTimes(1);
  });

  it('is not ended under another live process that uses it, unless forced', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    const pid = must(child.pid, "the child's pid");
    const file = join(state(), 'agent-hosts', `${SERIAL}.json`);
    try {
      const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
      }).trim();
      mkdirSync(join(state(), 'agent-hosts'), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify([{ pid, started, tool: 'host', since: '2026-11-03T00:00:00Z' }]),
      );
      const stops = vi.spyOn(device, 'stopAgent');
      const d = await opened();
      await expect(d.stopAgent()).rejects.toMatchObject({
        code: 'AGENT_CONFLICT',
        message: `pid ${pid} uses the agent on ${SERIAL}`,
      });
      expect(stops).not.toHaveBeenCalled();
      await d.stopAgent({ force: true });
      expect(stops).toHaveBeenCalledTimes(1);
    } finally {
      child.kill('SIGKILL');
      rmSync(file, { force: true });
    }
  });
});

describe('what a touch waits for and answers', () => {
  const acts = () => device.calls.filter((c) => c.name === 'act').map((c) => c.args[1]);

  it('asks the device for the quiet and the longest wait a caller names, and for none of its own otherwise', async () => {
    const d = await opened();
    await d.tap({ x: 5, y: 5 });
    await d.tap({ x: 5, y: 5 }, { quietMs: 120, maxMs: 1_500, before: 'h0' });
    await d.key('back', { before: 'h0', maxMs: 0 });
    expect(acts()).toEqual([
      { settle: {} },
      { settle: { quietMs: 120, maxMs: 1_500 }, before: 'h0' },
      { settle: { maxMs: 0 }, before: 'h0' },
    ]);
    await d.close();
  });

  it('refuses a wait past what the wire carries, with nothing sent', async () => {
    const d = await opened();
    const wrong = { code: 'INVALID_ARGUMENT' };
    await expect(d.tap({ x: 5, y: 5 }, { quietMs: 5_001 })).rejects.toMatchObject(wrong);
    await expect(d.swipe({ x: 1, y: 9 }, { x: 1, y: 2 }, 300, { maxMs: -1 })).rejects.toMatchObject(
      wrong,
    );
    await expect(d.launch('dev.app', { maxMs: 15_001 })).rejects.toMatchObject(wrong);
    await expect(d.typeText('a', { quietMs: 1.5 })).rejects.toMatchObject(wrong);
    expect(device.calls.filter((c) => c.name !== 'tree')).toEqual([]);
    await d.close();
  });

  it('gives the screen the touch left from the read its settle made, and no read for one not asked', async () => {
    const d = await opened();
    const plain = await d.tap({ x: 540, y: 350 });
    expect(plain).toEqual({ settled: true, ms: 120 });
    expect(device.calls.some((c) => c.name === 'tree')).toBe(false);
    device.screen = 'home';
    const { tree: left, ...rest } = await d.tap({ x: 540, y: 350 }, { tree: true });
    expect(rest).toEqual({ settled: true, ms: 120 });
    expect(acts().at(-1)).toEqual({ settle: {}, read: 'tree' });
    expect(device.calls.some((c) => c.name === 'tree')).toBe(false);
    expect(left).toEqual(await d.screen());
    await d.close();
  });

  it('reads once where the device answered with no tree', async () => {
    const d = await opened();
    const act = device.act.bind(device);
    device.act = async (action, o) => {
      const { tree: _none, ...r } = await act(action, o);
      return r;
    };
    const { tree: left } = await d.key('back', { tree: true });
    expect(device.calls.filter((c) => c.name === 'tree')).toHaveLength(1);
    expect(left?.elements.length).toBeGreaterThan(0);
    await d.close();
  });

  it("gives a typed text's screen and time with what the field read back", async () => {
    const d = await opened();
    const typed = await d.typeText('abc', { at: { x: 1, y: 2 }, submit: true, tree: true });
    expect(typed).toMatchObject({ settled: true, ms: 120, verified: true });
    expect(typed.tree?.hash).toBe((await d.screen()).hash);
    expect(device.calls.find((c) => c.name === 'typeText')?.args[0]).toEqual({
      settle: {},
      read: 'tree',
      at: { x: 1, y: 2 },
      submit: true,
    });
    await d.close();
  });

  it(
    'does not take the screen a launch began on for the one it opens, and says how long the rest took',
    fakeTimed(async () => {
      const d = await opened();
      const began = (await d.screen()).hash;
      // the app's first screen never comes: the one the launch began on holds
      const stuck = await d.launch('dev.app', { before: began, maxMs: 600 });
      expect(stuck.settled).toBe(false);
      expect(stuck.ms).toBeGreaterThanOrEqual(600);
      const opened_ = await d.launch('dev.app', { quietMs: 80, tree: true });
      expect(opened_).toMatchObject({ settled: true, tree: { hash: began } });
      expect(opened_.ms).toBeGreaterThanOrEqual(80);
      expect(opened_.ms).toBeLessThan(600);
      await d.close();
    }),
  );

  it(
    "waits for a link's screen by the same options",
    fakeTimed(async () => {
      const d = await opened();
      const r = await d.openLink('app://item/1', { quietMs: 40, maxMs: 500, tree: true });
      expect(r).toMatchObject({ settled: true, tree: { hash: (await d.screen()).hash } });
      await d.close();
    }),
  );
});

describe('a touch aimed on a read that is no longer in front, on an iPhone', () => {
  /** The fake as an iPhone, showing `pkg` in front, with an alert of the app's up or not. */
  const shows = (pkg: string, alert = false) => {
    Object.defineProperty(device, 'platform', { value: 'ios' });
    const t = tree(
      [
        { t: 'Buy', c: 'Button', b: [0, 100, 300, 200], f: 3 },
        ...(alert
          ? [{ c: 'Alert', b: [40, 300, 350, 500] as [number, number, number, number] }]
          : []),
      ],
      pkg,
      `${pkg}${alert ? '+alert' : ''}`,
    );
    device.fixture = t;
  };
  const sent = () => device.calls.filter((c) => c.name !== 'tree').map((c) => c.name);
  const stale = { code: 'STALE', hint: 'read the screen again, and aim on that read' };

  it('is refused with nothing sent once another app is in front, and goes while the same one is', async () => {
    shows('dev.shop');
    const d = await openDevice(SERIAL, { share: true });
    const { point, on } = await d.aim({ text: 'Buy' });
    await d.tap(point, { before: on });
    expect(sent()).toEqual(['act']);
    shows('com.apple.mobilesafari');
    await expect(d.tap(point, { before: on })).rejects.toMatchObject(stale);
    await expect(d.longPress(point, 600, { before: on })).rejects.toMatchObject(stale);
    await expect(d.swipe(point, { x: 5, y: 5 }, 300, { before: on })).rejects.toMatchObject(stale);
    await expect(d.typeText('a', { at: point, before: on })).rejects.toMatchObject(stale);
    expect(sent()).toEqual(['act']);
    await d.close();
  });

  it('is refused once an alert came up over the app, and after it went for one aimed on the alert', async () => {
    shows('dev.shop');
    const d = await openDevice(SERIAL, { share: true });
    const under = await d.aim({ text: 'Buy' });
    shows('dev.shop', true);
    await expect(d.tap(under.point, { before: under.on })).rejects.toMatchObject(stale);
    const over = await d.aim({ text: 'Buy' });
    await d.tap(over.point, { before: over.on });
    shows('dev.shop');
    await expect(d.tap(over.point, { before: over.on })).rejects.toMatchObject(stale);
    expect(sent()).toEqual(['act']);
    await d.close();
  });

  it('is not compared for a key, a text into the focused field, a read it did not give or one past the last 8', async () => {
    shows('dev.shop');
    const d = await openDevice(SERIAL, { share: true });
    const { point, on } = await d.aim({ text: 'Buy' });
    shows('com.apple.mobilesafari');
    await d.key('home', { before: on });
    await d.typeText('a', { before: on });
    await d.tap(point, { before: 'a hash of another object' });
    for (let n = 0; n < 8; n++) {
      shows(`dev.other${n}`);
      await d.screen();
    }
    const reads = device.calls.filter((c) => c.name === 'tree').length;
    await d.tap(point, { before: on });
    expect(device.calls.filter((c) => c.name === 'tree')).toHaveLength(reads);
    expect(sent()).toEqual(['act', 'typeText', 'act', 'act', 'act']);
    await d.close();
  });

  it('costs one read before the touch there, and none on Android, whose agent compares as it sends', async () => {
    const d = await opened();
    const { point, on } = await d.aim({ text: 'Form' });
    const reads = () => device.calls.filter((c) => c.name === 'tree').length;
    const before = reads();
    await d.tap(point, { before: on });
    expect(reads()).toBe(before);
    await d.close();
    device = new FakeDevice(SERIAL);
    shows('dev.shop');
    const phone = await openDevice(SERIAL, { share: true });
    const aimed = await phone.aim({ text: 'Buy' });
    const then = reads();
    await phone.tap(aimed.point, { before: aimed.on });
    expect(reads()).toBe(then + 1);
    await phone.close();
  });
});
