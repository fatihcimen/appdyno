import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { conditions } from '../../src/index.js';
import { connect } from './shared.js';

/** A device whose keyboard corrections are a value, each change seen with what was written down when it was made. */
function keyboard(o: { none?: boolean; was?: string } = {}) {
  const device = new FakeDevice(`sim-${String(Math.random()).slice(2, 10)}`);
  let now = o.was ?? 'default';
  const done: string[] = [];
  device.settings = {
    get: (name) => {
      if (name !== 'autocorrect') return Promise.resolve('');
      if (o.none) return Promise.reject(new DeviceError('UNSUPPORTED', 'none to set'));
      return Promise.resolve(now);
    },
    set: (name, value) => {
      done.push(`${value}, written down: ${String(conditions.read(device.serial)?.[name]?.was)}`);
      now = value;
      return Promise.resolve(undefined);
    },
  };
  return { device, done, now: () => now };
}

describe("a simulator keyboard's corrections, while appdyno types", () => {
  it('go off before the first typing, written down first, said once, and come back as they were at the end', async () => {
    const k = keyboard();
    const { ctx, call } = await connect(k.device);
    const first = (await call('type_text', { text: 'Grace Hopper' })).text;
    expect(first).toContain(
      "the keyboard's autocorrection and smart punctuation are off: put back when this session ends",
    );
    expect(k.done).toEqual(['off, written down: default']);
    expect((await call('type_text', { text: 'Ada' })).text).not.toContain('autocorrection');
    expect(k.done).toHaveLength(1);
    await ctx.end();
    ctx.close();
    expect(k.done).toEqual(['off, written down: default', 'default, written down: default']);
    expect(conditions.read(k.device.serial)?.autocorrect).toBeUndefined();
  });

  it("keeps a person's own values, and leaves alone a device that has none to set or has them off", async () => {
    const own = 'KeyboardAutocorrection=1 HWKeyboardAutocorrection=- KeyboardPrediction=0';
    const mine = keyboard({ was: own });
    const a = await connect(mine.device);
    await a.call('type_text', { text: 'x' });
    await a.ctx.end();
    a.ctx.close();
    expect(mine.now()).toBe(own);
    for (const k of [keyboard({ none: true }), keyboard({ was: 'off' })]) {
      const { ctx, call } = await connect(k.device);
      expect((await call('type_text', { text: 'x' })).text).not.toContain('autocorrection');
      expect(k.done).toEqual([]);
      expect(conditions.read(k.device.serial)?.autocorrect).toBeUndefined();
      ctx.close();
    }
  });

  it('are put back at the next session after a server that typed was killed', async () => {
    const k = keyboard({ was: 'off' });
    const gone = { pid: 999_999, started: 'gone', tool: 'appdyno mcp', since: '' };
    conditions.update(k.device.serial, () => ({ autocorrect: { was: 'default', owner: gone } }));
    const { ctx, call } = await connect(k.device);
    await call('read_screen');
    expect(k.done).toEqual(['default, written down: default']);
    expect(conditions.read(k.device.serial)?.autocorrect).toBeUndefined();
    ctx.close();
  });
});
