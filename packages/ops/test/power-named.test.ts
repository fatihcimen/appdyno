import type { Device, InspectedElement } from '@appdyno/core';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { describe, expect, it, vi } from 'vitest';
import { guardInputs, type Input } from '../src/power.js';
import type { Policy } from '../src/index.js';
import { onDevice } from './power-device.js';

/** An iPhone with no runner, whose accessibility service lists `Power` and presses what it is given. */
function inspected() {
  const listed: InspectedElement[] = [{ caption: 'Power' }, { caption: 'Add', identifier: 'add' }];
  const press = vi.fn((name: string) =>
    Promise.resolve(listed.find((e) => e.caption === name || e.identifier === name) ?? listed[0]),
  );
  const device = Object.assign(new FakeDevice('00008110-0000000000000000'), {
    virtual: false,
    inspector: { elements: () => Promise.resolve(listed), press },
  });
  return { device, press };
}

const pressed = { action: 'press', name: 'Power' };

describe("an element pressed by name by an iPhone's inspector", () => {
  it('passes the guard as every input does, which sees it before the phone does', async () => {
    const { device, press } = inspected();
    const seen: Input[] = [];
    const guarded = guardInputs(
      device as unknown as Device,
      (input) => {
        seen.push(input);
        return Promise.reject(new Error('refused'));
      },
      () => undefined,
      () => undefined,
    );
    await expect(guarded.inspector?.press('Power')).rejects.toThrow('refused');
    expect(seen).toEqual([{ points: [], named: 'Power' }]);
    expect(press).not.toHaveBeenCalled();
    // a read is no input
    expect(await guarded.inspector?.elements()).toHaveLength(2);
    expect(seen).toHaveLength(1);
  });

  it('asks the person, as nothing tells what it is, and presses nothing on a no', async () => {
    const { device, press } = inspected();
    const { call, asked } = await onDevice('ios-control-center-app', { device, answer: 'decline' });
    const r = await call('inspector', pressed);
    expect(r.code).toBe('PERMISSION_REQUIRED');
    expect(asked[0]).toContain('the element "Power", pressed by name with no look at what it is');
    expect(press).not.toHaveBeenCalled();
  });

  it('presses on a yes, or with --allow-power all, and asks nothing for a list', async () => {
    for (const o of [{ answer: 'accept' }, { policy: { allowPower: 'all' } }] as const) {
      const { device, press } = inspected();
      const { call, asked } = await onDevice('ios-control-center-app', { device, ...o });
      expect((await call('inspector', { action: 'list' })).error).toBe(false);
      expect((await call('inspector', pressed)).text).toBe('pressed Power');
      expect(press).toHaveBeenCalledWith('Power');
      expect(asked).toHaveLength('answer' in o ? 1 : 0);
    }
  });

  it('is refused where the client cannot ask, with how a person allows it ahead', async () => {
    const { device, press } = inspected();
    const { call } = await onDevice('ios-control-center-app', { device });
    const r = await call('inspector', pressed);
    expect(r.code).toBe('PERMISSION_REQUIRED');
    expect(r.hint).toContain('a press by name has no place on the screen to tell');
    expect(r.hint).toContain('--allow-power');
    expect(press).not.toHaveBeenCalled();
  });

  it('is off under --allow-apps and --no-home, which nothing tells it keeps to, --allow-power all or not', async () => {
    const held: [Partial<Policy>, string][] = [
      [{ apps: ['dev.app'] }, 'it may land outside the allowed apps (dev.app)'],
      [{ allowHome: false }, 'it may leave the app'],
    ];
    for (const [policy, why] of held) {
      const { device, press } = inspected();
      const { call, asked } = await onDevice('ios-control-center-app', {
        device,
        answer: 'accept',
        policy: { ...policy, allowPower: 'all' },
      });
      const r = await call('inspector', pressed);
      expect([r.code, r.text.split('\n')[0]]).toEqual([
        'POLICY_DENIED',
        `POLICY_DENIED: a press by name is off on this server: ${why}`,
      ]);
      expect([asked, press.mock.calls]).toEqual([[], []]);
    }
  });
});
