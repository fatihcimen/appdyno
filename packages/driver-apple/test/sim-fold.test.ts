import { describe, expect, it } from 'vitest';
import { displaysOf, ShownDisplay, SimulatorFold, type SimDisplay } from '../src/sim-fold.js';
import { onSurface, turnsOf } from '../src/mirror-sim.js';

/** What `devicectl device info displays` answered for an iPhone Duo simulator, iOS 27.2, closed: what is read of it. */
const answer = (open: boolean) => ({
  info: { outcome: 'success', jsonVersion: 5 },
  result: {
    displays: [
      {
        active: !open,
        backlightState: open ? 'off' : 'activeOn',
        currentOrientation: 'rot0',
        displayId: 1,
        name: 'LCD',
        nativeSize: [1398, 2034],
        pointScale: 3,
        primary: true,
        type: { integrated: {} },
      },
      {
        active: open,
        backlightState: open ? 'activeOn' : 'unknown',
        currentOrientation: 'rot90',
        displayId: 3,
        name: 'LCD-1',
        nativeSize: [2007, 2853],
        pointScale: 3,
        primary: false,
        type: { integrated: {} },
      },
    ],
  },
});

const COVER: SimDisplay = {
  id: 1,
  active: true,
  main: true,
  w: 466,
  h: 678,
  px: '1398x2034',
  scale: 3,
};
const INNER: SimDisplay = {
  id: 3,
  active: false,
  main: false,
  w: 669,
  h: 951,
  px: '2007x2853',
  scale: 3,
};

/** A Duo whose display follows the hinge past half way; `stuck`: one that takes the angle and stays as it is. */
const duo = (stuck = false) => {
  let open = false;
  const angles: number[] = [];
  const fold = new SimulatorFold(
    'DUO',
    () => Promise.resolve(displaysOf(answer(open))),
    async (degrees, done) => {
      angles.push(degrees);
      if (!stuck) open = degrees >= 90;
      await done();
    },
  );
  return { fold, angles };
};

describe("a foldable simulator's fold", () => {
  it('reads its built-in displays, in points and pixels, and which is active', () => {
    expect(displaysOf(answer(false))).toEqual([COVER, INNER]);
    expect(displaysOf(answer(true)).map((d) => d.active)).toEqual([false, true]);
    expect(displaysOf({ result: { displays: [{ displayId: 9, nativeSize: [1, 1] }] } })).toEqual(
      [],
    );
    expect(displaysOf(undefined)).toEqual([]);
  });

  it('is closed, open or half by the angle sent, read by the active display, and half only as set here', async () => {
    const { fold, angles } = duo();
    expect(await fold.poses()).toEqual(['closed', 'half', 'open']);
    expect(await fold.get()).toBe('closed');
    expect(await fold.set('open')).toBe(
      'display 2007x2853 at 3x; an app keeps its process, and its scene moves to this display',
    );
    expect(await fold.get()).toBe('open');
    await fold.set('half_opened');
    expect(await fold.get()).toBe('half');
    // put back as it was read
    expect(await fold.set('closed')).toContain('display 1398x2034 at 3x');
    expect(await fold.get()).toBe('closed');
    expect(angles).toEqual([180, 90, 0]);
    await expect(fold.set('flat')).rejects.toThrow('fold: closed, half, open, not flat');
  });

  it('sends an angle the display did not follow once more, then says the simulator stayed', async () => {
    const { fold, angles } = duo(true);
    await expect(fold.set('open')).rejects.toThrow(
      'asked for fold open and the simulator stays closed',
    );
    expect(angles).toEqual([180, 180]);
  }, 20_000);

  it('refuses a simulator with one display in the words every simulator did', async () => {
    let asked = 0;
    const phone = new SimulatorFold(
      'PHONE',
      () => (asked++, Promise.resolve([COVER])),
      () => Promise.reject(new Error('never sent')),
    );
    await expect(phone.get()).rejects.toThrow(/^simctl has no fold pose/);
    await expect(phone.set('open')).rejects.toThrow(/^simctl has no fold pose/);
    await expect(phone.poses()).rejects.toThrow(/^simctl has no fold pose/);
    // asked once: a window reads this row each time its pane shows
    expect(asked).toBe(1);
  });
});

describe('the display a foldable simulator shows', () => {
  it('is the other one while the system frame is not the main display, asked of devicectl once', async () => {
    let asked = 0;
    const shown = new ShownDisplay('DUO', () => {
      asked++;
      return Promise.resolve([
        { ...COVER, active: false },
        { ...INNER, active: true },
      ]);
    });
    // closed, upright and turned: the main display's short side
    expect(await shown.seen([466, 678], [466, 678])).toBe(false);
    expect(await shown.seen([678, 466], [466, 678])).toBe(false);
    expect(asked).toBe(0);
    // open, as the read helper gave the frame on iOS 27.2
    expect(await shown.seen([155.33333333333334, 226], [466, 678])).toBe(true);
    expect(await shown.seen([951, 669], [466, 678])).toBe(true);
    expect([shown.inner?.id, asked]).toEqual([3, 1]);
    // a look with no sizes changes nothing; closed again, by a person or another process, it is the main one
    expect(await shown.seen(undefined, undefined)).toBe(true);
    expect(await shown.seen([466, 678], [466, 678])).toBe(false);
    expect(shown.inner).toBeUndefined();
    // just opened: the app lies on its side at once and the frame is still the cover's, so devicectl is asked
    expect(await shown.seen([466, 678], [466, 678], 4)).toBe(true);
    expect(asked).toBe(2);
  });

  it('asks a simulator with one display once, however its app lies', async () => {
    let asked = 0;
    const shown = new ShownDisplay('PHONE', () => (asked++, Promise.resolve([COVER])));
    expect(await shown.seen([466, 678], [466, 678], 4)).toBe(false);
    expect(await shown.seen([466, 678], [466, 678], 3)).toBe(false);
    expect(asked).toBe(1);
    // a devicectl with nothing to say, as an older Xcode's of a simulator, is not asked at every touch
    let silent = 0;
    const old = new ShownDisplay('OLD', () => (silent++, Promise.resolve([])));
    expect(await old.seen([320, 480], [466, 678])).toBe(false);
    expect(await old.seen([320, 480], [466, 678])).toBe(false);
    expect(silent).toBe(1);
  });

  it("turns a point of the open scene into the inner panel's own frame, as a tap that arrived was sent", () => {
    // the fixture's Dialog at 40,129 of the 951 x 669 scene, whose interface orientation is 4
    const at = onSurface(40 / 951, 129 / 669, turnsOf(4) ?? 0);
    expect([at.x.toFixed(3), at.y.toFixed(3)]).toEqual(['0.193', '0.958']);
  });
});
