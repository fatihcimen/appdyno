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

/** A deed of a moment, over whatever it was doing: a clip played once, a breath, a hop of some take-off speed (m/s). */
export type Deed = { clip: Clip } | { puff: 'fire' | 'smoke'; aim?: Point } | { hop: number };

export interface Traits {
  /** How long each clip plays, in seconds. */
  lengths: Record<Clip, number>;
  /** Pixels a second its feet cover in a walk and in a run, so they do not slide. */
  walk: number;
  run: number;
  /** How far from a thing it stands to breathe at it. */
  reach: number;
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
const OWN = ['look', 'scratch', 'stroll', 'sit', 'puff'] as const;

export class Mind {
  x: number;
  /** 1 facing right, -1 facing left. */
  facing: 1 | -1 = 1;
  mode: 'idle' | 'walk' | 'run' | 'sit' | 'sleep' = 'idle';
  /** What it has asked of its body since the stage last took them. */
  deeds: Deed[] = [];

  #goal: number | undefined;
  #errand: { aim: Point; landed: number } | undefined;
  #busy = 0;
  #next = PAUSE;
  #cool = 0;
  #seen = 0;
  #sitUntil = 0;
  #lastOwn = '';
  #startled = false;
  readonly #random: () => number;

  perch: Perch;
  readonly traits: Traits;

  constructor(perch: Perch, traits: Traits) {
    this.perch = perch;
    this.traits = traits;
    this.x = perch.left + (perch.right - perch.left) * 0.3;
    this.#random = traits.random ?? Math.random;
  }

  /** The clip that loops under its deeds. */
  get base(): Clip {
    return this.mode;
  }

  /** The perch moved or changed size, as a layout does: it keeps its share of the way along it. */
  stand(perch: Perch) {
    const { left, right } = this.perch;
    const along = (x: number) =>
      perch.left +
      Math.min(1, Math.max(0, (x - left) / Math.max(1, right - left))) * (perch.right - perch.left);
    this.x = along(this.x);
    if (this.#goal !== undefined) this.#goal = along(this.#goal);
    this.perch = perch;
  }

  step(dt: number, now: number) {
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
    if (now < this.#cool) return;
    this.#goal = undefined;
    this.#errand = undefined;
    this.#startled = !aim && !this.#startled;
    if (this.#startled) {
      this.mode = 'idle';
      this.deeds.push({ hop: 2.2 }, { clip: 'jump' });
      this.#busy = now + this.traits.lengths.jump;
    } else this.#breathe(now, this.#random() < FAILS ? 'smoke' : 'fire', aim);
    this.#cool = this.#busy + COOL;
    this.#next = this.#busy + PAUSE;
  }

  /** The console sends a number to a gauge: it runs there, and breathes at the gauge once the number has landed. */
  gauge(now: number, aim: Point) {
    this.rouse(now);
    const { left, right } = this.perch;
    const { reach } = this.traits;
    // beside the gauge, on the side it comes from if the perch reaches that far
    const side = this.x <= aim.x ? -1 : 1;
    const spot = aim.x + side * reach;
    const goal = spot < left || spot > right ? aim.x - side * reach : spot;
    this.#errand = { aim, landed: now + LANDED };
    this.#goal = Math.min(right, Math.max(left, goal));
    this.mode = 'run';
  }

  /** The console did something worth a hop. */
  cheer(now: number) {
    this.rouse(now);
    if (now < this.#busy || this.#goal !== undefined || this.#errand) return;
    this.mode = 'idle';
    this.deeds.push({ hop: 1.6 });
    this.#busy = now + 0.8;
    this.#next = this.#busy + PAUSE;
  }

  #breathe(now: number, puff: 'fire' | 'smoke', aim?: Point) {
    this.mode = 'idle';
    if (aim) this.facing = aim.x >= this.x ? 1 : -1;
    this.deeds.push(aim ? { puff, aim } : { puff });
    this.#busy = now + this.traits.lengths.puff;
  }

  /** By itself, every few seconds, never the same thing twice in a row. */
  #own(now: number) {
    const choices = OWN.filter((name) => name !== this.#lastOwn);
    const pick = choices[Math.floor(this.#random() * choices.length)] ?? 'look';
    this.#lastOwn = pick;
    this.#busy = now;
    if (pick === 'stroll') {
      const { left, right } = this.perch;
      this.#goal = left + this.#random() * (right - left);
      this.mode = 'walk';
    } else if (pick === 'sit') {
      this.mode = 'sit';
      this.#sitUntil = now + 6 + 4 * this.#random();
      this.#busy = this.#sitUntil;
    } else if (pick === 'puff') this.#breathe(now, this.#random() < FAILS ? 'smoke' : 'fire');
    else {
      this.mode = 'idle';
      this.deeds.push({ clip: pick });
      this.#busy = now + this.traits.lengths[pick];
    }
    this.#next = this.#busy + PAUSE + PAUSE_MORE * this.#random();
  }
}
