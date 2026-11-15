import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Body } from '../src/components/mascot/body.ts';
import { COUGH, Fire, PUFF, heatColor, look } from '../src/components/mascot/fire.ts';
import { Mind, type Deed, type Perch, type Traits } from '../src/components/mascot/mind.ts';
import { CLIPS } from '../src/components/mascot/names.ts';
import { CONTENT, empty, perchOn } from '../src/components/mascot/perches.ts';
import { awake } from '../src/components/mascot/stage.ts';

/** The same numbers at every run. */
const dice =
  (seed = 7) =>
  () =>
    (seed = (seed * 16807) % 2147483647) / 2147483647;
const FRAME = 1 / 60;

test('heat picks the color: smoke grey when cold, near white when hottest', () => {
  assert.deepEqual(heatColor(0), [150, 150, 158]);
  assert.deepEqual(heatColor(1), [255, 250, 225]);
  const [r, g, b] = heatColor(0.4);
  assert.ok(r > g && g > b, 'between, it is a flame');
});

test('a puff reaches about a head, rises as it cools, and is gone in a second', () => {
  const fire = new Fire(dice());
  const ppm = 100;
  const mouth = { x: 500, y: 300, angle: 0 };
  for (let t = 0; t < 0.3; t += FRAME) {
    fire.emit(PUFF, mouth, ppm, FRAME);
    fire.step(FRAME);
  }
  assert.ok(fire.sparks.length > 5 && fire.glow > 0, 'it burns, and lights the face');
  let farthest = 0;
  let highest = mouth.y;
  for (let t = 0; t < 1; t += FRAME) {
    fire.step(FRAME);
    for (const spark of fire.sparks) {
      farthest = Math.max(farthest, spark.x - mouth.x);
      highest = Math.min(highest, spark.y);
    }
  }
  assert.ok(farthest > 0.15 * ppm && farthest < 0.6 * ppm, `it reaches ${farthest.toFixed(0)} px`);
  assert.ok(highest < mouth.y - 0.05 * ppm, 'heat lifts it');
  assert.equal(fire.sparks.length, 0);
  assert.equal(fire.glow, 0);
});

test('a cough is only smoke', () => {
  const fire = new Fire(dice());
  for (let t = 0; t < 0.2; t += FRAME) fire.emit(COUGH, { x: 0, y: 0, angle: 0 }, 100, FRAME);
  assert.ok(fire.sparks.length > 3);
  for (const spark of fire.sparks) {
    const [r, g, b] = look(spark).color;
    assert.ok(Math.abs(r - g) < 40 && Math.abs(g - b) < 40, 'grey');
  }
});

test('a hop: a crouch, a rise under gravity, a landing that squashes and settles', () => {
  const body = new Body();
  body.hop(2);
  let peak = 0;
  let landings = 0;
  let flattest = 1;
  for (let t = 0; t < 2; t += FRAME) {
    if (body.step(FRAME)) landings += 1;
    peak = Math.max(peak, body.y);
    if (landings) flattest = Math.min(flattest, body.squash);
  }
  // v² / 2g
  assert.ok(Math.abs(peak - (2 * 2) / (2 * 9.81)) < 0.02, `it rises ${peak.toFixed(3)} m`);
  assert.equal(landings, 1);
  assert.ok(flattest < 0.95, 'the landing squashes it');
  assert.ok(body.grounded && Math.abs(body.squash - 1) < 0.02, 'and it comes to rest');
});

const traits = (scout?: () => Perch[]): Traits => ({
  lengths: Object.fromEntries(
    CLIPS.map((clip) => [clip, clip === 'takeoff' || clip === 'land' ? 0.4 : 1.6]),
  ) as Traits['lengths'],
  size: 100,
  ...(scout ? { scout } : {}),
  walk: 40,
  run: 120,
  reach: 70,
  random: dice(),
});
const perch = { left: 100, right: 700, y: 400 };

