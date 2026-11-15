/**
 * The dragon's body as one mass, in meters and seconds (it is one meter tall): gravity in the
 * air, and a spring that squashes it when it lands and lets it settle in two bounces.
 */

const GRAVITY = 9.81;
/** The squash spring (1/s²) and its damper (1/s): about 3 Hz. */
const STIFF = 420;
const DAMP = 18;
/** The squash speed a landing takes from each m/s of the fall, and the most a fall gives. */
const HIT = 1.6;
const HARDEST = 4;
/** A crouch comes before a hop: the squash it starts with, and how long until the feet leave. */
const CROUCH = 2.2;
const WIND_UP = 0.14;

export class Body {
  /** Height of the feet over the ground, and the speed upward. */
  y = 0;
  vy = 0;
  /** 1 at rest; under 1 squashed, over 1 stretched. The width goes the other way, so the volume stays. */
  squash = 1;
  #squashSpeed = 0;
  #leap: { in: number; speed: number } | undefined;

  get grounded() {
    return this.y === 0 && this.vy === 0;
  }

  /** A hop: a crouch now, and the take-off speed (m/s) a moment later. Gravity does the rest. */
  hop(speed: number) {
    if (!this.grounded || this.#leap) return;
    this.#squashSpeed -= CROUCH;
    this.#leap = { in: WIND_UP, speed };
  }

  /** A push on the squash spring with no hop, as a cough or the kick of a puff gives. */
  jolt(push: number) {
    this.#squashSpeed += push;
  }

  /** A frame. True in the frame the feet touch the ground. */
  step(dt: number) {
    if (this.#leap && (this.#leap.in -= dt) <= 0) {
      this.vy = this.#leap.speed;
      this.#leap = undefined;
    }
    let landed = false;
    if (this.y > 0 || this.vy > 0) {
      // semi-implicit Euler: the speed first, then the place
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        // the fall's speed goes into the squash
        this.#squashSpeed -= Math.min(HARDEST, -this.vy) * HIT;
        this.y = 0;
        this.vy = 0;
        landed = true;
      }
    }
    this.#squashSpeed += (-STIFF * (this.squash - 1) - DAMP * this.#squashSpeed) * dt;
    this.squash = Math.min(1.3, Math.max(0.6, this.squash + this.#squashSpeed * dt));
    return landed;
  }
}
