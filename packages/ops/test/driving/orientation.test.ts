import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Tree } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { connect } from './shared.js';

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-driving-')));
});

describe('a turn of the screen', () => {
  /** As a phone turns: the call returns at once, the old screen stays a moment, then a window with nothing on it. */
  class Turning extends FakeDevice {
    turnedAt = 0;
    rotation = 0;
    override setOrientation(r: 0 | 1 | 2 | 3) {
      this.turnedAt = Date.now();
      this.rotation = r;
      return super.setOrientation(r);
    }
    override current(): Tree {
      const t = super.current();
      const since = Date.now() - this.turnedAt;
      if (this.rotation === 0 || since < 500) return t;
      if (since < 900) {
        t.nodes = t.nodes.slice(0, 1);
        t.hash = `${t.hash}+turning`;
        return t;
      }
      // wide, and what was on it laid out across it
      for (const n of [...t.windows, ...t.nodes])
        n.b = [n.b[0], n.b[1], n.b[2] + 1320, Math.min(n.b[3], 1080)];
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
    'waits for the turn of a tablet wide as it stands, and blames no app for the shape it stands in',
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
          const wide = (Date.now() - this.turnedAt < 500 ? this.was : this.rotation) % 2 === 0;
          if (wide)
            for (const n of [...t.windows, ...t.nodes])
              n.b = [n.b[0], n.b[1], n.b[2] + 1320, Math.min(n.b[3], 1080)];
          t.hash = `${t.hash}+${String(wide)}`;
          return t;
        }
      }
      const { call } = await connect(new Tablet());
      await call('screen');
      const up = await call('set_orientation', { orientation: 'landscape_left', read: 'full' });
      expect(up.text).toMatch(/"Ana sayfa" 540,150/);
      const back = await call('set_orientation', { orientation: 'portrait', read: 'full' });
      expect(back.text).toMatch(/"Ana sayfa" 1200,150/);
      for (const r of [up, back]) expect(r.text).not.toContain('stayed');
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
