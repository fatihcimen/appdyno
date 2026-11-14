import { must } from '@appdyno/core';
import { type ActParams, type Tree } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { SCREENS } from '@appdyno/testing/fake-screens.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { connect, act, ScrollingList } from './shared.js';

type Bounds = [number, number, number, number];

/** A page with a row across it that only a finger on it moves, and a banner above that changes by itself. */
class SidewaysRow extends FakeDevice {
  offset = 0;
  ticks = 0;
  strokes = 0;
  override current(): Tree {
    SCREENS.row = [
      { t: `Banner ${this.ticks++}`, b: [0, 100, 1080, 300] },
      ...Array.from({ length: 10 }, (_, i) => ({
        t: `Fruit ${i + 1}`,
        b: [300 * i - this.offset, 800, 300 * i - this.offset + 280, 1000] as Bounds,
      })).filter((r) => r.b[2] > 0 && r.b[0] < 1080),
    ];
    this.screen = 'row';
    return super.current();
  }
  override async act(action: ActParams, opts = {}) {
    if (action.kind === 'gesture') {
      this.strokes++;
      const p = must(action.pointers[0], 'a path');
      const [start] = p;
      const end = p.at(-1);
      if (start && end && start.y >= 800 && start.y <= 1000)
        this.offset = Math.max(this.offset + start.x - end.x, 0);
    }
    return super.act(action, opts);
  }
}

const WONDERS = ['Great Wall', 'Petra', 'Colosseum', 'Chichen Itza', 'Machu Picchu', 'Taj Mahal'];

/**
 * Cards drawn as one picture, as Wonderous's on an iOS simulator: no element says it scrolls, nothing listed lies on
 * the screen's middle, and a stroke anywhere turns one card, whose words change in place, up to the last.
 */
class Carousel extends FakeDevice {
  card = 0;
  override current(): Tree {
    const name = must(WONDERS[this.card], 'a card');
    SCREENS.cards = [
      { t: 'Open main menu', b: [40, 180, 170, 310] },
      { t: name, b: [240, 1660, 840, 1960] },
      { t: `wonder ${this.card + 1} of ${WONDERS.length}.`, b: [0, 2000, 1080, 2080] },
      { t: `Explore details about ${name}.`, b: [470, 2060, 610, 2280] },
    ];
    this.screen = 'cards';
    return super.current();
  }
  override async act(action: ActParams, opts = {}) {
    if (action.kind === 'gesture') {
      const p = must(action.pointers[0], 'a path');
      const by = Math.sign(must(p[0], 'its start').x - must(p.at(-1), 'its end').x);
      this.card = Math.min(Math.max(this.card + by, 0), WONDERS.length - 1);
    }
    return super.act(action, opts);
  }
}

