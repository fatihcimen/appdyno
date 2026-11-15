import type { Clip } from './names.ts';

/**
 * What the dragon does and when, with nothing drawn: where it stands on its perch, where it is
 * going, and the deeds it asks of its body. The stage steps it each frame, tells it of taps and
 * of the console's numbers, and plays what it asks for. Places are page pixels, times seconds.
 */

/** The top edge it stands on: from left to right at one height. */
export interface Perch {
  left: number;
  right: number;
  y: number;
}
export interface Point {
  x: number;
  y: number;
}

/**
 * A deed of a moment, over whatever it was doing: a clip played once, a breath, a hop of some
 * take-off speed (m/s), and the thud of a landing that fell at some speed (m/s).
 */
export type Deed =
  { clip: Clip } | { puff: 'fire' | 'smoke'; aim?: Point } | { hop: number } | { thud: number };

export interface Traits {
  /** How long each clip plays, in seconds. */
  lengths: Record<Clip, number>;
  /** Its height in pixels. */
  size: number;
  /** Pixels a second its feet cover in a walk and in a run, so they do not slide. */
  walk: number;
  run: number;
  /** How far from a thing it stands to breathe at it. */
  reach: number;
  /** The perches a visitor can see now. With none it stays where it is. */
  scout?: () => Perch[];
  /** The share of its flights it takes: under 1 on a small screen, where it flies less often. */
  flights?: number;
  random?: () => number;
}

/** Seconds with no sign of a visitor before it falls asleep. */
const SLEEPY = 25;
/** The pause between two things it does by itself: at least, and at most this much more. */
const PAUSE = 4;
const PAUSE_MORE = 4;
/** After a tap, no other tap counts for this long past the breath: taps in a row do not stack fire. */
const COOL = 1.4;
/** A gauge's number has landed when no newer one has come for this long. */
const LANDED = 0.45;
/** Of its own breaths and of those a tap asks for, the share that catches no fire. */
const FAILS = 0.4;
/** What it does by itself: `roam` is a hop or a flight to another perch, `soar` a flight across the screen. */
const OWN = ['look', 'scratch', 'stroll', 'sit', 'puff', 'roam', 'soar'] as const;
/** A perch nearer than this many body heights is a hop away; a farther one is a flight. */
const HOP = 3;
/** A hop's time in the air, long enough for a flap up and one down, and the crouch before it; a flight's speed in heights a second, and its crouch. */
const HOP_TIME = 0.7;
const HOP_CROUCH = 0.14;
const FLIGHT_SPEED = 4;
const FLIGHT_CROUCH = 0.25;
/** No flight is longer than its two flaps or this, in seconds: what it crosses, it crosses quickly. */
const FLIGHT_LONGEST = 1;
/** It follows a visitor down the page at most this often. */
const FOLLOWS = 8;

/** Whether two perches are one edge: within a pixel, as the page gives an edge at two scrolls. */
const same = (a: Perch, b: Perch) =>
  Math.abs(a.y - b.y) < 1 && Math.abs(a.left - b.left) < 1 && Math.abs(a.right - b.right) < 1;

export class Mind {
  /** Where it stands along its perch. In the air, `place` says where it is. */
  x: number;
  /** 1 facing right, -1 facing left. */
  facing: 1 | -1 = 1;
  mode: 'idle' | 'walk' | 'run' | 'sit' | 'sleep' | 'hop' | 'fly' = 'idle';
  /** What it has asked of its body since the stage last took them. */
  deeds: Deed[] = [];
  /** The perch it stands on, or has just left. */
  perch: Perch;
  /** The last thing it did by itself, and how many such things it has done. */
  act: (typeof OWN)[number] | '' = '';
  acts = 0;
  readonly traits: Traits;

  #goal: number | undefined;
  #errand: { aim: Point; landed: number } | undefined;
  /** A way through the air: `t` runs from under zero, the crouch, to `time`. */
  #air:
    | { from: Point; to: Point; perch: Perch; t: number; time: number; arc: number; down: boolean }
    | undefined;
  #busy = 0;
  #next = PAUSE;
  #cool = 0;
  #seen = 0;
  #sitUntil = 0;
  #followed = -FOLLOWS;
  #startled = false;
  readonly #random: () => number;

  constructor(perch: Perch, traits: Traits) {
    this.perch = perch;
    this.traits = traits;
    this.x = perch.left + (perch.right - perch.left) * 0.3;
    this.#random = traits.random ?? Math.random;
  }

  /** The clip that loops under its deeds. */
  get base(): Clip {
    return this.mode === 'hop' ? 'idle' : this.mode;
  }