/** Steps a mind through some seconds, and gives the deeds it asked for with their times. */
function live(mind: Mind, from: number, seconds: number, each?: (now: number) => void) {
  const deeds: [number, Deed][] = [];
  for (let now = from; now < from + seconds; now += FRAME) {
    each?.(now);
    mind.step(FRAME, now);
    for (const deed of mind.deeds.splice(0)) deeds.push([now, deed]);
  }
  return deeds;
}

test('a tap on the stage is one breath toward it, and taps in a row do not stack', () => {
  const mind = new Mind(perch, traits());
  const aim = { x: 90, y: 300 };
  mind.tap(1, aim);
  mind.tap(1.2, aim);
  mind.tap(2, aim);
  const deeds = live(mind, 1, 2).map(([, deed]) => deed);
  assert.equal(deeds.length, 1);
  assert.ok(deeds[0] && 'puff' in deeds[0]);
  assert.deepEqual(deeds[0].aim, aim);
  assert.equal(mind.facing, -1, 'it turns to what it breathes at');
  mind.tap(6, { x: 900, y: 300 });
  assert.equal(live(mind, 6, 1).length, 1, 'a later tap counts again');
  assert.equal(mind.facing, 1);
});

test('a tap on the dragon startles it into a hop, and the next one gets a breath', () => {
  const mind = new Mind(perch, traits());
  mind.tap(1);
  assert.deepEqual(mind.deeds.splice(0), [{ hop: 2.2 }, { clip: 'takeoff' }]);
  mind.tap(8);
  const [deed] = mind.deeds.splice(0);
  assert.ok(deed && 'puff' in deed && !deed.aim);
});

test('a number sent to a gauge: it runs there, waits for it to land, and breathes fire at it once', () => {
  const mind = new Mind(perch, traits());
  const aim = { x: 600, y: 470 };
  const start = mind.x;
  // the console sends five numbers, 0.3 s apart
  const deeds = live(mind, 1, 8, (now) => {
    for (let i = 0; i < 5; i++)
      if (Math.abs(now - (1 + 0.3 * i)) < FRAME / 2) {
        mind.gauge(now, aim);
        assert.equal(mind.mode, 'run');
      }
  });
  const breaths = deeds.filter(([, deed]) => 'puff' in deed && deed.aim);
  assert.equal(breaths.length, 1);
  const [[at, breath] = []] = breaths;
  assert.deepEqual(breath, { puff: 'fire', aim });
  // 430 px at 120 px a second, after the last number has landed
  assert.ok(at !== undefined && at > 1 + 1.2 + 0.45 && at > 0.95 + (530 - start) / 120);
  assert.equal(Math.round(mind.x), 530, 'beside the gauge, on the side it came from');
  assert.equal(mind.facing, 1);
});

test('left alone it does one thing at a time on its perch, then sleeps until someone comes', () => {
  const mind = new Mind(perch, traits());
  let busiest = 0;
  const deeds = live(mind, 0, 24.9, () => {
    assert.ok(mind.x >= perch.left && mind.x <= perch.right);
    busiest = Math.max(busiest, mind.deeds.length);
  });
  assert.ok(deeds.length >= 1 && deeds.length <= 6, `${deeds.length} deeds in 25 s`);
  assert.ok(busiest <= 1);
  live(mind, 24.9, 12);
  assert.equal(mind.mode, 'sleep');
  assert.equal(live(mind, 40, 30).length, 0, 'asleep, it does nothing');
  mind.rouse(70);
  assert.equal(mind.mode, 'idle');
});

test('a layout that moves the block it stands on moves it along', () => {
  const mind = new Mind({ ...perch }, traits());
  mind.x = 400;
  mind.ride(-60, 250);
  assert.equal(mind.x, 340);
  assert.deepEqual(mind.perch, { left: 40, right: 640, y: 650 });
  assert.deepEqual(mind.place, { x: 340, y: 650 });
});

