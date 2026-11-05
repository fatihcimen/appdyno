import type { InputEvent } from './port.js';
import type { ViewerMessage } from './viewer.js';

/** A device that falls behind this much gets the newest of a drag, and every finger down and up. */
const MAX_QUEUED = 64;

const isMove = (e: InputEvent | undefined) => e?.kind === 'touch' && e.p === 1;

/** A person's input as the viewer says it. */
export function inputOf(m: ViewerMessage): InputEvent {
  switch (m.op) {
    case 'touch':
      return {
        kind: 'touch',
        p: m.p as 0 | 1 | 2,
        x: Number(m.x),
        y: Number(m.y),
        ...(m.x2 !== undefined && { x2: Number(m.x2), y2: Number(m.y2) }),
        ...(m.wheel === true && { wheel: true }),
      };
    case 'key':
      return {
        kind: 'key',
        page: Number(m.page),
        usage: Number(m.usage),
        state: m.state as 1 | 2,
      };
    case 'text':
      return { kind: 'text', s: String(m.s) };
    default:
      return { kind: 'button', name: String(m.name) };
  }
}

/**
 * Input to a device, one at a time and in order. Moves are all that may be lost: the newest replaces one
 * still waiting, so that a slow device follows the finger and never replays its path.
 */
export class InputQueue {
  private readonly queue: InputEvent[] = [];
  private running = false;
  dropped = 0;
  failed = 0;

  constructor(private readonly send: (e: InputEvent) => Promise<void>) {}

  add(e: InputEvent) {
    if (isMove(e) && isMove(this.queue[this.queue.length - 1])) {
      this.queue[this.queue.length - 1] = e;
      this.dropped++;
    } else if (this.queue.length >= MAX_QUEUED) {
      const move = this.queue.findIndex(isMove);
      if (move >= 0) this.queue.splice(move, 1);
      else this.queue.shift();
      this.dropped++;
      this.queue.push(e);
    } else {
      this.queue.push(e);
    }
    if (!this.running) void this.pump();
  }

  private async pump() {
    this.running = true;
    for (let e = this.queue.shift(); e; e = this.queue.shift()) {
      try {
        await this.send(e);
      } catch {
        this.failed++;
      }
    }
    this.running = false;
  }
}
