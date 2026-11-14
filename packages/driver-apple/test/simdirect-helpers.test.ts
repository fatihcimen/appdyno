import { describe, expect, it, vi } from 'vitest';
import { must, stoppable } from '@appdyno/core';
import { directChecks } from '../src/provider.js';
import { DirectSim } from '../src/simdirect.js';
import { onKeyboard, sameTree } from '../src/simtree.js';
import type { HelperProcess } from '../src/simhelper.js';
import { cell, app, tree } from './sim-trees.js';

describe('the helpers prove themselves', () => {
  type Answer = (q: Record<string, unknown>) => Record<string, unknown>;
  /** A helper, and the mock of what it was asked. */
  const helping = (answer: Answer) => {
    const call = vi.fn((q: Record<string, unknown>) => Promise.resolve(answer(q)));
    return { call, helper: { closed: false, call, close: vi.fn() } as unknown as HelperProcess };
  };
  const helper = (answer: Answer) => helping(answer).helper;
  const ax = () =>
    helper((q) =>
      q.op === 'read'
        ? { ok: true, tree: app(cell('A', 0)), screen: [402, 874], touchesEnded: 2, ms: 3 }
        : { ok: true },
    );

  it('starts both helpers when warmed, the read one through its hello, and neither of one turned off', async () => {
    const started: string[] = [];
    const hello = () =>
      helper((q) =>
        q.op === 'hello'
          ? { ok: true, osVersion: '27.2', model: 'iPhone18,1', scale: 3, screen: [402, 874] }
          : { ok: true },
      );
    const starting = (tag: string) => ({
      ax: () => Promise.resolve((started.push(`${tag} read`), hello())),
      hid: () => Promise.resolve((started.push(`${tag} input`), ax())),
    });
    const d = new DirectSim('u', starting('on'));
    d.warm();
    await vi.waitFor(() => expect(d.screenKnown).toBe(true));
    new DirectSim('u', starting('off'), 'off').warm();
    new DirectSim('u', starting('read'), 'read').warm();
    expect(started.sort()).toEqual(['on input', 'on read', 'read read']);
  });

  it('keeps away from a read until asked, and off when told', async () => {
    const off = new DirectSim(
      'u',
      { ax: () => Promise.resolve(ax()), hid: () => Promise.resolve(ax()) },
      'off',
    );
    expect(await off.read('a.b')).toEqual({ refused: 'APPDYNO_SIM_DIRECT=off' });
    expect(await off.send({ kind: 'tap', x: 1, y: 1 })).toBe(false);
  });

  it('says hello from the helper, in portrait only, and knows the screen from it', async () => {
    const answer = (size: number[]) =>
      helper((q) =>
        q.op === 'hello'
          ? { ok: true, osVersion: '26.5', model: 'iPhone18,1', scale: 3, screen: size }
          : { ok: true },
      );
    const d = new DirectSim('u', {
      ax: () => Promise.resolve(answer([402, 874])),
      hid: () => Promise.resolve(ax()),
    });
    expect(d.screenKnown).toBe(false);
    expect(await d.hello()).toMatchObject({
      platform: 'ios',
      osVersion: '26.5',
      model: 'iPhone18,1',
      screen: { w: 402, h: 874, density: 3, rotation: 0 },
    });
    expect(d.screenKnown).toBe(true);
    const wide = new DirectSim('u', {
      ax: () => Promise.resolve(answer([874, 402])),
      hid: () => Promise.resolve(ax()),
    });
    await expect(wide.hello()).rejects.toThrow(/turned/);
    const none = new DirectSim('u', {
      ax: () => Promise.resolve(answer([0, 0])),
      hid: () => Promise.resolve(ax()),
    });
    await expect(none.hello()).rejects.toThrow(/no screen size/);
    const off = new DirectSim(
      'u',
      { ax: () => Promise.resolve(ax()), hid: () => Promise.resolve(ax()) },
      'off',
    );
    await expect(off.hello()).rejects.toThrow(/APPDYNO_SIM_DIRECT=off/);
  });

  it('turns a touch as a window turns one, by what the app in front says of itself', async () => {
    const touch = async (screen: number[], orientation: number) => {
      const sent: { events?: { x: number; y: number }[] }[] = [];
      const answer = helper((q) =>
        q.op === 'orientation'
          ? { ok: true, orientation }
          : { ok: true, osVersion: '26.5', model: 'x', scale: 3, screen },
      );
      const hid = helper((q) => {
        sent.push(q);
        return { ok: true };
      });
      const d = new DirectSim('u', {
        ax: () => Promise.resolve(answer),
        hid: () => Promise.resolve(hid),
      });
      // a turned screen is refused, and known all the same
      await d.hello().catch(() => undefined);
      // as in a process of its own after the turn: nothing told it, and it reads what is
      if (must(screen[0], 'a width') < must(screen[1], 'a height'))
        d.setRotation(orientation === 1 ? 0 : 1);
      expect(await d.send({ kind: 'tap', x: 753, y: 210 })).toBe(true);
      // after the input helper's first ask, a ping
      return must(sent.find((q) => q.events)?.events?.[0], 'a touch');
    };
    const [across, down] = [753 / 874, 210 / 402];
    const right = await touch([402, 874], 3);
    expect(right.x).toBeCloseTo(1 - down, 5);
    expect(right.y).toBeCloseTo(across, 5);
    const left = await touch([402, 874], 4);
    expect(left.x).toBeCloseTo(down, 5);
    expect(left.y).toBeCloseTo(1 - across, 5);
    const already = await touch([874, 402], 3);
    expect(already.x).toBeCloseTo(1 - down, 5);
    expect(already.y).toBeCloseTo(across, 5);
    const portrait = await touch([402, 874], 1);
    expect(portrait.x).toBeCloseTo(753 / 402, 5);
    expect(portrait.y).toBeCloseTo(210 / 874, 5);
  });

  it('leaves a turned touch to the runner if the app in front will not say how it stands', async () => {
    const answer = helper((q) =>
      q.op === 'orientation'
        ? { ok: false, refused: 'no-answer' }
        : { ok: true, osVersion: '26.5', model: 'x', scale: 3, screen: [402, 874] },
    );
    const d = new DirectSim('u', {
      ax: () => Promise.resolve(answer),
      hid: () => Promise.resolve(helper(() => ({ ok: true }))),
    });
    await d.hello();
    d.setRotation(1);
    expect(await d.send({ kind: 'tap', x: 10, y: 10 })).toBe(false);
  });

  it('asks the app when its animations are over, and tells what that took', async () => {
    const asked: unknown[] = [];
    const answer = helper((q) => {
      asked.push(q);
      return { ok: true, ms: 473, over: 1 };
    });
    const d = new DirectSim('u', {
      ax: () => Promise.resolve(answer),
      hid: () => Promise.resolve(ax()),
    });
    expect(await d.animationsOver()).toBe(473);
    expect(asked).toMatchObject([{ op: 'animations', within: 1 }]);
    const refused = helper(() => ({ ok: false, refused: 'no-report' }));
    const none = new DirectSim('u', {
      ax: () => Promise.resolve(refused),
      hid: () => Promise.resolve(ax()),
    });
    expect(await none.animationsOver()).toBeUndefined();
    vi.stubEnv('APPDYNO_ANIMATION_WAIT', '0');
    expect(await d.animationsOver()).toBeUndefined();
    expect(asked).toHaveLength(1);
    vi.unstubAllEnvs();
  });

  it('after a touch, asks for the app to have handled it before anything counts as still', async () => {
    const asked: Record<string, unknown>[] = [];
    const answer = helper((q) => {
      asked.push(q);
      return { ok: true, touchesEnded: q.op === 'arm' ? 4 : 6, ms: 300, screen: [402, 874] };
    });
    const hid = helper(() => ({ ok: true }));
    const d = new DirectSim('u', {
      ax: () => Promise.resolve(answer),
      hid: () => Promise.resolve(hid),
    });
    await d.hello();
    await d.touchHandled();
    expect(asked.map((q) => q.op)).toEqual(['hello']);
    await d.arm();
    expect(await d.send({ kind: 'tap', x: 1, y: 1 })).toBe(true);
    await d.touchHandled();
    expect(asked.at(-1)).toMatchObject({ op: 'touched', touches: 6 });
    // handled now: nothing to ask, and the next wait has nothing to wait for first
    await d.touchHandled();
    expect(asked.filter((q) => q.op === 'touched')).toHaveLength(1);
    await d.animationsOver();
    expect(asked.at(-1)).toMatchObject({ op: 'animations', touches: 6 });
  });

  it('leaves the simulator as it found it, unless a runner stays and needs it so', async () => {
    const asked: unknown[] = [];
    const answer = () =>
      helper((q) => {
        asked.push(q.op);
        return { ok: true, screen: [402, 874], osVersion: '26.5', model: 'x', scale: 3 };
      });
    const gone = new DirectSim('u', {
      ax: () => Promise.resolve(answer()),
      hid: () => Promise.resolve(ax()),
    });
    await gone.hello();
    gone.close();
    await vi.waitFor(() => expect(asked).toEqual(['hello', 'leave']));
    asked.length = 0;
    const stays = new DirectSim('u', {
      ax: () => Promise.resolve(answer()),
      hid: () => Promise.resolve(ax()),
    });
    await stays.hello();
    stays.close(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(asked).toEqual(['hello']);
  });

  it('believes a read that says what the runner says, and not one that does not', async () => {
    const d = new DirectSim(
      'u',
      { ax: () => Promise.resolve(ax()), hid: () => Promise.resolve(ax()) },
      undefined,
    );
    const r = await d.read('a.b');
    if ('refused' in r) throw new Error(r.refused);
    expect(d.screenKnown).toBe(true);
    const other = tree(app(cell('B', 200))).tree;
    expect(d.checkRead(r.tree, other)).toBe(false);
    expect(d.checkRead(r.tree, structuredClone(r.tree))).toBe(true);
    expect(d.touchesEnded).toBe(2);
    // once believed, a screen it reads differently goes to the runner, the helper stays on
    for (let i = 0; i < 4; i++) expect(d.checkRead(r.tree, other)).toBe(false);
    expect('tree' in (await d.read('a.b'))).toBe(true);
  });

  it('gives up after three reads that never agreed', async () => {
    const d = new DirectSim(
      'u',
      { ax: () => Promise.resolve(ax()), hid: () => Promise.resolve(ax()) },
      undefined,
    );
    const r = await d.read('a.b');
    if ('refused' in r) throw new Error(r.refused);
    const other = tree(app(cell('B', 200))).tree;
    for (let i = 0; i < 3; i++) d.checkRead(r.tree, other);
    expect('refused' in (await d.read('a.b'))).toBe(true);
    expect(d.status().read).toMatch(/differed/);
  });

  it('forgives a clock on screen when it compares', () => {
    const rows = (t: string) =>
      app(
        cell('A', 0),
        cell('B', 60),
        cell('C', 120),
        cell('D', 180),
        cell('E', 240),
        cell(t, 300),
      );
    expect(sameTree(tree(rows('12:00')).tree, tree(rows('12:01')).tree)).toBe(true);
  });

  it('sends a touch once the screen is known, and leaves input to the runner after a lost one', async () => {
    const { call, helper: hid } = helping(() => ({ ok: true }));
    const d = new DirectSim(
      'u',
      { ax: () => Promise.resolve(ax()), hid: () => Promise.resolve(hid) },
      undefined,
    );
    expect(await d.send({ kind: 'tap', x: 1, y: 1 })).toBe(false);
    await d.read('a.b');
    expect(await d.send({ kind: 'tap', x: 1, y: 1 })).toBe(true);
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ op: 'touch' }), expect.any(Number));
    expect(await d.send({ kind: 'key', key: 'enter' })).toBe(true);
    expect(call).toHaveBeenCalledWith({ op: 'key', page: 7, usage: 0x28 }, expect.any(Number));
    expect(await d.send({ kind: 'key', key: 'a', modifiers: ['command', 'shift'] })).toBe(true);
    expect(call).toHaveBeenLastCalledWith(
      { op: 'key', page: 7, usage: 0x04, modifiers: [0xe3, 0xe1] },
      expect.any(Number),
    );
    expect(await d.send({ kind: 'key', key: 'back' })).toBe(false);
    d.touchLost();
    expect(await d.send({ kind: 'tap', x: 1, y: 1 })).toBe(false);
    expect(d.status().input).toMatch(/did not reach the app/);
  });

  it('sends no touch for a call stopped while it waited on the helpers', async () => {
    const { call, helper: hid } = helping(() => ({ ok: true }));
    const stop = new AbortController();
    const reading = helper((q) => {
      // the stop comes as the turns are asked, the last wait before the stroke
      if (q.op === 'orientation') stop.abort();
      return q.op === 'read'
        ? { ok: true, tree: app(cell('A', 0)), screen: [402, 874], touchesEnded: 2, ms: 3 }
        : { ok: true };
    });
    const d = new DirectSim('u', {
      ax: () => Promise.resolve(reading),
      hid: () => Promise.resolve(hid),
    });
    await d.read('a.b');
    await expect(
      stoppable(stop.signal, () => d.send({ kind: 'tap', x: 1, y: 1 })),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(call.mock.calls.map(([q]) => q.op)).toEqual(['ping']);
  });

  it('leaves input to the runner when the app cannot report touches, not when one app says no', async () => {
    const refusing = (refused: string) =>
      helper((q) =>
        q.op === 'read'
          ? { ok: true, tree: app(cell('A', 0)), screen: [402, 874], touchesEnded: 0 }
          : { ok: false, refused },
      );
    const blind = new DirectSim(
      'u',
      {
        ax: () => Promise.resolve(refusing('the observer did not start')),
        hid: () => Promise.resolve(ax()),
      },
      undefined,
    );
    await blind.read('a.b');
    expect(await blind.arm()).toBe(false);
    expect(await blind.send({ kind: 'tap', x: 1, y: 1 })).toBe(false);
    const other = new DirectSim(
      'u',
      { ax: () => Promise.resolve(refusing('no-report')), hid: () => Promise.resolve(ax()) },
      undefined,
    );
    await other.read('a.b');
    expect(await other.arm()).toBe(false);
    expect(await other.send({ kind: 'tap', x: 1, y: 1 })).toBe(true);
  });

  it('knows a point on the keyboard', () => {
    const n = tree(app({ a: 19, f: [0, 500, 402, 374] }, cell('Row', 0))).tree.nodes;
    expect(onKeyboard(n, 10, 600)).toBe(true);
    expect(onKeyboard(n, 10, 10)).toBe(false);
  });

  it('leaves the first touch to the runner, unsent, where the daemon left the warm-up unanswered', async () => {
    const { call, helper: hid } = helping(() => ({ ok: false, error: 'dtuhidd did not answer' }));
    const d = new DirectSim(
      'u',
      { ax: () => Promise.resolve(ax()), hid: () => Promise.resolve(hid) },
      undefined,
    );
    d.warm();
    await vi.waitFor(() => expect(d.status().input).toMatch(/^runner: .*did not answer/));
    await d.read('a.b');
    expect(await d.send({ kind: 'tap', x: 1, y: 1 })).toBe(false);
    expect(call).toHaveBeenCalledOnce();
  });

  it('says a touch with no answer may have gone through, and leaves the next to the runner', async () => {
    for (const answer of [
      { ok: false, error: 'dtuhidd did not answer after the touches' },
      { ok: false, refused: 'timeout' },
      { ok: false, refused: 'helper-gone' },
    ]) {
      const { call, helper: hid } = helping((q) => (q.op === 'ping' ? { ok: true } : answer));
      const d = new DirectSim(
        'u',
        { ax: () => Promise.resolve(ax()), hid: () => Promise.resolve(hid) },
        undefined,
      );
      await d.read('a.b');
      await expect(d.send({ kind: 'tap', x: 1, y: 1 })).rejects.toMatchObject({
        code: 'TIMEOUT',
        sent: true,
      });
      expect(await d.send({ kind: 'tap', x: 1, y: 1 })).toBe(false);
      expect(call.mock.calls.map(([q]) => q.op)).toEqual(['ping', 'touch']);
    }
  });

  it('leaves the first touch to the runner, unsent, where the helper ended as it connected, warmed or not', async () => {
    for (const warmed of [false, true]) {
      const { call, helper: hid } = helping(() => ({ ok: false, refused: 'helper-gone' }));
      const d = new DirectSim(
        'u',
        { ax: () => Promise.resolve(ax()), hid: () => Promise.resolve(hid) },
        undefined,
      );
      await d.read('a.b');
      if (warmed) d.warm();
      expect(await d.send({ kind: 'tap', x: 1, y: 1 }), String(warmed)).toBe(false);
      expect(call.mock.calls.map(([q]) => q.op)).toEqual(['ping']);
      expect(d.status().input).toMatch(/^runner: the input helper's first ask: helper-gone/);
    }
  });

  it('turns both off in landscape: only portrait is verified', async () => {
    const d = new DirectSim(
      'u',
      { ax: () => Promise.resolve(ax()), hid: () => Promise.resolve(ax()) },
      undefined,
    );
    d.setRotation(1);
    expect(await d.read('a.b')).toEqual({ refused: 'no-target' });
    await expect(d.send({ kind: 'tap', x: 1, y: 1 })).resolves.toBe(false);
  });

  it('is reported by the doctor, a failure as a warning', async () => {
    const good = new DirectSim(
      'u',
      { ax: () => Promise.resolve(ax()), hid: () => Promise.resolve(ax()) },
      undefined,
    );
    expect((await directChecks('u', good)).every((c) => c.ok)).toBe(true);
    const bad = new DirectSim(
      'u',
      {
        ax: () =>
          Promise.resolve(helper(() => ({ ok: false, refused: 'the snapshot call is missing' }))),
        hid: () => {
          return Promise.reject(new Error('no CoreSimulator'));
        },
      },
      undefined,
    );
    const checks = await directChecks('u', bad);
    expect(checks.every((c) => !c.ok && c.warn)).toBe(true);
    expect(checks[0]?.detail).toContain('no CoreSimulator');
  });
});
