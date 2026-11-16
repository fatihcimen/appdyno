import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  must,
  type ScreenElement as CoreElement,
  type Selector as CoreSelector,
} from '@appdyno/core';
import { holder } from '@appdyno/ops';
import { DeviceError } from '@appdyno/protocol';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import * as entry from '../src/device.js';
import {
  aim,
  nameOf,
  openDevice,
  select,
  type Screen,
  type ScreenElement,
  type Selector,
} from '../src/device.js';
import { tapByWords } from '../examples/device.js';

/** Its own serial: what holds a device is a file other tests of this run write too. */
const SERIAL = 'emulator-5656';
let device = new FakeDevice(SERIAL);

vi.mock('../src/providers.js', () => ({
  deviceProviders: () => [
    {
      list: () => Promise.resolve([]),
      handles: (s: string) => s === 'no-driver',
      open: () => device,
    },
    {
      list: () => Promise.resolve([]),
      handles: (s: string) => s.startsWith('emulator-'),
      open: () => device,
    },
  ],
}));

/** What is published is the screen model's own, field for field, of the fields it has: neither can change alone. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const sameElement: Same<ScreenElement, Pick<CoreElement, keyof ScreenElement>> = true;
const sameSelector: Same<Selector, CoreSelector> = true;

const el = (
  ref: string,
  label: string,
  [x, y, width, height]: [number, number, number, number],
  role = 'button',
): ScreenElement => ({
  ref,
  role,
  label,
  rect: { x, y, width, height },
  x: Math.round(x + width / 2),
  y: Math.round(y + height / 2),
  flags: ['clickable'],
});
const screenOf = (...elements: ScreenElement[]): Screen => ({ elements, hash: 'h1' });

beforeEach(() => {
  device = new FakeDevice(SERIAL);
});

describe('appdyno/device', () => {
  it('has these names to call, and the rest are types', () => {
    expect(Object.keys(entry).sort()).toEqual(['aim', 'nameOf', 'openDevice', 'select']);
    expect([sameElement, sameSelector]).toEqual([true, true]);
  });

  it('runs the example the docs show: a read, a tap compared with it, and the screen after', async () => {
    const lines: string[] = [];
    const after = await tapByWords('emulator-5656', 'Form', (l) => lines.push(l));
    expect(lines).toEqual([expect.stringMatching(/^tapped @\S+ "Form" at 540,350$/)]);
    expect(after).toContain('Bilgiler');
    const tap = device.calls.find((c) => c.name === 'act');
    expect(tap?.args[0]).toEqual({ kind: 'tap', x: 540, y: 350 });
    expect(tap?.args[1]).toMatchObject({ before: expect.any(String) as string, settle: {} });
    const shown = readFileSync(
      new URL('../../../docs/reference/library.md', import.meta.url),
      'utf8',
    );
    const example = readFileSync(new URL('../examples/device.ts', import.meta.url), 'utf8');
    expect(shown).toContain(example.trim());
  });

  /** A launch on a screen that is another on each read up to the `still`th, and one screen from then on. */
  const launched = async (still: number) => {
    const d = await openDevice(SERIAL, { share: true });
    const tree = device.tree.bind(device);
    let reads = 0;
    device.tree = () => {
      reads += 1;
      device.screen = reads < still && reads % 2 ? 'form' : 'home';
      return tree();
    };
    const t0 = Date.now();
    const out = await d.launch('dev.app');
    return { d, out, reads, ms: Date.now() - t0 };
  };

  it(
    'waits after a launch for the first screen to come to rest, as launch_app does',
    fakeTimed(async () => {
      const { d, out, reads, ms } = await launched(4);
      expect(out).toMatchObject({ settled: true });
      // the screen that held: read first on the 4th read, and for 200 ms more
      expect(reads).toBeGreaterThan(4);
      expect(ms).toBeGreaterThanOrEqual(200);
      expect(ms).toBeLessThan(1_000);
      expect(device.calls.map((c) => c.name).slice(0, 2)).toEqual(['launch', 'tree']);
      expect((await d.screen()).elements.some((e) => e.label === 'Form')).toBe(true);
      await d.close();
    }),
  );

  it(
    'gives up on a screen that never rests after 3 s, and says so',
    fakeTimed(async () => {
      const { d, out, ms } = await launched(Infinity);
      expect(out).toMatchObject({ settled: false });
      expect(ms).toBeGreaterThanOrEqual(3_000);
      expect(ms).toBeLessThan(3_500);
      await d.close();
    }),
  );

  it('holds the device until close, and with share holds it from no one', async () => {
    const d = await openDevice('emulator-5656');
    expect(holder('emulator-5656')).toMatchObject({ pid: process.pid, tool: 'appdyno device' });
    expect(d).toMatchObject({ serial: 'emulator-5656', platform: 'android', virtual: true });
    await d.close();
    expect(holder('emulator-5656')).toBeUndefined();
    const shared = await openDevice('emulator-5656', { share: true });
    expect(holder('emulator-5656')).toBeUndefined();
    await shared.close();
  });

  it('refuses a device the allow list does not name, one no driver takes, and a list that is no expression', async () => {
    await expect(
      openDevice('emulator-5656', { allowDevices: /^emulator-5554$/ }),
    ).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await expect(openDevice('0000-phone')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      openDevice('emulator-5656', { allowDevices: 'emulator' as never }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(holder('emulator-5656')).toBeUndefined();
  });

  it('refuses a device another live process holds, and closes what it made for it', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    const pid = must(child.pid, "the child's pid");
    const file = join(must(process.env.APPDYNO_STATE_DIR, 'APPDYNO_STATE_DIR'), 'claims');
    try {
      const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
      });
      mkdirSync(file, { recursive: true });
      writeFileSync(
        join(file, `${SERIAL}.json`),
        JSON.stringify({
          pid,
          started: started.trim(),
          tool: 'other',
          since: '2026-11-03T00:00:00Z',
        }),
      );
      let closed = 0;
      device.close = () => {
        closed++;
      };
      // its own way to share, not a server's tool
      await expect(openDevice(SERIAL)).rejects.toMatchObject({
        code: 'DEVICE_CLAIMED',
        hint: 'use another device, or share this one: share: true in the options',
      });
      expect(closed).toBe(1);
      expect(holder(SERIAL)).toMatchObject({ pid });
      const shared = await openDevice(SERIAL, { share: true });
      await shared.close();
      expect(holder(SERIAL)).toMatchObject({ pid });
    } finally {
      child.kill('SIGKILL');
      rmSync(join(file, `${SERIAL}.json`), { force: true });
    }
  });

  it('lets go of a device that did not open', async () => {
    device.openError = new DeviceError('AGENT_UNAVAILABLE', 'no agent');
    await expect(openDevice('emulator-5656')).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' });
    expect(holder('emulator-5656')).toBeUndefined();
  });

  it('reads the window in front, a dialog that came by itself too, and aims there', async () => {
    const d = await openDevice('emulator-5656');
    const first = await d.screen();
    expect(first.foreground).toBeDefined();
    device.permissionUp = true;
    const now = await d.screen();
    expect(now.hash).not.toBe(first.hash);
    const allow = aim(now, { text: 'Uygulamayı kullanırken' });
    expect(allow.on).toBe(now.hash);
    await expect(d.tap(allow.point, { before: allow.on })).resolves.toEqual({
      settled: true,
      ms: 120,
    });
    expect(device.permissionUp).toBe(false);
    await d.close();
  });

  it('types, presses and swipes as the device does, and says what the field read back', async () => {
    const d = await openDevice('emulator-5656');
    await expect(d.typeText('abc', { at: { x: 1, y: 2 }, replace: true })).resolves.toEqual({
      settled: true,
      ms: 120,
      verified: true,
    });
    await expect(d.key('back')).resolves.toEqual({ settled: true, ms: 120 });
    await expect(d.swipe({ x: 500, y: 900 }, { x: 500, y: 300 })).resolves.toEqual({
      settled: true,
      ms: 120,
    });
    await expect(d.longPress({ x: 5, y: 5 }, 600)).resolves.toEqual({ settled: true, ms: 120 });
    device.settles = false;
    await expect(d.tap({ x: 5, y: 5 })).resolves.toEqual({ settled: false, ms: 120 });
    await d.close();
  });
});

