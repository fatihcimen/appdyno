import { must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { act, connect, withScreen } from './shared.js';

describe('a touch on a control whose middle is not its own', () => {
  it('goes clear of a smaller control at its middle, and says where', async () => {
    // a mini player: the whole bar opens the player, and its Pause button sits at the bar's middle
    withScreen('mini', [
      {
        c: 'android.view.View',
        d: 'Activate to open full size player',
        b: [0, 2010, 1080, 2178],
        f: 19,
      },
      { c: 'android.widget.ImageButton', d: 'Skip back', b: [334, 2031, 454, 2151], f: 19 },
      { c: 'android.widget.ImageButton', d: 'Pause', b: [481, 2031, 601, 2151], f: 19 },
      { c: 'android.widget.ImageButton', d: 'Skip forward', b: [628, 2031, 748, 2151], f: 19 },
    ]);
    const d = new FakeDevice();
    d.screen = 'mini';
    const { call } = await connect(d);
    const r = await call('tap_screen', { selector: { text: 'Activate to open full size player' } });
    expect(r.done).toMatch(
      /^tapped @\w+ "Activate to open full size player" at 270,2094, clear of @\w+ "Pause" at its middle$/,
    );
    expect(act(d).at(-1)).toEqual({ kind: 'tap', x: 270, y: 2094 });
    await call('tap_screen', { selector: { text: 'Pause' } });
    expect(act(d).at(-1)).toEqual({ kind: 'tap', x: 541, y: 2091 });
  });

  it('keeps the middle where no point of it is clear, and says whose it is', async () => {
    withScreen('crowded', [
      { c: 'android.view.View', d: 'Open player', b: [240, 2010, 840, 2178], f: 19 },
      { c: 'android.widget.ImageButton', d: 'Back', b: [250, 2031, 400, 2151], f: 19 },
      { c: 'android.widget.ImageButton', d: 'Pause', b: [470, 2031, 610, 2151], f: 19 },
      { c: 'android.widget.ImageButton', d: 'Next', b: [680, 2031, 830, 2151], f: 19 },
    ]);
    const d = new FakeDevice();
    d.screen = 'crowded';
    const { call } = await connect(d);
    const r = await call('tap_screen', { selector: { text: 'Open player' } });
    expect(r.done).toMatch(
      /^tapped @\w+ "Open player", whose middle is @\w+ "Pause"'s, which may take the touch$/,
    );
    expect(act(d).at(-1)).toEqual({ kind: 'tap', x: 540, y: 2094 });
  });

  it('keeps the middle of a long row whose own words past its cut take the touch there', async () => {
    withScreen('network', [
      { c: 'android.widget.LinearLayout', b: [0, 300, 1080, 420], f: 19 },
      {
        c: 'android.widget.TextView',
        t: 'Saved networks, data usage and the hotspot of this phone',
        p: 1,
        b: [20, 300, 390, 420],
      },
      { c: 'android.widget.TextView', t: 'Wi-Fi', p: 1, b: [400, 320, 680, 400], f: 19 },
    ]);
    const d = new FakeDevice();
    d.screen = 'network';
    const { call } = await connect(d);
    const row = must(
      /@\w+(?= tappable "Saved networks)/.exec((await call('read_screen')).text),
      'row',
    );
    expect((await call('tap_screen', { ref: row[0] })).done).toMatch(
      /^tapped @\w+ "Saved networks.*"$/,
    );
    expect(act(d).at(-1)).toEqual({ kind: 'tap', x: 540, y: 360 });
  });

  it('keeps the middle of a row whose own words take the touch there', async () => {
    withScreen('wifi', [
      { c: 'android.widget.LinearLayout', b: [0, 300, 1080, 420], f: 19 },
      { c: 'android.widget.TextView', t: 'Wi-Fi', p: 1, b: [400, 320, 680, 400], f: 19 },
    ]);
    const d = new FakeDevice();
    d.screen = 'wifi';
    const { call } = await connect(d);
    const r = await call('tap_screen', { selector: { text: 'Wi-Fi' } });
    expect(r.done).toMatch(/^tapped @\w+ "Wi-Fi"$/);
    expect(act(d).at(-1)).toEqual({ kind: 'tap', x: 540, y: 360 });
  });
});
