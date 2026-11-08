import { inputOf } from './input-queue.js';
import type { Need } from './need.js';
import type { InputEvent } from './port.js';
import type { MirrorStats } from './state.js';
import type { ViewerMessage } from './viewer.js';

/** What a session does with what its viewer says. */
export type ViewerHandlers = {
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
  watched(m: ViewerMessage): void;
  closed(): void;
  refused(need: Need): void;
  sleep(): void;
  wake(): void;
};

/** A viewer's message as what it means; one a session does not know goes nowhere. */
export function handleViewerMessage(m: ViewerMessage, on: ViewerHandlers) {
  switch (m.op) {
    case 'first':
      on.first(m);
      break;
    case 'stats':
      on.stats(m as MirrorStats, Number(m.decoded));
      break;
    case 'lost':
      on.lost(String(m.why), m.fatal === true);
      break;
    case 'needKey':
      on.needKey(Number(m.consecutive ?? 0));
      break;
    case 'recorded':
      on.recorded(m);
      break;
    case 'watched':
      on.watched(m);
      break;
    case 'touch':
    case 'key':
    case 'text':
    case 'button':
      on.input(inputOf(m));
      break;
    case 'zoom':
      on.zoom(Number(m.scale));
      break;
    case 'control':
    case 'app':
    case 'perfWatch':
    case 'inspect':
    case 'hover':
    case 'pick':
      on.control(m);
      break;
    case 'done':
      on.done(String(m.id));
      break;
    case 'marked':
      on.marked(Number(m.ms));
      break;
    case 'closed':
      on.closed();
      break;
    case 'refused':
      on.refused(m.need as Need);
      break;
    case 'sleep':
      on.sleep();
      break;
    case 'wake':
      on.wake();
      break;
  }
}
