import { inputOf } from './input-queue.js';
import type { Need } from './need.js';
import type { InputEvent } from './port.js';
import type { MirrorStats } from './state.js';
import type { ViewerMessage, ViewerSaid } from './viewer-wire.js';

/** What a window says of its own controls, which a session hands on whole. */
export type WindowControl = ViewerSaid<
  'control' | 'app' | 'perfWatch' | 'paneWatch' | 'inspect' | 'hover' | 'pick'
>;

/** What a session does with what its viewer says. */
export type ViewerHandlers = {
  first(m: ViewerSaid<'first'>): void;
  stats(stats: MirrorStats, decoded: number): void;
  lost(why: string, fatal: boolean): void;
  needKey(consecutive: number): void;
  recorded(m: ViewerSaid<'recorded'>): void;
  input(e: InputEvent): void;
  zoom(scale: number): void;
  /** A control of the window that is no input. */
  control(m: WindowControl): void;
  done(id: string): void;
  marked(ms: number): void;
  watched(m: ViewerSaid<'watched'>): void;
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
      on.stats(m, m.decoded);
      break;
    case 'lost':
      on.lost(m.why, m.fatal);
      break;
    case 'needKey':
      on.needKey(m.consecutive);
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
      on.zoom(m.scale);
      break;
    case 'control':
    case 'app':
    case 'perfWatch':
    case 'paneWatch':
    case 'inspect':
    case 'hover':
    case 'pick':
      on.control(m);
      break;
    case 'done':
      on.done(m.id);
      break;
    case 'marked':
      on.marked(m.ms);
      break;
    case 'closed':
      on.closed();
      break;
    case 'refused':
      on.refused(m.need);
      break;
    case 'sleep':
      on.sleep();
      break;
    case 'wake':
      on.wake();
      break;
  }
}
