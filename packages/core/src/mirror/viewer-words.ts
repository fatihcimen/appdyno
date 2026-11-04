import { inputOf } from './input-queue.js';
import type { Need } from './need.js';
import type { InputEvent } from './port.js';
import type { MirrorStats } from './state.js';
import type { ViewerMessage } from './viewer.js';

/** What a session does with what its viewer says. */
export type ViewerWords = {
  first(m: ViewerMessage): void;
  stats(stats: MirrorStats, decoded: number): void;
  lost(why: string, fatal: boolean): void;
  needKey(consecutive: number): void;
  recorded(m: ViewerMessage): void;
  input(e: InputEvent): void;
  zoom(scale: number): void;
  /** A control of the window that is no input. */
  control(m: ViewerMessage): void;
  done(id: string): void;
  marked(ms: number): void;
  closed(): void;
  refused(need: Need): void;
  sleep(): void;
  wake(): void;
};

/** A viewer's message as what it means; one a session does not know goes nowhere. */
export function heardFromViewer(m: ViewerMessage, on: ViewerWords) {
  switch (m.op) {
    case 'first':
      return on.first(m);
    case 'stats':
      return on.stats(m as MirrorStats, Number(m.decoded));
    case 'lost':
      return on.lost(String(m.why), m.fatal === true);
    case 'needKey':
      return on.needKey(Number(m.consecutive ?? 0));
    case 'recorded':
      return on.recorded(m);
    case 'touch':
    case 'key':
    case 'text':
    case 'button':
      return on.input(inputOf(m));
    case 'zoom':
      return on.zoom(Number(m.scale));
    case 'control':
    case 'app':
    case 'perfWatch':
      return on.control(m);
    case 'done':
      return on.done(String(m.id));
    case 'marked':
      return on.marked(Number(m.ms));
    case 'closed':
      return on.closed();
    case 'refused':
      return on.refused(m.need as Need);
    case 'sleep':
      return on.sleep();
    case 'wake':
      return on.wake();
    default:
      return undefined;
  }
}
