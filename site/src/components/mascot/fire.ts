/**
 * The dragon's breath as particles, in page pixels with y down and in seconds. A spark leaves the
 * mouth with a speed, is slowed by drag, cools, and is lifted by its own heat: hot gas rises
 * fast, cold smoke drifts. Its heat picks its color, and it grows and fades as it ages.
 */

/** Drag (1/s), the lift of the hottest gas and of cold smoke (m/s²), and the time (s) a spark's heat takes to fall to 37%. */
const DRAG = 3.2;
const BUOY = 6;
const LIFT = 0.5;
const COOL = 0.32;
/** How many times its first size a spark has grown by its end. */
const GROWTH = 2.6;
/** Under this heat a spark is smoke, and drawn fainter. */
const SMOKE = 0.22;

/** Heat to color: smoke, dark smoke, red, orange, yellow, white. */
const RAMP: [heat: number, r: number, g: number, b: number][] = [
  [0, 150, 150, 158],
  [0.16, 125, 118, 118],
  [0.3, 214, 52, 24],
  [0.5, 255, 138, 30],
  [0.75, 255, 214, 90],
  [1, 255, 250, 225],
];

export function heatColor(heat: number): [r: number, g: number, b: number] {
  let i = 1;
  while (i < RAMP.length - 1 && heat > (RAMP[i]?.[0] ?? 1)) i += 1;
  const [h0, ...from] = RAMP[i - 1] ?? [0, 0, 0, 0];
  const [h1, ...to] = RAMP[i] ?? [1, 0, 0, 0];
  const share = Math.min(1, Math.max(0, (heat - h0) / (h1 - h0)));
  const mix = (k: 0 | 1 | 2) => Math.round(from[k] + (to[k] - from[k]) * share);
  return [mix(0), mix(1), mix(2)];
}

/** One breath: sparks a second, their speed (m/s), life (s), first radius (m), heat and the cone they leave in (rad). */
export interface Breath {
  rate: number;
  speed: number;
  life: number;
  size: number;
  heat: number;
  spread: number;
}

/** A weak puff of fire: it reaches about a head's length. */
export const PUFF: Breath = {
  rate: 45,
  speed: 1.1,
  life: 0.5,
  size: 0.022,
  heat: 0.8,
  spread: 0.7,
};
/** No fire caught: only smoke comes out. */
export const COUGH: Breath = { ...PUFF, rate: 40, speed: 0.5, heat: 0.17 };

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  heat: number;
  size: number;
  /** Pixels in a meter where it was born: its lift is a real acceleration at the dragon's size. */
  ppm: number;
}

/** How a spark is drawn now: its radius in pixels, color and opacity. */
export function look(spark: Spark) {
  const heat = spark.heat * Math.exp(-spark.age / COOL);
  const aged = spark.age / spark.life;
  return {
    radius: spark.size * (1 + GROWTH * aged),
    color: heatColor(heat),
    alpha: (1 - aged) * (heat > SMOKE ? 0.9 : 0.45),
    heat,
  };
}

export class Fire {
  sparks: Spark[] = [];
  /** The part of a spark that the last frames have earned and not yet let out. */
  #owed = 0;

  readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /**
   * Lets out the sparks a breath owes for one frame, at the mouth and along the way it points.
   * `rise` is the mouth's own speed upward (m/s), which a spark is born with.
   */
  emit(
    breath: Breath,
    mouth: { x: number; y: number; angle: number },
    ppm: number,
    dt: number,
    rise = 0,
  ) {
    const { random } = this;
    for (this.#owed += breath.rate * dt; this.#owed >= 1; this.#owed -= 1) {
      const angle = mouth.angle + (random() - 0.5) * breath.spread;
      const speed = breath.speed * (0.6 + 0.8 * random()) * ppm;
      this.sparks.push({
        x: mouth.x,
        y: mouth.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - rise * ppm,
        age: 0,
        life: breath.life * (0.7 + 0.6 * random()),
        heat: breath.heat * (0.85 + 0.15 * random()),
        size: breath.size * ppm * (0.6 + 0.8 * random()),
        ppm,
      });
    }
  }

  /** Ages every spark by a frame: drag slows it, its heat lifts it, and the dead ones go. */
  step(dt: number) {
    this.sparks = this.sparks.filter((spark) => (spark.age += dt) < spark.life);
    for (const spark of this.sparks) {
      const heat = spark.heat * Math.exp(-spark.age / COOL);
      spark.vx -= DRAG * spark.vx * dt;
      spark.vy += (-DRAG * spark.vy - (BUOY * heat + LIFT) * spark.ppm) * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
    }
  }

  /** How brightly the fire lights the face, from 0 to 1: the heat of its youngest sparks. */
  get glow() {
    let heat = 0;
    for (const spark of this.sparks)
      if (spark.age < 0.12) heat += spark.heat * Math.exp(-spark.age / COOL);
    return Math.min(1, heat / 4);
  }
}