describe('scroll_to', () => {
  const ListDevice = ScrollingList;

  it('moves a row across the page with a finger on the row', async () => {
    const d = new SidewaysRow();
    const { call } = await connect(d);
    const r = await call('scroll_to', {
      selector: { text: 'Fruit 9' },
      direction: 'left',
      x: 540,
      y: 900,
    });
    expect(r.text).toMatch(/found .*"Fruit 9"/);
  });

  it('says of a row it did not move that it did not, whatever else changes on the screen', async () => {
    const d = new SidewaysRow();
    const { call } = await connect(d);
    const r = await call('scroll_to', {
      selector: { text: 'Fruit 9' },
      direction: 'right',
      x: 540,
      y: 900,
      maxSwipes: 8,
    });
    expect(r.error).toBe(true);
    expect(r.text).toContain('the list did not move');
    expect(d.strokes).toBeLessThan(8);
  });

  it('turns cards with nothing listed on the finger’s line, by what changes on the screen', async () => {
    const d = new Carousel();
    const { call } = await connect(d);
    const r = await call('scroll_to', { selector: { text: 'Machu Picchu' }, direction: 'left' });
    expect(r.text).toMatch(/found .*"Machu Picchu" .* after 4 swipes/);
    const back = await call('scroll_to', { selector: { text: 'Petra' }, direction: 'right' });
    expect(back.text).toMatch(/found .*"Petra" .* after 3 swipes/);
  });

  it('says of cards turned to their last that they did not move, with nothing listed on the finger’s line', async () => {
    const d = new Carousel();
    const { call } = await connect(d);
    const r = await call('scroll_to', {
      selector: { text: 'Christ the Redeemer' },
      direction: 'left',
      maxSwipes: 20,
    });
    expect(r.error).toBe(true);
    expect(r.text).toContain('the list did not move after 7 swipes');
  });

  it('finds what a stroke brought, though what the finger crossed stood still', async () => {
    const d = new Carousel();
    const { call } = await connect(d);
    const r = await call('scroll_to', {
      selector: { text: 'Colosseum' },
      direction: 'left',
      x: 540,
      y: 240,
    });
    expect(r.text).toMatch(/found .*"Colosseum" .* after 2 swipes/);
  });

  it('finds a row further down by scrolling, with no flick', async () => {
    const d = new ListDevice();
    const { call } = await connect(d);
    const r = await call('scroll_to', { selector: { text: 'Row 20' } });
    expect(r.error).toBe(false);
    expect(r.text).toMatch(/found .*"Row 20"/);
    expect(r.data.found).toBe(true);
    // it compares with its own last swipe, so it says nothing of whether the call changed the screen
    expect(r.data).not.toHaveProperty('changed');
    expect(r.text).not.toContain('no change seen');
    expect(d.swipes).toBeGreaterThan(0);
    const g = act(d).at(-1) as Extract<ActParams, { kind: 'gesture' }>;
    const before = must(g.pointers[0]?.at(-2), 'the point before its end');
    expect(g.pointers[0]?.at(-1)?.t).toBeGreaterThan(before.t);
    expect(g.pointers[0]?.at(-1)?.y).toBe(before.y);
  });

  it('answers once a list still coasting has stopped, with where the row ended', async () => {
    class Coasting extends ListDevice {
      coast = 0;
      override async act(action: ActParams, opts = {}) {
        const r = await super.act(action, opts);
        if (action.kind === 'gesture') this.coast = 4;
        return r;
      }
      override async tree() {
        if (this.coast > 0) {
          this.coast--;
          this.offset += 20;
        }
        return super.tree();
      }
    }
    const d = new Coasting();
    const { call } = await connect(d);
    const r = await call('scroll_to', { selector: { text: 'Row 20' }, read: 'full' });
    expect(r.error).toBe(false);
    expect(d.coast).toBe(0);
    const y = 200 * 20 - d.offset + 90;
    expect(r.text).toContain(`found`);
    expect(r.text).toMatch(new RegExp(`"Row 20" 540,${y}`));
  });

  it('stops at the list’s end when nothing moved', async () => {
    const d = new ListDevice();
    const { call } = await connect(d);
    const r = await call('scroll_to', { selector: { text: 'Row 99' }, maxSwipes: 40 });
    expect(r.error).toBe(true);
    expect(r.text).toContain('the list did not move');
    expect(r.text).toContain('nearest');
    expect(d.swipes).toBeLessThan(40);
  });

  it('takes one stroke that moved nothing for a screen still arriving, not for the list’s end', async () => {
    class Arriving extends ListDevice {
      lost = 1;
      override taken(by: number) {
        return this.lost-- > 0 ? 0 : by;
      }
    }
    const d = new Arriving();
    const { call } = await connect(d);
    const r = await call('scroll_to', { selector: { text: 'Row 20' } });
    expect(r.error).toBe(false);
    expect(r.data.found).toBe(true);
  });

  it('says swipes that brought no new rows may be at the end, as a pull to refresh at the top moves its rows', async () => {
    /** At its top, a pull down moves the rows down a while and back, as a refresh does, and brings none. */
    class Refreshing extends ListDevice {
      pulled = 0;
      override current(): Tree {
        const t = super.current();
        const by = this.pulled % 2 ? 120 : 0;
        for (const n of t.nodes)
          if (n.t?.startsWith('Row ')) n.b = [n.b[0], n.b[1] + by, n.b[2], n.b[3] + by];
        t.hash = `${t.hash}~${this.pulled % 2}`;
        return t;
      }
      override async act(action: ActParams, opts = {}) {
        if (action.kind === 'gesture') {
          const p = must(action.pointers[0], 'a path');
          if (must(p.at(-1), 'its end').y > must(p[0], 'its start').y) this.pulled++;
        }
        return super.act(action, opts);
      }
    }
    const d = new Refreshing();
    const { call } = await connect(d);
    const r = await call('scroll_to', {
      selector: { text: 'Row 99' },
      direction: 'down',
      maxSwipes: 3,
    });
    expect(r.error).toBe(true);
    expect(r.text).toContain('brought no new rows into view: the list may be at its end this way');
    expect(r.text).not.toContain('can still move');
    expect(r.text).toContain('try the other direction');
  });

  it('stops at the bound, and says it could go on', async () => {
    const d = new ListDevice();
    const { call } = await connect(d);
    const r = await call('scroll_to', { selector: { text: 'Row 29' }, maxSwipes: 1 });
    expect(r.error).toBe(true);
    expect(r.text).toContain('can still move');
    expect(d.swipes).toBe(1);
  });
});

describe('swipe exact', () => {
  /** A list that takes a finger's way less 10, and gives no more than its 30 rows. */
  class Dragged extends ScrollingList {
    override taken(by: number) {
      return Math.abs(by) <= 10 ? 0 : by - Math.sign(by) * 10;
    }
  }

  it(
    'moves the content by the distance, whatever a drag loses at its start',
    fakeTimed(async () => {
      const d = new Dragged();
      const { call } = await connect(d);
      const r = await call('swipe', { direction: 'up', distance: 3000, exact: true });
      expect(r.error).toBe(false);
      expect(Math.abs(d.offset - 3000)).toBeLessThanOrEqual(2);
      expect(r.text).toMatch(/^scrolled up 3\d{3} of 3000 in \d strokes/);
      const moves = act(d).filter((a) => a.kind === 'gesture');
      expect(moves.length).toBeGreaterThan(1);
    }),
  );

  it('a list that ends is no failure: the answer says how far it went', async () => {
    const d = new Dragged();
    d.offset = 200 * 30 - 2400 - 300;
    const { call } = await connect(d);
    const r = await call('swipe', { direction: 'up', distance: 1000, exact: true });
    expect(r.error).toBe(false);
    expect(r.text).toMatch(/^scrolled up 300 of 1000 in \d strokes?: the list ended/);
  });

  it('wants a distance', async () => {
    const { call } = await connect(new Dragged());
    expect((await call('swipe', { direction: 'up', exact: true })).error).toBe(true);
  });
});
