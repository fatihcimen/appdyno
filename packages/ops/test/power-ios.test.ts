import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iosScreen } from '@appdyno/driver-apple';
import { DeviceError, type Tree } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { powerControlAt, type Policy } from '../src/index.js';
import { middle, onDevice, recorded } from './power-device.js';

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-power-state-')));
});

describe("iOS's own views over an app, where a read of the app has none of them", () => {
  /** The fixture app under Control Center, as a runner read it; the home screen app's read, with `over` up. */
  const under = async (over: string) => {
    const o = await onDevice('ios-control-center-app', { answer: 'decline' });
    const tree = recorded(over);
    Object.assign(o.device, { systemTree: () => Promise.resolve(tree) });
    return { ...o, over: tree };
  };

  it("asks before a touch on Control Center's power button, a window of the home screen app's in an iPhone's read", async () => {
    const { call, sent, asked, tree } = await onDevice('ios-control-center-tr', {
      answer: 'decline',
    });
    const r = await call('tap', middle(tree, 'Güç'));
    expect(r.code).toBe('PERMISSION_REQUIRED');
    expect(asked[0]).toContain('a touch on "Güç"');
    expect(sent()).toEqual([]);
  });

  it("asks before a touch on Control Center's power button or the power-off slider, read from the home screen app", async () => {
    for (const [over, label] of [
      ['ios-control-center-springboard', 'Power'],
      ['ios-power-off-springboard', 'slide to power off'],
    ] as const) {
      const { call, sent, asked, over: t } = await under(over);
      const r = await call('tap', middle(t, label));
      expect(r.code, over).toBe('PERMISSION_REQUIRED');
      expect(asked[0], over).toContain(`a touch on "${label}"`);
      expect(sent(), over).toEqual([]);
    }
  });

  it('knows the power-off slider by its id in a language of no words here, and not its Cancel', () => {
    const de: Record<string, string> = {
      'slide to power off': 'Zum Ausschalten streichen',
      'Power off': 'Ausschalten',
      Power: 'Ein/Aus',
      Cancel: 'Abbrechen',
    };
    const t = recorded('ios-power-off-springboard');
    const said = {
      ...t,
      nodes: t.nodes.map((n) => ({ ...n, ...(n.d && de[n.d] && { d: de[n.d] }) })),
    };
    expect(powerControlAt(said, middle(said, 'Zum Ausschalten streichen'))).toBe(
      'the control actionSlider',
    );
    expect(powerControlAt(said, middle(said, 'Ein/Aus'))).toBe('the control actionSlider');
    expect(powerControlAt(said, middle(said, 'Abbrechen'))).toBeUndefined();
  });

  it('lets a touch elsewhere on them go with nothing asked', async () => {
    const { call, sent, asked, over } = await under('ios-control-center-springboard');
    expect((await call('tap', middle(over, 'Add Controls'))).error).toBe(false);
    expect(asked).toEqual([]);
    expect(sent()).toHaveLength(1);
  });
});

describe("the home screen app's read, where a read of an iPhone's app has no window of the system's", () => {
  /** A point in the fixture app, on none of its controls. */
  const inApp = { x: 200, y: 600 };

  /** The fixture on an iPhone, whose home screen app's read is `home` each time it is asked. */
  const phone = async (
    home: () => Promise<Tree | undefined>,
    o: { virtual?: boolean; policy?: Partial<Policy> } = {},
  ) => {
    const d = await onDevice('ios-control-center-app', { virtual: false, answer: 'decline', ...o });
    const systemTree = vi.fn(home);
    Object.assign(d.device, { systemTree });
    return { ...d, systemTree };
  };

  it('is taken once for a read of the screen, however many inputs that read aims, and again for the next read', async () => {
    const { call, sent, systemTree } = await phone(() => Promise.resolve(undefined));
    await call('screen', {});
    expect((await call('press_key', { key: 'a', count: 5 })).error).toBe(false);
    expect(sent()).toHaveLength(5);
    expect(systemTree).toHaveBeenCalledTimes(1);
    // a read of the same layout is another look: Control Center coming over the app leaves the app's as it was
    await call('screen', {});
    expect((await call('tap', inApp)).error).toBe(false);
    expect(systemTree).toHaveBeenCalledTimes(2);
  });

  it('sends nothing where it cannot be taken, saying why and what to do', async () => {
    const late = new DeviceError('TIMEOUT', 'the runner gave no answer to tree.get in 10000 ms');
    const { call, sent } = await phone(() => Promise.reject(late));
    for (const [name, args] of [
      ['tap', inApp],
      ['press_key', { key: 'a' }],
    ] as const) {
      const r = await call(name, args);
      expect(r.code, name).toBe('TIMEOUT');
      expect(r.text, name).toContain(
        'the home screen app could not be read, to tell whether Control Center or the power-off screen is over the app: the runner gave no answer to tree.get in 10000 ms (no touch was sent)',
      );
      expect(r.hint, name).toMatch(/^read the screen and try again: appdyno sends no input where/);
    }
    expect(sent()).toEqual([]);
  });

  it('is not taken where the person allowed the power controls ahead, as it could only cost time', async () => {
    const { call, sent, systemTree } = await phone(() => Promise.reject(new Error('no')), {
      virtual: true,
      policy: { allowPower: 'virtual' },
    });
    expect((await call('tap', inApp)).error).toBe(false);
    expect(sent()).toHaveLength(1);
    expect(systemTree).not.toHaveBeenCalled();
  });
});

