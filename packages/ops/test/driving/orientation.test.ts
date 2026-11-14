import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Tree } from '@appdyno/protocol';
import { describe, expect, it, onTestFinished } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { SCREENS, tree } from '@appdyno/testing/fake-screens.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { connect } from './shared.js';

/** What a picture's own header says of its size, and nothing else of it. */
const pngOf = (w: number, h: number) => {
  const png = Buffer.alloc(24);
  png[0] = 0x89;
  png.writeUInt32BE(w, 16);
  png.writeUInt32BE(h, 20);
  return png;
};

/** Each node laid out across a screen turned wide, as a phone's at a quarter turn. */
const wide = (t: Tree) => {
  for (const n of [...t.windows, ...t.nodes])
    n.b = [n.b[0], n.b[1], n.b[2] + 1320, Math.min(n.b[3], 1080)];
  return t;
};

describe('a turn of the screen', () => {
  /** As a phone turns: the call returns at once, the old screen stays a moment, then a window with nothing on it. */
  class Turning extends FakeDevice {
    turnedAt = 0;
    rotation = 0;
    /** How much later than a phone's this one's screen turns, as a loaded tablet emulator's does. */
    lag = 0;
    override setOrientation(r: 0 | 1 | 2 | 3) {
      this.turnedAt = Date.now();
      this.rotation = r;
      return super.setOrientation(r);
    }
    override current(): Tree {
      const t = super.current();
      const since = Date.now() - this.turnedAt - this.lag;
      if (this.rotation === 0 || since < 500) return t;
      if (since < 900) {
        t.nodes = t.nodes.slice(0, 1);
        t.hash = `${t.hash}+turning`;
        return t;
      }
      // wide, and what was on it laid out across it
      wide(t);
      t.hash = `${t.hash}+turned`;
      return t;
    }
  }

  it(
    'answers with the screen turned and settled, as the call returns before the screen turns',
    fakeTimed(async () => {
      const d = new Turning();
      const { call } = await connect(d);
      const r = await call('set_orientation', { orientation: 'landscape_left', read: 'full' });
      expect(r.error).toBe(false);
      expect(r.text).toMatch(/"Ana sayfa" 1200,150/);
      expect(r.text).not.toContain('stayed');
    }),
  );

  it(
    'says so where the window kept its shape, as an app held to portrait does, with a read or none',
    fakeTimed(async () => {
      for (const read of ['full', 'none'] as const) {
        const { call } = await connect(new FakeDevice());
        const r = await call('set_orientation', { orientation: 'landscape_left', read });
        const kept = 'the window stayed tall: the app may keep to one orientation';
        expect(r.text, read).toContain(kept);
        expect(r.data.warnings, read).toContain(kept);
      }
    }),
  );

  it('waits for no turn the window already has, and says nothing of one', async () => {
    const { call } = await connect(new FakeDevice());
    await call('screen');
    const at = Date.now();
    const r = await call('set_orientation', { orientation: 'upside_down', read: 'none' });
    expect(Date.now() - at).toBeLessThan(2_000);
    expect(r.text).toBe('orientation: upside_down');
  });

  it(
    'turns a tablet wide as it stands to the shape each name says, its two landscapes a half turn apart',
    fakeTimed(async () => {
      /** A Pixel Tablet: Android counts its rotations from its own wide shape, so a quarter turn stands it up. */
      class Tablet extends FakeDevice {
        turnedAt = 0;
        rotation = 0;
        was = 0;
        constructor() {
          super();
          this.hello = { ...this.hello, screen: { w: 2560, h: 1600, density: 320, rotation: 0 } };
        }
        override setOrientation(r: 0 | 1 | 2 | 3) {
          [this.was, this.rotation, this.turnedAt] = [this.rotation, r, Date.now()];
          return super.setOrientation(r);
        }
        override current(): Tree {
          const t = super.current();
          const across = (Date.now() - this.turnedAt < 500 ? this.was : this.rotation) % 2 === 0;
          if (across) wide(t);
          t.hash = `${t.hash}+${String(across)}`;
          return t;
        }
      }
      const turns = (d: FakeDevice) =>
        d.calls.filter((c) => c.name === 'setOrientation').map((c) => c.args[0]);
      const d = new Tablet();
      const { call } = await connect(d);
      await call('screen');
      const across = await call('set_orientation', { orientation: 'landscape_left', read: 'full' });
      expect(across.text).toMatch(/"Ana sayfa" 1200,150/);
      const up = await call('set_orientation', { orientation: 'portrait', read: 'full' });
      expect(up.text).toMatch(/"Ana sayfa" 540,150/);
      await call('set_orientation', { orientation: 'upside_down', read: 'none' });
      await call('set_orientation', { orientation: 'landscape_right', read: 'none' });
      for (const r of [across, up]) expect(r.text).not.toContain('stayed');
      expect(turns(d)).toEqual([0, 3, 1, 2]);
      // a phone, tall as it stands, takes the names in its own order
      const phone = new FakeDevice();
      const { call: onPhone } = await connect(phone);
      for (const orientation of ['portrait', 'landscape_left', 'upside_down', 'landscape_right'])
        await onPhone('set_orientation', { orientation, read: 'none' });
      expect(turns(phone)).toEqual([0, 1, 2, 3]);
    }),
  );

  it(
    'says the window kept its shape only where the screen it lists did, as a turn may come after the wait for it',
    fakeTimed(async () => {
      const d = new Turning();
      d.lag = 2_200;
      const { call } = await connect(d);
      const r = await call('set_orientation', { orientation: 'landscape_left', read: 'full' });
      expect(r.text).toMatch(/"Ana sayfa" 1200,150/);
      expect(r.text).not.toContain('stayed');
    }),
  );

  it('says that the turn was made with another app in front, which the app may not keep', async () => {
    const d = new FakeDevice();
    d.fixture = tree(SCREENS.home ?? [], 'com.google.android.apps.nexuslauncher');
    const { call } = await connect(d);
    const r = await call('set_orientation', { orientation: 'portrait', read: 'none' });
    expect(r.text).toBe(
      'orientation: portrait, while com.google.android.apps.nexuslauncher is in front: dev.app may come back turned its own way',
    );
  });

  it('scales a picture of a turned screen by the tap units it stands in now, as wide as asked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-shot-'));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    /** A phone turned since its agent's hello, as adb has it after landscape_left: 2400x1080 at rotation 1. */
    class Landscape extends FakeDevice {
      asked: (number | undefined)[] = [];
      screenNow() {
        return Promise.resolve({ w: 2400, h: 1080, density: 420, rotation: 1 });
      }
      override current() {
        return wide(super.current());
      }
      override screenshot(o: { format?: 'png' | 'jpeg'; maxPx?: number } = {}) {
        this.asked.push(o.maxPx);
        const by = Math.min(1, (o.maxPx ?? 2400) / 2400);
        const [w, h] = [Math.round(2400 * by), Math.round(1080 * by)];
        const format = o.format ?? 'jpeg';
        return Promise.resolve({ meta: { w, h, format, bytes: 24 }, data: pngOf(w, h) });
      }
    }
    const d = new Landscape();
    Object.defineProperty(d, 'mirror', { value: {} });
    const { call } = await connect(d);
    expect((await call('screenshot')).text).toMatch(
      /^image 800x360 px; its pixel x,y is tapped at x × 3\.000, y × 3\.000/,
    );
    const asked = await call('screenshot', { width: 600 });
    expect([asked.text.split('\n')[0], asked.data.width, asked.data.scale]).toEqual([
      'image 600x270 px; its pixel x,y is tapped at x × 4.000, y × 4.000',
      600,
      4,
    ]);
    expect((await call('screenshot', { points: true })).text).toMatch(
      /^image 2400x1080 px; a pixel of it is a tap unit/,
    );
    expect(d.asked).toEqual([800, 600, 2400]);
    const file = join(dir, 'full.png');
    expect((await call('screenshot', { file, inline: false })).text).toBe(
      `saved ${file} (2400x1080 px; a pixel of it is a tap unit)`,
    );
    // a file as wide as asked too, not at full size
    const narrow = join(dir, 'narrow.png');
    expect((await call('screenshot', { file: narrow, width: 600, inline: false })).text).toBe(
      `saved ${narrow} (600x270 px; its pixel x,y is tapped at x × 4.000, y × 4.000)`,
    );
    const info = await call('device_info');
    expect(info.text).toContain('\nscreen 2400x1080, density 420, rotation 1\n');
    expect(info.data.screen).toEqual({ w: 2400, h: 1080, density: 420, rotation: 1 });
    expect((await call('use_device', { device: d.serial })).text).toContain(', screen 2400x1080');
  });

  it(
    'gives no scale for a picture that stands otherwise than the screen, nor a turn nothing read',
    fakeTimed(async () => {
      // a device that says nothing of its screen now: the picture is of the screen as it was built, tall
      const d = new Turning();
      const { call } = await connect(d);
      await call('set_orientation', { orientation: 'landscape_left', read: 'none' });
      const shot = await call('screenshot');
      expect(shot.text).toMatch(
        /^image 460x1024 px; the screen stands turned from it, 2400x1080 in tap units/,
      );
      expect(shot.data.scale).toBeUndefined();
      const info = await call('device_info');
      expect(info.text).toContain('\nscreen 2400x1080, density 420\n');
      expect(info.data.screen).toEqual({ w: 2400, h: 1080, density: 420 });
    }),
  );

  it(
    'is turned for the next read where its own answer reads nothing',
    fakeTimed(async () => {
      const d = new Turning();
      const { call } = await connect(d);
      await call('set_orientation', { orientation: 'landscape_left', read: 'none' });
      expect((await call('screen')).text).toMatch(/"Ana sayfa" 1200,150/);
    }),
  );
});