test("a block's top edge is a perch only where nothing stands over it", () => {
  const block = { left: 100, top: 500, width: 800, height: 200 };
  const size = 100;
  // a heading over the block's left 300 px
  const free = (x: number, y: number) => !(x < 400 && y > 420 && y < 500);
  assert.deepEqual(perchOn(block, size, free), { left: 400, right: 850, y: 500 });
  assert.equal(
    perchOn(block, size, () => false),
    undefined,
  );
  // 100 px clear is too short a stretch to stand on
  assert.equal(
    perchOn(block, size, (x) => x > 700 && x < 800),
    undefined,
  );
});

/** The deeds that are clips, by name. */
const clips = (deeds: [number, Deed][]) =>
  deeds.flatMap(([, deed]) => ('clip' in deed ? [deed.clip] : []));

test('to a near perch it hops, to a far one it flies, and it lands on the edge', () => {
  const near = { left: 760, right: 900, y: 330 };
  const far = { left: 200, right: 600, y: 1400 };
  for (const [to, way] of [
    [near, 'hop'],
    [far, 'fly'],
  ] as const) {
    const mind = new Mind(
      perch,
      traits(() => [to]),
    );
    mind.x = 650;
    mind.rouse(0);
    let highest = Infinity;
    let seen = false;
    let landed: number | undefined;
    const deeds = live(mind, 0, 24, (now) => {
      mind.rouse(now);
      if (mind.mode === way) seen = true;
      if (mind.perch === to) landed ??= mind.x;
      highest = Math.min(highest, mind.place.y);
      if (seen && mind.mode === 'idle' && mind.perch === to) assert.equal(mind.place.y, to.y);
    });
    assert.ok(seen, `it left by a ${way}`);
    assert.ok(
      clips(deeds).includes('takeoff') && clips(deeds).includes('land'),
      'a flap up and one down',
    );
    assert.ok(
      deeds.some(([, deed]) => 'thud' in deed),
      'the landing is felt',
    );
    assert.ok(highest < Math.min(perch.y, to.y) - 5, 'its way rises over both edges');
    assert.equal(mind.perch, to);
    assert.equal(
      landed,
      to === near ? to.left : to.right,
      'at the end nearer to where it came from',
    );
    assert.ok(mind.x >= to.left && mind.x <= to.right);
  }
});

test('with no perch in view it stays where it is', () => {
  const mind = new Mind(
    perch,
    traits(() => []),
  );
  live(mind, 0, 60, (now) => {
    mind.rouse(now);
    assert.ok(mind.mode !== 'fly' && mind.mode !== 'hop');
  });
  assert.equal(mind.perch, perch);
});

test('left out of sight it flies in from the edge of the screen, and not again so soon', () => {
  const near = { left: 200, right: 600, y: 1400 };
  const mind = new Mind(
    perch,
    traits(() => [near]),
  );
  mind.follow(1, { x: 300, y: 1000 });
  assert.equal(mind.mode, 'fly');
  assert.deepEqual(mind.place, { x: 300, y: 1000 });
  live(mind, 1, 3);
  assert.equal(mind.perch, near);
  mind.follow(5, { x: 300, y: 1000 });
  assert.equal(mind.mode, 'idle');
});

test('a number sent to a dial brings it to the perch by the dial, to breathe at the number', () => {
  const by = { left: 400, right: 900, y: 1400 };
  const mind = new Mind(perch, traits());
  const aim = { x: 600, y: 1470 };
  // each number comes with the perch as the page finds it then: the same edge, not the same object
  for (const at of [10, 10.3, 10.6]) {
    live(mind, at, 0.3, (now) => now === at && mind.gauge(now, aim, { ...by }));
    assert.equal(mind.mode, 'fly', 'one flight, whatever comes while it is in the air');
  }
  const breaths = live(mind, 10.9, 12).filter(([, deed]) => 'puff' in deed);
  assert.deepEqual(
    breaths.map(([, deed]) => deed),
    [{ puff: 'fire', aim }],
  );
  assert.deepEqual(mind.perch, by);
  assert.equal(Math.round(mind.x), 530, 'beside the number, on the side it came from');
  assert.deepEqual(mind.place, { x: mind.x, y: by.y });
});