describe('aiming on a read', () => {
  const player = el('@player', 'Now playing', [0, 800, 400, 80]);
  const pause = el('@pause', 'Pause', [170, 810, 60, 60]);
  const screen = screenOf(
    player,
    pause,
    el('@a', 'Row', [0, 0, 400, 60]),
    el('@b', 'Row', [0, 100, 400, 60]),
  );

  it('goes clear of a smaller control at the middle, and says which', () => {
    expect(aim(screen, { text: 'Now playing' })).toEqual({
      element: player,
      point: { x: 100, y: 840 },
      why: 'clear',
      other: pause,
      on: 'h1',
    });
    expect(aim(screen, { ref: '@pause' })).toEqual({
      element: pause,
      point: { x: 200, y: 840 },
      on: 'h1',
    });
  });

  it('refuses no match, several that stand apart, an index past the last, and a ref that is gone', () => {
    const code = (target: Parameters<typeof aim>[1]) => {
      try {
        aim(screen, target);
      } catch (e) {
        return (e as entry.DeviceRefusal).code;
      }
      return 'aimed';
    };
    expect(code({ text: 'Nowhere' })).toBe('NOT_FOUND');
    expect(code({ text: 'Row' })).toBe('AMBIGUOUS');
    expect(code({ text: 'Row', index: 1 })).toBe('aimed');
    expect(code({ text: 'Row', index: 2 })).toBe('NOT_FOUND');
    expect(code({ ref: '@gone' })).toBe('STALE');
    expect(select(screen, { text: 'Row' }).map((e) => e.ref)).toEqual(['@a', '@b']);
  });

  it('names an element by its words now, and by those it was shown with where they changed', () => {
    expect(nameOf(pause)).toBe('@pause "Pause"');
    expect(nameOf(pause, 'Pause')).toBe('@pause "Pause"');
    expect(nameOf(pause, 'Play')).toBe('@pause "Pause" (shown as "Play")');
  });

  it("says it in a caller's language, with a caller's secrets hidden in both its words", () => {
    const shownAs = (was: string) => `(önce «${was}»)`;
    expect(nameOf(pause, 'Play', { shownAs })).toBe('@pause "Pause" (önce «Play»)');
    expect(nameOf(pause, 'Pause', { shownAs })).toBe('@pause "Pause"');
    const clean = (text: string) => text.replace(/Pa\w+|Pl\w+/g, '•••');
    expect(nameOf(pause, 'Play', { clean })).toBe('@pause "•••"');
    expect(nameOf(pause, 'Stop', { clean, shownAs })).toBe('@pause "•••" (önce «Stop»)');
  });
});
