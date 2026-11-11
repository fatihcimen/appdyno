import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tree } from '@appdyno/protocol';
import { describe, expect, it, vi } from 'vitest';
import { IosSimulatorDevice } from '../src/index.js';
import { Simctl } from '../src/simctl.js';
import { openButton } from '../src/platform-screen.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';

const UDID = 'C8F701E7-9A02-4465-AC91-F4C85FBA788D';
const APP = 'dev.appdyno.fixture';
const HOME = 'com.apple.springboard';

/** A simulator tool that answers every call with nothing. */
const quiet = () => Object.assign(new Simctl({}), { exec: () => Promise.resolve('') });

const PROMPT = {
  words: ['Open in “appdyno fixture”?'],
  buttons: [
    { label: 'Cancel', x: 127, y: 474 },
    { label: 'Open', x: 275, y: 474 },
  ],
};

describe('the prompt iOS asks before a scheme first opens an app', () => {
  it('is answered by its button that opens, the second of two in any language', () => {
    expect(openButton(PROMPT, 'appdyno fixture')).toEqual({ x: 275, y: 474 });
    const tr = {
      ...PROMPT,
      buttons: [
        { label: 'İptal', x: 127, y: 474 },
        { label: 'Aç', x: 275, y: 474 },
      ],
    };
    expect(openButton(tr, 'appdyno fixture')).toEqual({ x: 275, y: 474 });
  });

  it("is not another alert, nor one naming another app: a permission's Allow is never touched", () => {
    const asks = { words: ['“Maps” Would Like to Use Your Location'], buttons: PROMPT.buttons };
    expect(openButton(asks, 'appdyno fixture')).toBeUndefined();
    expect(openButton(PROMPT, 'other app')).toBeUndefined();
    expect(openButton(undefined, 'appdyno fixture')).toBeUndefined();
  });

  it("is not the app's own permission prompt, which names it as well, with a line on why", () => {
    // as the helper read it over the fixture on an iOS 27.2 simulator
    const notifications = {
      words: [
        '“appdyno fixture” Would Like to Send You Notifications',
        'Notifications may include alerts, sounds, and icon badges. These can be configured in Settings.',
      ],
      buttons: [
        { label: 'Don’t Allow', x: 127, y: 518 },
        { label: 'Allow', x: 275, y: 518 },
      ],
    };
    expect(openButton(notifications, 'appdyno fixture')).toBeUndefined();
  });
});

describe("a link in a scheme of the app's own on a simulator", () => {
  const linked = (fronts: (string | undefined)[], schemes = ['appdyno-fixture']) => {
    const front = vi.fn(() => Promise.resolve(fronts.length > 1 ? fronts.shift() : fronts[0]));
    const read = vi.fn(() => Promise.resolve({ refused: 'alert', prompt: PROMPT }));
    const send = vi.fn(() => Promise.resolve(true));
    const direct = { reads: true, front, read, send, close: vi.fn() };
    const d = new IosSimulatorDevice(UDID, quiet(), direct as never);
    Object.assign(d, {
      opener: () => Promise.resolve({ schemes, name: 'appdyno fixture' }),
      keepDump: () => Promise.resolve(undefined),
    });
    return { d, send, read };
  };

  it('answers "Open in …?" and returns once the app is in front, where a cold app was the home screen', async () => {
    const { d, send } = linked([undefined, HOME, HOME, APP]);
    await d.openUrl('appdyno-fixture://open/list', APP);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ kind: 'tap', x: 275, y: 474 });
  });

  it('touches nothing with the app in front already', async () => {
    const { d, send, read } = linked([APP]);
    await d.openUrl('appdyno-fixture://open/list', APP);
    expect(read).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('a link on a simulator the helper does not read, by the runner', () => {
  /** A read of an iOS 27.2 simulator by the runner, with the alert up. */
  const read = (name: string) =>
    JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8')) as Tree;
  const linked = (tree: Tree) => {
    const direct = { reads: false, front: () => Promise.resolve(undefined), close: vi.fn() };
    const d = new IosSimulatorDevice(UDID, quiet(), direct as never);
    const tap = vi.fn(() => Promise.resolve({}));
    Object.assign(d, { target: () => Promise.resolve(), tree: () => Promise.resolve(tree), tap });
    vi.spyOn(d.apps, 'listApps').mockResolvedValue([{ id: APP, name: 'appdyno fixture' }]);
    return { d, tap };
  };

  it(
    'answers "Open in …?" by the app\'s name, and never its own notification prompt',
    fakeTimed(async () => {
      const asks = linked(read('ios-open-in-prompt'));
      await asks.d.openUrl('appdyno-fixture://open/list', APP);
      expect(asks.tap).toHaveBeenCalledExactlyOnceWith({ x: 275, y: 474 }, { settle: {} });
      const permission = linked(read('ios-notification-prompt'));
      await permission.d.openUrl('appdyno-fixture://open/list', APP);
      expect(permission.tap).not.toHaveBeenCalled();
    }),
  );
});