  /** Where its feet are on the page: on its perch, or along its way through the air. */
  get place(): Point {
    const air = this.#air;
    if (!air || air.t <= 0) return air ? air.from : { x: this.x, y: this.perch.y };
    const share = air.t / air.time;
    // a flight eases out of its start and into its end, and arches; a hop is a thrown ball
    const along = this.mode === 'fly' ? share * share * (3 - 2 * share) : share;
    const lift = this.mode === 'fly' ? Math.sin(Math.PI * share) : 4 * share * (1 - share);
    return {
      x: air.from.x + (air.to.x - air.from.x) * along,
      y: air.from.y + (air.to.y - air.from.y) * along - air.arc * lift,
    };
  }

  /** The block it stands on moved on the page, as a layout does: it goes with it. */
  ride(dx: number, dy: number) {
    this.perch.left += dx;
    this.perch.right += dx;
    this.perch.y += dy;
    this.x += dx;
    if (this.#goal !== undefined) this.#goal += dx;
  }

  step(dt: number, now: number) {
    if (this.#air) return this.#travel(dt, now);
    if (this.#goal !== undefined) {
      const left = this.#goal - this.x;
      const stride = (this.mode === 'run' ? this.traits.run : this.traits.walk) * dt;
      if (Math.abs(left) > stride) {
        this.facing = left > 0 ? 1 : -1;
        this.x += this.facing * stride;
        return;
      }
      this.x = this.#goal;
      this.#goal = undefined;
      this.mode = 'idle';
    }
    if (now < this.#busy) return;
    if (this.#errand) {
      if (now < this.#errand.landed) return;
      this.#breathe(now, 'fire', this.#errand.aim);
      this.#errand = undefined;
      this.#next = this.#busy + PAUSE;
    } else if (this.mode === 'sleep') return;
    else if (now - this.#seen > SLEEPY) this.mode = 'sleep';
    else if (this.mode === 'sit' && now > this.#sitUntil) this.mode = 'idle';
    else if (now > this.#next) this.#own(now);
  }

  /** A visitor is here: it wakes, and does not fall asleep for a while. */
  rouse(now: number) {
    this.#seen = now;
    if (this.mode !== 'sleep') return;
    this.mode = 'idle';
    this.#next = Math.max(this.#next, now + 1.5);
  }

  /** A tap: on the stage, a breath toward it; on the dragon itself, a startled hop and a breath in turn. */
  tap(now: number, aim?: Point) {
    this.rouse(now);
    if (now < this.#cool || this.#air) return;
    this.#goal = undefined;
    this.#errand = undefined;
    this.#startled = !aim && !this.#startled;
    if (this.#startled) {
      this.mode = 'idle';
      // the hop is its body's own, under gravity: the wings give it a flap
      this.deeds.push({ hop: 2.2 }, { clip: 'takeoff' });
      this.#busy = now + 0.9;
    } else this.#breathe(now, this.#random() < FAILS ? 'smoke' : 'fire', aim);
    this.#cool = this.#busy + COOL;
    this.#next = this.#busy + PAUSE;
  }

  /**
   * The console sends a number to a dial: it goes to the perch by the dial, from wherever it is,
   * runs along it to the number, and breathes at it once the number has landed. With no perch
   * there it does so on the one it has.
   */
  gauge(now: number, aim: Point, by?: Perch) {
    this.rouse(now);
    this.#errand = { aim, landed: now + LANDED };
    if (by && !same(by, this.#air?.perch ?? this.perch)) this.#leave(by, this.#beside(aim, by));
    else if (!this.#air) this.#runTo(aim);
  }

  /** The console did something worth a hop. */
  cheer(now: number) {
    this.rouse(now);
    if (now < this.#busy || this.#goal !== undefined || this.#errand || this.#air) return;
    this.mode = 'idle';
    this.deeds.push({ hop: 1.6 });
    this.#busy = now + 0.8;
    this.#next = this.#busy + PAUSE;
  }

  /**
   * The page has come to rest with the dragon out of sight: it flies in from `edge`, a point just
   * off the screen on its side, to a perch in view.
   */
  follow(now: number, edge: Point) {
    if (this.#air || this.#errand || now - this.#followed < FOLLOWS) return;
    const to = this.#pick(this.traits.scout?.() ?? []);
    if (!to) return;
    this.#followed = now;
    this.rouse(now);
    this.#leave(to, undefined, edge);
  }

  /** One of some perches that is not the one it is on. */
  #pick(perches: Perch[]) {
    const others = perches.filter((perch) => !same(perch, this.perch));
    return others.length ? others[Math.floor(this.#random() * others.length)] : undefined;
  }

  /** The place on a perch beside a dial's number, on the side it comes from if the perch reaches that far. */
  #beside(aim: Point, { left, right } = this.perch) {
    const { reach } = this.traits;
    const side = this.place.x <= aim.x ? -1 : 1;
    const spot = aim.x + side * reach;
    return Math.min(
      right,
      Math.max(left, spot < left || spot > right ? aim.x - side * reach : spot),
    );
  }

  #runTo(aim: Point) {
    this.#goal = this.#beside(aim);
    this.mode = 'run';
  }

  /** Leaves for a perch through the air: a hop to a near one, a flight to a far one, from off the screen, or when it soars. */
  #leave(to: Perch, x?: number, edge?: Point, soars = false) {
    if (this.#air?.perch === to) return;
    const from = edge ?? this.place;
    // at the end of the edge nearer to where it comes from: a block's side, not its middle
    const end = Math.abs(from.x - to.left) <= Math.abs(from.x - to.right) ? to.left : to.right;
    const land = { x: Math.min(to.right, Math.max(to.left, x ?? end)), y: to.y };
    const far = Math.hypot(land.x - from.x, land.y - from.y);
    const { size, lengths } = this.traits;
    const flies = far > HOP * size || edge !== undefined || soars;
    this.#goal = undefined;
    this.facing = land.x >= from.x ? 1 : -1;
    this.mode = flies ? 'fly' : 'hop';
    this.#air = flies
      ? {
          from,
          to: land,
          perch: to,
          t: -FLIGHT_CROUCH,
          time: Math.max(
            lengths.takeoff + lengths.land,
            Math.min(FLIGHT_LONGEST, far / (FLIGHT_SPEED * size)),
          ),
          arc: Math.min(1.2 * size, 0.2 * far),
          down: false,
        }
      : {
          from,
          to: land,
          perch: to,
          t: -HOP_CROUCH,
          time: HOP_TIME,
          // over the higher of the two edges
          arc: 0.5 * size + Math.max(0, from.y - land.y) / 2,
          down: false,
        };
    this.deeds.push({ clip: 'takeoff' });
  }

  #travel(dt: number, now: number) {
    const air = this.#air;
    if (!air) return;
    air.t += dt;
    if (!air.down && air.t > air.time - this.traits.lengths.land) {
      air.down = true;
      this.deeds.push({ clip: 'land' });
    }
    if (air.t < air.time) return;
    this.deeds.push({ thud: this.mode === 'fly' ? 1.2 : 2 });
    this.perch = air.perch;
    this.x = air.to.x;
    this.#air = undefined;
    this.mode = 'idle';
    this.#busy = now + 0.6;
    this.#next = this.#busy + PAUSE;
    if (this.#errand) this.#runTo(this.#errand.aim);
  }

  #breathe(now: number, puff: 'fire' | 'smoke', aim?: Point) {
    this.mode = 'idle';
    if (aim) this.facing = aim.x >= this.x ? 1 : -1;
    this.deeds.push(aim ? { puff, aim } : { puff });
    this.#busy = now + this.traits.lengths.puff;
  }

  /** By itself, every few seconds, never the same thing twice in a row. */
  #own(now: number) {
    const perches = this.traits.scout?.() ?? [];
    const elsewhere = this.#pick(perches);
    const across = perches[Math.floor(this.#random() * perches.length)];
    const flies = this.#random() < (this.traits.flights ?? 1);
    const may = { roam: flies && elsewhere, soar: flies && across };
    const choices = OWN.filter(
      (name) => name !== this.act && (!(name in may) || may[name as keyof typeof may]),
    );
    const pick = choices[Math.floor(this.#random() * choices.length)] ?? 'look';
    this.act = pick;
    this.acts += 1;
    this.#busy = now;
    if (pick === 'roam' && elsewhere) this.#leave(elsewhere);
    else if (pick === 'soar' && across) {
      // to the end of a perch that is farther from where it stands, its own perch among them
      const to = same(across, this.perch) ? this.perch : across;
      const far = this.x - to.left > to.right - this.x ? to.left : to.right;
      this.#leave(to, far, undefined, true);
    } else if (pick === 'stroll') {
      const { left, right } = this.perch;
      this.#goal = left + this.#random() * (right - left);
      this.mode = 'walk';
    } else if (pick === 'sit') {
      this.mode = 'sit';
      this.#sitUntil = now + 6 + 4 * this.#random();
      this.#busy = this.#sitUntil;
    } else if (pick === 'puff') this.#breathe(now, this.#random() < FAILS ? 'smoke' : 'fire');
    else if (pick !== 'roam' && pick !== 'soar') {
      this.mode = 'idle';
      this.deeds.push({ clip: pick });
      this.#busy = now + this.traits.lengths[pick];
    }
    this.#next = this.#busy + PAUSE + PAUSE_MORE * this.#random();
  }
}
