import { assert, beforeAll, describe, expect, it } from 'vitest';
import { IosSimulatorDevice, Simctl, buildScreen, type Screen } from './workspace.js';
import { PROTOCOL, type Tree } from '@appdyno/protocol';
import { IosDevice } from '../packages/driver-apple/src/device.js';
import { IosRunnerLauncher } from '../packages/driver-apple/src/index.js';
import { directChecks } from '../packages/driver-apple/src/provider.js';
import { DirectSim } from '../packages/driver-apple/src/simdirect.js';
import { learnCopies, sameTree, withoutCopies } from '../packages/driver-apple/src/simtree.js';
import { startSimAx, type HelperProcess } from '../packages/driver-apple/src/simhelper.js';
import { SIM_FIXTURE } from './helpers.js';

/**
 * The iOS runner against the fixture app on our own simulator (APPDYNO_IOS_UDID; never a default: other
 * simulators run on this Mac). Booting and shutting down are the caller's.
 */
const udid = process.env.APPDYNO_IOS_UDID ?? '';
const APP = 'dev.appdyno.fixture';
const SETTLE = { quietMs: 200, maxMs: 3_000 };

describe.skipIf(!udid)('ios runner on a simulator', () => {
  let d: IosSimulatorDevice;
  const simctl = new Simctl();
  const labels = (s: Screen) => s.list.map((e) => e.label);
  const find = (s: Screen, label: string) => s.list.find((e) => e.label === label);
  const byId = (s: Screen, id: string) => s.list.find((e) => e.id === id);
  /** The element the test needs there, by its label or its id. */
  const found = (s: Screen, label: string) => {
    const e = find(s, label);
    assert(e, label);
    return e;
  };
  const foundId = (s: Screen, id: string) => {
    const e = byId(s, id);
    assert(e, id);
    return e;
  };
  const helloOf = (x: IosSimulatorDevice) => {
    assert(x.hello, 'its hello');
    return x.hello;
  };
  const home = async () => {
    await d.terminate(APP);
    await d.launch(APP);
    return d.read(APP);
  };
  const open = async (title: string) => {
    const s = await home();
    const b = find(s, title);
    assert(b, title);
    const r = await d.tap(b, { settle: SETTLE, read: 'none', before: s.hash });
    return { ...(await d.read(APP)), settle: r.settle };
  };

  beforeAll(async () => {
    await simctl.install(udid, SIM_FIXTURE);
    d = new IosSimulatorDevice(udid);
    // the runner does not stay on a shared simulator after the run, nor after an open that failed
    return () => d.stopAgent();
  }, 240_000);
  beforeAll(() => d.open(), 240_000);

  it('launches, reads and taps with no runner, from the first touch on', async () => {
    expect(d.hello?.agentVersion).toBe('helper');
    const s = await home();
    // not Form: its control found twice at different places is the runner's to tell apart
    const r = await d.tap(found(s, 'Dialog'), { settle: SETTLE, read: 'tree', before: s.hash });
    expect(r.tree?.nodes.some((n) => n.id === 'open_dialog')).toBe(true);
    expect(d.lastStartWasCold).toBe(false);
    expect(d.hello?.agentVersion).toBe('helper');
  });

  it('looks for a sheet over the app in front with no runner, and brings none up', async () => {
    await home();
    expect(await d.systemWords()).toEqual([]);
    expect(d.agentUp).toBe(false);
  });

  it('says hello as iOS in points, from the helper and then from the runner', async () => {
    expect(d.hello).toMatchObject({ platform: 'ios', protocol: PROTOCOL });
    const size = helloOf(d).screen;
    expect(size.density).toBeGreaterThanOrEqual(2);
    // only a runner waits on the device: the helper is read
    expect(await d.waitChange(undefined, 0)).toBeUndefined();
    await IosDevice.prototype.tree.call(d, { maxNodes: 5000 });
    expect(helloOf(d).agentVersion).not.toBe('helper');
    expect(d.hello?.screen).toEqual(size);
    expect((await d.waitChange(undefined, 0))?.sig).toBeTruthy();
    // the idle shim's replacements were each called at start with a BOOL in every slot (a crash otherwise)
    expect(d.hello?.idleShimChecked).toBe(true);
  });

  it('says a Face ID sheet as a read does, which brings the runner an app not in front needs', async () => {
    await d.events.biometric('enroll');
    await home();
    await d.openUrl('appdyno-fixture://open/biometric', APP);
    await d.stopAgent();
    await d.tap(foundId(await d.read(APP), 'authenticate'), { settle: false, read: 'none' });
    let said = false;
    for (let end = Date.now() + 10_000; !said && Date.now() < end;) {
      // as `screen` does: the read, then the look
      await d.read(APP);
      said = (await d.systemWords()).some((w) => /face id/i.test(w));
    }
    expect(said).toBe(true);
    await d.events.biometric('nomatch');
  });

  it('reads the fixture home with the app in front', async () => {
    const s = await home();
    expect(await d.foreground()).toBe(APP);
    expect(labels(s)).toContain('appdyno fixture');
    expect(find(s, 'Form')?.flags).toContain('clickable');
  });

  it('taps into a screen, types Turkish text and reads the result', async () => {
    const s = await open('Form');
    const name = foundId(s, 'name_input');
    const r = await d.typeText('Kapı zili çalışmıyor', { at: name, replace: true });
    expect(r.verified).toBe(true);
    const send = foundId(await d.read(APP), 'submit');
    await d.tap(send, { settle: SETTLE });
    expect(byId(await d.read(APP), 'result')?.label).toBe('Sent: Kapı zili çalışmıyor');
  });

  it('reports the field the keyboard types into as focused', async () => {
    const s = await open('Form');
    const name = foundId(s, 'name_input');
    expect(name.flags).not.toContain('focused');
    await d.tap(name, { settle: SETTLE });
    const after = await d.read(APP);
    const focused = after.list.filter((e) => e.flags.includes('focused'));
    expect(focused.map((e) => e.id)).toEqual(['name_input']);
  });

  it('replaces the text of a field that formats what is typed (a phone number)', async () => {
    const s = await open('Form');
    const gsm = foundId(s, 'gsm_input');
    for (const n of ['5999999900', '5321234567']) {
      const r = await d.typeText(n, { at: gsm, replace: true });
      expect(r.verified).toBe(true);
      const field = (await d.tree()).nodes.find((x) => x.id === 'gsm_input');
      expect(field?.t?.replace(/\D/g, '')).toBe(n);
    }
  });

  it('gives no verdict on a secure field (it cannot be read back)', async () => {
    const s = await open('Form');
    const r = await d.typeText('Gizli123!', { at: foundId(s, 'password_input'), replace: true });
    expect(r.verified).toBeUndefined();
  });

  it('of the same control twice, the copy under another control is not shown', async () => {
    await open('Form');
    const nodes = (await d.tree()).nodes.filter((n) => n.id === 'dup_close');
    expect(nodes).toHaveLength(2);
    const shown = nodes.filter((n) => n.f & 1);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.b[0]).toBeGreaterThan(Math.min(...nodes.map((n) => n.b[0])));
  });

  // asked of the runner itself: a simulator's own touches go past it, and a phone's are all it has
  it('watches for a system alert after a button that changes nothing, with a copy on the screen or not', async () => {
    await home();
    await d.tree();
    const { rpc } = await new IosRunnerLauncher(udid).connect(APP);
    type Read = {
      nodes: { id?: string; b: [number, number, number, number]; f: number }[];
      hash?: string;
    };
    const read = async () => (await rpc.call('tree.get', {}, { timeoutMs: 20_000 })).result as Read;
    try {
      for (const [screen, id] of [
        ['a11y', 'a11y_ok'],
        ['form', 'dup_close'],
      ] as const) {
        await d.openUrl(`appdyno-fixture://open/${screen}`, APP);
        await new Promise((r) => setTimeout(r, 2_000));
        const before = await read();
        const node = before.nodes.find((n) => n.id === id && n.f & 1);
        assert(node, id);
        const [x0, y0, x1, y1] = node.b;
        const { result } = await rpc.call(
          'act',
          {
            action: { kind: 'tap', x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
            settle: SETTLE,
            read: 'hash',
            ...(before.hash && { before: before.hash }),
          } as never,
          { timeoutMs: 20_000 },
        );
        const { settle } = result as { settle?: { idleMs?: number } };
        console.log(`${id}: ${JSON.stringify(settle)}`);
        expect(settle?.idleMs, id).toBeGreaterThan(0);
      }
    } finally {
      rpc.close();
    }
  });

  it("leaves a scroll view's bars out of the screen, and the app's name too", async () => {
    await home();
    await d.openUrl('appdyno-fixture://open/list', APP);
    const t = await d.tree();
    const shown = t.nodes.filter((n) => n.f & 1);
    // the list's scroll bars are elements to XCUI: they stay in the tree, never shown
    expect(t.nodes.some((n) => /scroll bar/i.test(n.d ?? ''))).toBe(true);
    expect(shown.filter((n) => /scroll bar/i.test(n.d ?? ''))).toEqual([]);
    // the app element is the screen itself: no label of its own
    expect(t.nodes.find((n) => n.c === 'Application')?.d).toBeUndefined();
  });

  it('answers an alert', async () => {
    const s = await open('Dialog');
    await d.tap(foundId(s, 'open_dialog'), { settle: SETTLE });
    const alert = await d.read(APP);
    const ok = found(alert, 'OK');
    await d.tap(ok, { settle: SETTLE });
    expect(labels(await d.read(APP))).toContain('Confirmed');
  });

  it('catches a reaction 300 ms after the tap, with and without the screen before it (10 of 10)', async () => {
    await home();
    await d.openUrl('appdyno-fixture://open/late', APP);
    for (const withBefore of [true, false]) {
      let caught = 0;
      for (let i = 0; i < 10; i++) {
        let s = await d.read(APP);
        await d.tap(foundId(s, 'late_clear'), { settle: SETTLE });
        s = await d.read(APP);
        const r = await d.tap(foundId(s, 'late_300'), {
          settle: SETTLE,
          read: 'tree',
          ...(withBefore && { before: s.hash }),
        });
        assert(r.tree);
        if (labels(buildScreen(r.tree, { port: d.platformScreen })).includes('Tepki 300')) caught++;
        // a missed reaction lands before the next trial
        await new Promise((x) => setTimeout(x, 400));
      }
      expect(caught, withBefore ? 'with the screen before' : 'without it').toBe(10);
    }
  }, 180_000);

  // UIKit takes no touches while a view animates in, and the tree shows it where it ends from the
  // start: a tap sent then is lost unless the runner waits for the animation (an A/B run lost one so)
  it('taps a button that is still sliding in, once (5 of 5)', async () => {
    await home();
    await d.openUrl('appdyno-fixture://open/slide', APP);
    await new Promise((r) => setTimeout(r, 1_000));
    const show = foundId(await d.read(APP), 'slide_show');
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      // no settle: the next tap goes out while the button still moves
      const r = await d.tap(show, { settle: false, read: 'tree' });
      assert(r.tree);
      const confirm = foundId(buildScreen(r.tree, { port: d.platformScreen }), 'slide_confirm');
      waits.push((await d.tap(confirm, { settle: SETTLE })).animationWaitMs ?? 0);
    }
    expect(byId(await d.read(APP), 'slide_count')?.label).toBe('Onay: 5');
    // each tap waited for the animation: not a lucky late tap
    expect(
      waits.every((w) => w > 0),
      `waits ${String(waits)}`,
    ).toBe(true);
  }, 120_000);

  it('settles on a screen whose text keeps ticking', async () => {
    const s = await open('Ticker');
    expect(s.settle?.settled).toBe(true);
  });

  it('waits for a spinner to go', async () => {
    const s = await open('Delayed');
    expect(s.settle?.settled).toBe(true);
    expect(labels(s)).toContain('Loaded');
  });

  it('opens a deep link into the app', async () => {
    await d.openUrl('appdyno-fixture://open/late', APP);
    await new Promise((r) => setTimeout(r, 1_000));
    expect(labels(await d.read(APP))).toContain('Clear');
  });

  // a code entry that takes keys without being a text field: no element reports the focus (XCUI's own
  // typing refuses then), and it submits itself when full
  it('types into a code entry no element of which reports the focus', async () => {
    await d.terminate(APP);
    await d.launch(APP);
    await d.openUrl('appdyno-fixture://open/code', APP);
    await new Promise((r) => setTimeout(r, 1_000));
    // full, the entry gives up the focus at once: the runner must not read a field that is gone
    const r = await d.typeText('123456', { settle: SETTLE, submit: true });
    // no element reports the focus: typed as key events, not read back (no verdict)
    expect(r.mode).toBe('keys');
    expect(r.verified).toBeUndefined();
    expect(byId(await d.read(APP), 'code_value')?.label).toBe('Code: 123456');
    expect(await d.foreground()).toBe(APP); // the runner still answers
  });

  it('runs the platform accessibility audit on the accessibility fixture', async () => {
    await d.terminate(APP);
    await d.launch(APP);
    await d.openUrl('appdyno-fixture://open/a11y', APP);
    await new Promise((r) => setTimeout(r, 1_000));
    expect(byId(await d.read(APP), 'a11y_ok')).toBeDefined();
    const r = await d.audit();
    const of = (id: string) => r.issues.filter((i) => i.element?.id === id).map((i) => i.type);
    expect(r.engine).toBe('platform');
    expect(of('a11y_faint')).toContain('contrast');
    expect(of('a11y_small')).toContain('hitRegion');
    expect(of('a11y_unnamed')).toContain('sufficientElementDescription');
    expect(of('a11y_fixed')).toContain('dynamicType');
    expect(of('a11y_cut')).toContain('textClipped');
    // a clean control at the simulator's text size, whichever it is (the QA simulator runs "medium")
    expect(of('a11y_ok')).toEqual([]);
    expect(r.elapsedMs).toBeLessThan(15_000);
    // only the asked types; the runner still answers after it
    const only = await d.audit({ types: ['contrast'] });
    expect(new Set(only.issues.map((i) => i.type))).toEqual(new Set(['contrast']));
    expect(await d.foreground()).toBe(APP);
  }, 90_000);

  describe('direct input and reads', () => {
    const named = (t: Tree) =>
      t.nodes.filter(
        (n) =>
          n.f & 1 && n.b[2] > n.b[0] && n.b[3] > n.b[1] && (n.id ?? n.d ?? n.t ?? n.c !== 'Other'),
      );
    const center = (n: { b: [number, number, number, number] }) => ({
      x: (n.b[0] + n.b[2]) / 2,
      y: (n.b[1] + n.b[3]) / 2,
    });

    it('reads every screen as the runner reads it', async () => {
      const titles = ['Form', 'List', 'Dialog', 'Ticker', 'Permission'];
      for (const title of titles) {
        await open(title);
        const direct = await d.direct.read(APP);
        if ('refused' in direct) throw new Error(`${title}: ${direct.refused}`);
        const runner = await IosDevice.prototype.tree.call(d, { maxNodes: 5000 });
        const hidden = learnCopies(direct.tree, runner);
        assert(hidden, `${title}: the same nodes in the same order`);
        expect(sameTree(withoutCopies(direct.tree, hidden), runner), title).toBe(true);
      }
      expect(d.direct.status().read).toBe('direct');
      // an alert is the runner's to read
      const s = await open('Dialog');
      await d.tap(foundId(s, 'open_dialog'), { settle: SETTLE });
      expect(await d.direct.read(APP)).toEqual({ refused: 'alert' });
      expect((await d.tree()).nodes.some((n) => n.c === 'Alert')).toBe(true);
    }, 120_000);

    it('reads a typing field as the runner does: the focus and its text', async () => {
      const s = await open('Form');
      await d.typeText('Çok', { at: foundId(s, 'name_input'), settle: SETTLE });
      const runner = await IosDevice.prototype.tree.call(d, { maxNodes: 5000 });
      const direct = await d.direct.read(APP);
      if ('refused' in direct) throw new Error(direct.refused);
      const pick = (t: Tree) => t.nodes.find((n) => n.c === 'TextField' && n.t === 'Çok');
      expect(pick(direct.tree)?.f).toBe(pick(runner)?.f);
    });

    it('answers with final positions: every element against a read 1.5 s later', async () => {
      const moved = (a: Tree, b: Tree) => {
        const later = named(b);
        const off = named(a).filter((n) => {
          const i = later.findIndex(
            (m) =>
              m.c === n.c &&
              m.id === n.id &&
              m.d === n.d &&
              m.t === n.t &&
              n.b.every((v, k) => Math.abs(v - (m.b[k] ?? NaN)) <= 4),
          );
          if (i >= 0) later.splice(i, 1);
          return i < 0;
        });
        return [...off, ...later].map((n) => `${n.c} ${n.d ?? n.id ?? ''} ${n.b.join(',')}`);
      };
      for (const title of ['Form', 'List']) {
        const s = await home();
        const button = found(s, title);
        const there = await d.tap(button, { settle: SETTLE, read: 'tree', before: s.hash });
        expect(there.settle?.settled).toBe(true);
        await new Promise((r) => setTimeout(r, 1_500));
        assert(there.tree);
        expect(moved(there.tree, await d.tree()), title).toEqual([]);
        const now = await d.tree();
        const back = now.nodes.find((n) => n.c === 'Button' && n.b[1] < 120);
        assert(back);
        const out = await d.tap(center(back), { settle: SETTLE, read: 'tree', before: now.hash });
        await new Promise((r) => setTimeout(r, 1_500));
        assert(out.tree);
        expect(moved(out.tree, await d.tree()), `back from ${title}`).toEqual([]);
      }
      expect(d.direct.status().input).toBe('direct');
    }, 120_000);

    it('leaves out what a sheet covers, as the runner does', async () => {
      const settings = 'com.apple.Preferences';
      await d.terminate(settings);
      await d.launch(settings);
      let row: Screen['list'][number] | undefined;
      await expect
        .poll(
          async () => {
            const s = await d.read(settings);
            row = s.list.find((e) => /^(Apple Account|Sign in)/.test(e.label));
            return s.list.some((e) => e.label === 'General' || e.label === 'General General');
          },
          { timeout: 10_000 },
        )
        .toBe(true);
      assert(row);
      await d.tap(row, { settle: SETTLE, read: 'none' });
      await new Promise((r) => setTimeout(r, 1_500));
      const direct = await d.direct.read(settings);
      if ('refused' in direct) throw new Error(direct.refused);
      expect(named(direct.tree).map((n) => n.d)).not.toContain('General');
      const runner = await IosDevice.prototype.tree.call(d, { maxNodes: 5000 });
      expect(direct.tree.nodes.length).toBe(runner.nodes.length);
      await d.terminate(settings);
    }, 120_000);

    // the tree is final and the app's reports say all is still well before a pop has ended
    it('takes a tap right after going back, as UIKit takes none during the pop (10 of 10)', async () => {
      let s = await home();
      for (let i = 0; i < 10; i++) {
        const there = await d.tap(found(s, 'Form'), {
          settle: SETTLE,
          read: 'tree',
          before: s.hash,
        });
        assert(there.tree);
        expect(
          there.tree.nodes.some((n) => n.id === 'name_input'),
          `round ${i}`,
        ).toBe(true);
        const back = there.tree.nodes.find((n) => n.c === 'Button' && n.b[1] < 120);
        assert(back);
        await d.tap(center(back), { settle: SETTLE, read: 'none', before: there.tree.hash });
        s = await d.read(APP);
      }
    }, 120_000);

    it('swipes, long-presses and pinches without the runner', async () => {
      const s = await open('List');
      const before = (await d.tree()).nodes.find((n) => n.c === 'Cell' || n.c === 'StaticText');
      assert(before);
      const { w, h } = helloOf(d).screen;
      await d.swipe({ x: w / 2, y: h * 0.7 }, { x: w / 2, y: h * 0.3 }, 200, { settle: SETTLE });
      const after = await d.tree();
      expect(after.hash).not.toBe(s.hash);
      expect(after.nodes.find((n) => n.id === before.id && n.d === before.d)?.b).not.toEqual(
        before.b,
      );
      await d.longPress({ x: w / 2, y: h / 2 }, 300, { settle: SETTLE });
      const pinch = await d.act(
        {
          kind: 'gesture',
          pointers: [
            [
              { x: w / 2 - 20, y: h / 2, t: 0 },
              { x: w / 2 - 100, y: h / 2, t: 200 },
            ],
            [
              { x: w / 2 + 20, y: h / 2, t: 0 },
              { x: w / 2 + 100, y: h / 2, t: 200 },
            ],
          ],
        },
        { settle: SETTLE },
      );
      expect(pinch.settle).toBeDefined();
      expect(d.direct.status().input).toBe('direct');
    });

    it('reads a system alert over the app, and taps it', async () => {
      await simctl.privacy(udid, 'reset', 'location', APP);
      const s = await open('Permission');
      const ask = byId(s, 'permission_request') ?? s.list.find((e) => e.label.includes('Request'));
      assert(ask);
      const r = await d.tap(ask, { settle: SETTLE, read: 'tree', before: s.hash });
      assert(r.tree);
      const alert = r.tree.windows.find((w) => w.type === 3);
      expect(alert, 'the alert is in the answer').toBeDefined();
      const allow = r.tree.nodes.find((n) => n.w === 1 && n.c === 'Button');
      assert(allow);
      await new Promise((res) => setTimeout(res, 500));
      const gone = await d.tap(center(allow), {
        settle: SETTLE,
        read: 'tree',
        before: r.tree.hash,
      });
      expect(gone.tree?.windows.some((w) => w.type === 3)).toBe(false);
    });

    it('brings a running app forward as it is, and starts it afresh once terminated', async () => {
      await open('Form');
      const pid = await d.measure.pid(APP);
      await simctl.exec(['launch', udid, 'com.apple.Preferences']);
      await expect.poll(() => d.direct.front(), { timeout: 20_000 }).toBe('com.apple.Preferences');
      await d.launch(APP);
      expect(await d.measure.pid(APP)).toBe(pid);
      await expect
        .poll(async () => (await d.tree()).nodes.some((n) => n.id === 'name_input'), {
          timeout: 3_000,
        })
        .toBe(true);
      await d.launch(APP);
      expect(await d.measure.pid(APP)).toBe(pid);
      const s = await home();
      expect(await d.measure.pid(APP)).not.toBe(pid);
      expect(find(s, 'Form')).toBeDefined();
    });

    it('gives a swallowed touch to the runner, which keeps the input from then on', async () => {
      // what a Device Hub in Resize Mode does: every send reports success, nothing arrives
      const swallow = () =>
        Promise.resolve({
          closed: false,
          call: () => Promise.resolve({ ok: true }),
          close: () => undefined,
        } as unknown as HelperProcess);
      const other = new IosSimulatorDevice(
        udid,
        simctl,
        new DirectSim(udid, { ax: startSimAx, hid: swallow }),
      );
      await other.open();
      await other.terminate(APP);
      await other.launch(APP);
      const s = await other.read(APP);
      const r = await other.tap(found(s, 'Form'), { settle: SETTLE, read: 'tree', before: s.hash });
      expect(r.tree?.nodes.some((n) => n.id === 'name_input')).toBe(true);
      expect(other.direct.status().input).toMatch(/did not reach the app/);
      other.close();
    });

    it('reads and touches through the runner when the helpers do not start', async () => {
      const broken = (): Promise<HelperProcess> => Promise.reject(new Error('no clang here'));
      const other = new IosSimulatorDevice(
        udid,
        simctl,
        new DirectSim(udid, { ax: broken, hid: broken }),
      );
      await other.open();
      await other.terminate(APP);
      await other.launch(APP);
      const s = await other.read(APP);
      const r = await other.tap(found(s, 'Form'), { settle: SETTLE, read: 'tree', before: s.hash });
      expect(r.tree?.nodes.some((n) => n.id === 'name_input')).toBe(true);
      expect(other.direct.status().read).toMatch(/did not start/);
      other.close();
    });

    it('says hello with the size of the screen', () => {
      expect(d.hello?.screen.w).toBeGreaterThan(320);
      expect(d.hello?.screen.h).toBeGreaterThan(480);
    });

    it('is reported by the doctor', async () => {
      expect((await directChecks(udid)).map((c) => c.ok)).toEqual([true, true]);
    });
  });

  it('takes a screenshot', async () => {
    const { meta, data } = await d.screenshot({ format: 'jpeg', maxPx: 1024 });
    expect(Math.max(meta.w, meta.h)).toBeLessThanOrEqual(1024);
    expect(data.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('reads the home screen when the app is gone', async () => {
    await d.terminate(APP);
    expect(await d.foreground()).toBe('com.apple.springboard');
  });
});
