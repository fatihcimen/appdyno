import type { DeviceProvider, PictureText } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, ServerContext } from '../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { SCREENS } from '@appdyno/testing/fake-screens.js';
import { linkedClient } from '@appdyno/testing/calls.js';

type Result = { isError?: boolean; content: { text?: string }[] };

const word = (text: string): PictureText => ({
  text,
  x: 0.1,
  y: 0.1,
  w: 0.4,
  h: 0.05,
  confidence: 1,
});

/** A device whose screen has no word in its tree, and a picture that says `words`. */
async function connect(
  screen: string,
  words: () => Promise<PictureText[]>,
  level: 'accurate' | 'fast' = 'accurate',
) {
  const device = new FakeDevice();
  device.screen = screen;
  Object.defineProperty(device, 'mirror', {
    value: { screenshot: () => Promise.resolve({ data: Buffer.from([1]) }) },
  });
  const provider: DeviceProvider = {
    list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], { app: 'dev.app' });
  const s = await ctx.session();
  s.readWords = async () => ({ words: await words(), level });
  const client = await linkedClient(ctx, () => undefined);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as Result;
    return { error: r.isError === true, text: r.content.map((c) => c.text ?? '').join('\n') };
  };
  return { call, device, s };
}

SCREENS.blind = [{ c: 'android.view.View', b: [0, 0, 1080, 2400] }];

describe('a screen with no words in its tree', () => {
  it('reads them from its picture, and says so', async () => {
    const { call } = await connect('blind', () => Promise.resolve([word('Start Game')]));
    const r = await call('read_screen');
    expect(r.text).toContain('"Start Game" 324,300');
    expect(r.text).toContain('read from the picture');
  });

  it('says when the fast level read them, and that its letters may be wrong', async () => {
    const { call } = await connect('blind', () => Promise.resolve([word('Start Game')]), 'fast');
    expect((await call('read_screen')).text).toContain('letters outside English');
  });

  it('reads the tree once more first, as a screen on its way in has no words for a moment', async () => {
    let reads = 0;
    const { call, device } = await connect('blind', () => {
      reads++;
      return Promise.resolve([word('Half a sheet')]);
    });
    const tree = device.tree.bind(device);
    // the first read falls in the move, the next has the screen
    device.tree = (...args) => {
      const first = !device.calls.some((c) => c.name === 'tree');
      const r = tree(...args);
      if (first) device.screen = 'home';
      return r;
    };
    const r = await call('read_screen');
    expect(r.text).not.toContain('read from the picture');
    expect(reads).toBe(0);
  });

  it('looks once more as it looked, so that a dark screen is not woken for its words', async () => {
    const { s, device } = await connect('blind', () => Promise.resolve([]));
    const how: unknown[] = [];
    const tree = device.tree.bind(device);
    device.tree = (...args: unknown[]) => {
      how.push(args[0]);
      return tree();
    };
    await s.look();
    expect(how).toEqual([{ asItIs: true }, { asItIs: true }]);
  });

  it('takes a tap at their place, by a selector', async () => {
    const { call, device } = await connect('blind', () => Promise.resolve([word('Start Game')]));
    expect((await call('tap_screen', { selector: { text: 'Start Game' } })).error).toBe(false);
    expect(device.calls.find((c) => c.name === 'act')?.args[0]).toEqual({
      kind: 'tap',
      x: 324,
      y: 300,
    });
  });

  it('polls the picture for what comes, as a tree says nothing of it', async () => {
    let reads = 0;
    const { call } = await connect('blind', () =>
      Promise.resolve(++reads > 2 ? [word('Game Over')] : [word('Start Game')]),
    );
    const r = await call('check_element', { selector: { text: 'Game Over' }, timeoutMs: 5_000 });
    expect(r.text).toContain('found');
    expect(reads).toBeGreaterThan(2);
  });

  it('says why when the picture cannot be read, and goes on', async () => {
    const { call } = await connect('blind', () => Promise.reject(new Error('no compiler')));
    const r = await call('read_screen');
    expect(r.error).toBe(false);
    expect(r.text).toContain('none from the picture: no compiler');
  });

  it('passes no check that a text is not there when the picture that holds its words cannot be read', async () => {
    const { call } = await connect('blind', () => Promise.reject(new Error('no compiler')));
    const gone = { selector: { text: 'Game Over' }, check: 'absent' };
    for (const r of [
      await call('check_element', gone),
      await call('check_element', { ...gone, check: 'exists', expect: false }),
      await call('check_element', { ...gone, timeoutMs: 300 }),
    ]) {
      expect(r.error).toBe(true);
      expect(r.text).toContain(
        'cannot tell that text="Game Over" is not on the screen: its tree has no words, and its picture could not be read: no compiler',
      );
    }
    // read, the same check passes
    const { call: seen } = await connect('blind', () => Promise.resolve([word('Start Game')]));
    expect((await seen('check_element', gone)).error).toBe(false);
  });
});

describe('a screen with words in its tree', () => {
  it('takes no picture for them', async () => {
    let reads = 0;
    const { call, device } = await connect('home', () => {
      reads++;
      return Promise.resolve([]);
    });
    await call('read_screen');
    expect(reads).toBe(0);
    expect(device.calls.some((c) => c.name === 'screenshot')).toBe(false);
  });
});