/** A life of some minutes among some perches, with what it did by itself and how long each flight took. */
function roam(flights: number, seconds = 600) {
  const perches = [perch, { left: 760, right: 900, y: 330 }, { left: 200, right: 600, y: 1400 }];
  const mind = new Mind(perch, { ...traits(() => perches), flights });
  const acts: string[] = [];
  let took = 0;
  let longest = 0;
  live(mind, 0, seconds, (now) => {
    mind.rouse(now);
    if (acts.length < mind.acts) acts.push(mind.act);
    took = mind.mode === 'fly' ? took + FRAME : 0;
    longest = Math.max(longest, took);
    // on the ground it is on a perch, between its ends: nowhere else is a place to rest
    if (mind.mode !== 'fly' && mind.mode !== 'hop') {
      assert.ok(perches.includes(mind.perch));
      assert.equal(mind.place.y, mind.perch.y);
      assert.ok(mind.x >= mind.perch.left && mind.x <= mind.perch.right);
    }
  });
  return { acts, longest };
}

test('by itself it does every kind of thing, at random, and none twice in a row', () => {
  const { acts, longest } = roam(1);
  assert.deepEqual([...new Set(acts)].sort(), [
    'look',
    'puff',
    'roam',
    'scratch',
    'sit',
    'soar',
    'stroll',
  ]);
  acts.forEach((act, i) => assert.notEqual(act, acts[i - 1], `${act} twice in a row`));
  assert.notDeepEqual(acts.slice(0, 7), acts.slice(7, 14), 'in no fixed order');
  // a second in the air at most, after the crouch: what a flight crosses, it crosses quickly
  assert.ok(longest > 0.5 && longest <= 1.25 + 2 * FRAME, `its longest flight took ${longest} s`);
});

test('on a small screen it flies less often', () => {
  const flies = (acts: string[]) =>
    acts.filter((act) => act === 'roam' || act === 'soar').length / acts.length;
  const [large, small] = [flies(roam(1).acts), flies(roam(0.4).acts)];
  assert.ok(
    small > 0 && small < large * 0.7,
    `${small.toFixed(2)} of its acts, not ${large.toFixed(2)}`,
  );
});

test('nothing a visitor reads or presses is a place to stand over', () => {
  /** An element as `empty` reads it: what it is, or is inside, and the text that is its own. */
  const hit = (inside: string, text = '') => ({
    closest: (selector: string) => (selector.split(', ').includes(inside) ? {} : null),
    childNodes: [
      { nodeType: 1, textContent: 'a child, with words of its own' },
      { nodeType: 3, textContent: text },
    ],
  });
  assert.equal(empty(undefined), false, 'off the screen, nothing is known to be free');
  assert.equal(empty(hit('div')), true);
  assert.equal(empty(hit('div', '  \n')), true, 'the space between tags is not text');
  assert.equal(empty(hit('div', 'A heading')), false);
  for (const control of ['a', 'button', 'summary', 'input', 'img', 'pre', 'code'])
    assert.equal(empty(hit(control)), false, control);
  assert.ok(CONTENT.includes('[role="button"]'));
});

test('no frame is drawn with the tab hidden, in its sleep, or out of view and not on its way', () => {
  const seen = { hidden: false, asleep: 0, inView: true, flying: false };
  assert.equal(awake(seen), true);
  assert.equal(awake({ ...seen, hidden: true }), false);
  assert.equal(awake({ ...seen, asleep: 1 }), true, 'it is drawn falling asleep');
  assert.equal(awake({ ...seen, asleep: 2 }), false);
  assert.equal(awake({ ...seen, inView: false }), false);
  assert.equal(awake({ ...seen, inView: false, flying: true }), true, 'a flight back into view');
  assert.equal(awake({ ...seen, inView: false, flying: true, hidden: true }), false);
});