describe('a system alert over the app, which the runner reads alone, and what the home screen app shows with it', () => {
  const APP = 'dev.appdyno.fixture';
  const box: [number, number, number, number] = [60, 300, 330, 520];
  const allow = { x: 260, y: 490 };
  /**
   * The fixture's read with a permission alert over it, a window of the home screen app's as the runner captures it;
   * its right button `right`, and `left` beside it.
   */
  const alerted = (right = 'Allow', left?: string): Tree => {
    const t = recorded('ios-control-center-app');
    const at = t.nodes.length;
    const button = (d: string, x: number) => ({
      p: at,
      w: 1,
      c: 'Button',
      d,
      b: [x, 470, x + 120, 510] as typeof box,
      f: 19,
    });
    return {
      ...t,
      windows: [
        ...t.windows,
        { type: 3, pkg: 'com.apple.springboard', layer: 1, b: box, active: false, focused: false },
      ],
      nodes: [
        ...t.nodes,
        {
          p: -1,
          w: 1,
          c: 'Alert',
          d: 'Allow “appdyno fixture” to use your location?',
          b: box,
          f: 17,
        },
        button(right, 200),
        ...(left ? [button(left, 70)] : []),
      ],
    };
  };
  /** That read, the home screen app's being `home`; `apps` as --allow-apps; `read`, the read with its alert. */
  const over = async (home: Tree, apps: string[] = [], read = alerted()) => {
    const o = await onDevice(read, { answer: 'decline', policy: { apps } });
    Object.assign(o.device, { systemTree: () => Promise.resolve(home), platformScreen: iosScreen });
    return o;
  };

  it("asks before a touch on Control Center's power button, which the alert hid from the read", async () => {
    const cc = recorded('ios-control-center-springboard');
    const { call, sent, asked } = await over(cc);
    expect((await call('tap', middle(cc, 'Power'))).code).toBe('PERMISSION_REQUIRED');
    expect(asked[0]).toContain('a touch on "Power"');
    expect(sent()).toEqual([]);
  });

  it('refuses under --allow-apps a touch on a control of what the home screen app shows over the app, as no read had it', async () => {
    const cc = recorded('ios-control-center-springboard');
    const { call, sent } = await over(cc, [APP]);
    const r = await call('tap', middle(cc, 'Add Controls'));
    expect(r.code).toBe('POLICY_DENIED');
    expect(r.text).toContain(
      `a touch lands in com.apple.springboard over ${APP}, not an allowed app`,
    );
    expect(sent()).toEqual([]);
  });

  it("lets the alert's own button and the app go, with nothing over the app but the alert, as an iPhone read it", async () => {
    const home = recorded('ios-nothing-over-springboard');
    const withAlert: Tree = {
      ...home,
      nodes: [
        ...home.nodes,
        ...alerted()
          .nodes.slice(-2)
          .map((n, i) => ({ ...n, w: 0, p: i ? home.nodes.length : 0 })),
      ],
    };
    const { call, sent, asked } = await over(withAlert, [APP]);
    expect((await call('tap', allow)).error).toBe(false);
    expect((await call('tap', { x: 200, y: 700 })).error).toBe(false);
    expect([sent().length, asked]).toEqual([2, []]);
  });

  it('asks before a touch on the Call of the alert iOS shows for a call link the app opened, and not on its Cancel', async () => {
    const home = recorded('ios-nothing-over-springboard');
    for (const [yes, no] of [
      ['Call', 'Cancel'],
      ['Ara', 'Vazgeç'],
    ] as const) {
      const { call, sent, asked } = await over(home, [], alerted(yes, no));
      expect((await call('tap', allow)).code, yes).toBe('PERMISSION_REQUIRED');
      expect(asked[0], yes).toContain(`a touch on "${yes}" of a system alert, which places a call`);
      expect((await call('tap', { x: 130, y: 490 })).error, no).toBe(false);
      expect(sent(), yes).toHaveLength(1);
    }
  });
});
