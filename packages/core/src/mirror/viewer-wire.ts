import type { NetworkVia } from '../device-network.js';
import type { Need } from './need.js';
import type { MotionWatch } from './port.js';

/**
 * The viewer's wire, by name: what it takes and what it says. Both sides pass over a name they do not know, so one
 * changed on one side only would fail in silence: a test holds this list to the viewer's sources.
 */
export const VIEWER_OPS = {
  takes: [
    'activity',
    'agent',
    'answer',
    'apps',
    'attach',
    'audit',
    'banner',
    'clients',
    'copied',
    'copyText',
    'crashes',
    'detach',
    'element',
    'flow',
    'hub',
    'logs',
    'mark',
    'measured',
    'measuring',
    'network',
    'note',
    'pair',
    'perf',
    'poke',
    'quit',
    'raise',
    'record',
    'recording',
    'recordStop',
    'results',
    'snapshot',
    'status',
    'tick',
    'touchAt',
    'turns',
    'watch',
  ],
  says: [
    'app',
    'board',
    'button',
    'clicked',
    'closed',
    'control',
    'done',
    'fired',
    'first',
    'hover',
    'hub',
    'inspect',
    'key',
    'lost',
    'marked',
    'needKey',
    'paneWatch',
    'perfWatch',
    'pick',
    'ready',
    'recorded',
    'refused',
    'sleep',
    'snapped',
    'stats',
    'text',
    'touch',
    'wake',
    'watched',
    'zoom',
  ],
} as const;

/** What a window of the hub says or is told carries its name, where the hub has more than one. */
type Staged = { stage?: string };

/** The fields a pane's control gives, by its name: most give none. */
type Control =
  | {
      name:
        | 'auditAgain'
        | 'both'
        | 'copy'
        | 'dashboard'
        | 'deviceList'
        | 'measureLaunch'
        | 'measureScroll'
        | 'networkRead'
        | 'networkStop'
        | 'reconnect'
        | 'record'
        | 'recordFlow'
        | 'screenshot';
    }
  | {
      name: 'deviceSet' | 'deviceLocation' | 'deviceRestore' | 'push';
      args: Record<string, unknown>;
    }
  | { name: 'journey'; file: string }
  | { name: 'links'; app?: string }
  | { name: 'networkStart'; via: NetworkVia }
  | { name: 'openLink'; url?: string; app?: string }
  | { name: 'pushes'; app?: string }
  | { name: 'pushToken'; app?: string; token?: string; kind?: string };

/** What the hub's window asks of the hub, by its action. */
type HubAction =
  | { action: 'select'; serial?: string }
  | { action: 'open'; serial: string; id?: string }
  | { action: 'close'; serial: string; id?: string }
  | { action: 'start' | 'stop'; id: string }
  | { action: 'pair'; serial: string; with: string }
  | { action: 'new'; kind: string; name: string; model: string; system: string }
  | {
      action: 'clients';
      /** What a Clients, Tools or Connect pane asks of the hub's services, with what it gives. */
      do: string;
      client?: string;
      remove?: boolean;
      fresh?: boolean;
      name?: string;
      stop?: boolean;
      app?: string;
      device?: string;
      folder?: string;
      seconds?: string;
      address?: string;
      code?: string;
    };

/**
 * What a viewer says, one member for each name with the fields the viewer's sources give it, held to them by a test.
 * `stats` alone is open, as the viewer adds its source's own counters to it.
 */
export type ViewerMessage = Staged &
  (
    | { op: 'app'; action: 'list' }
    | { op: 'app'; action: 'launch' | 'quit' | 'remove'; id: string }
    | { op: 'board'; text: string }
    | { op: 'button'; name: string }
    | { op: 'clicked'; name: string; found: boolean; under?: string; isIt?: boolean }
    | { op: 'closed' }
    | ({ op: 'control' } & Control)
    | { op: 'done'; id: string }
    | { op: 'fired'; name: string; found: boolean; enabled: boolean }
    | { op: 'first'; w: number; h: number; codec: string }
    | { op: 'hover'; x: number; y: number }
    | ({ op: 'hub' } & HubAction)
    | { op: 'inspect'; on: boolean }
    | { op: 'key'; page: number; usage: number; state: 1 | 2 }
    | { op: 'lost'; why: string; fatal: boolean }
    | { op: 'marked'; ms: number }
    | { op: 'needKey'; consecutive: number }
    | { op: 'paneWatch'; pane: string; on: boolean; level?: string }
    | { op: 'perfWatch'; on: boolean }
    | { op: 'pick'; x: number; y: number; as: string }
    | { op: 'ready' }
    | { op: 'recorded'; frames: number; seconds?: number; dropped?: number; why?: string }
    | { op: 'refused'; need: Need }
    | { op: 'sleep' }
    | { op: 'snapped'; file: string; ok: boolean; parts?: unknown }
    | ({ op: 'stats'; decoded: number } & Record<string, string | number>)
    | { op: 'text'; s: string }
    | { op: 'touch'; p: 0 | 1 | 2; x: number; y: number; x2?: number; y2?: number; wheel?: boolean }
    | { op: 'wake' }
    | ({ op: 'watched'; id: string } & MotionWatch)
    | { op: 'zoom'; scale: number }
  );

/** A part of the window as a test clicks, types or chooses it, as a person would: one of these at a time. */
type Poke = {
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  seconds?: number;
  right?: boolean;
  hover?: boolean;
  clickOn?: string;
  clickRow?: string;
  menu?: string;
  key?: string;
  text?: string;
  button?: string;
  done?: boolean;
  pane?: number;
  journey?: string;
  control?: string;
  link?: string;
  app?: string;
  push?: Record<string, unknown>;
  condition?: string;
  value?: string;
  issue?: string | number;
  click?: string;
  board?: boolean;
  ask?: string;
  fill?: string;
  folder?: string;
  press?: string;
  name?: string;
  id?: string;
};

/**
 * What a viewer is told, one member for each name with the fields this side gives it. `answer` and `clients` are open
 * past their names: each pane's answer, and the hub's services', has fields of its own, which that pane reads whole.
 */
export type ViewerOrder = Staged &
  (
    | {
        op: 'activity';
        at: number;
        time: string;
        tool: string;
        ms: number;
        ok: boolean;
        args: string;
        done?: string;
      }
    | { op: 'agent'; driving: boolean; tool?: string; client?: string }
    | ({ op: 'answer'; name: string; ok?: boolean; text?: string; line?: string } & Record<
        string,
        unknown
      >)
    | { op: 'apps'; apps: unknown[]; note?: string }
    | {
        op: 'attach';
        source: unknown;
        title?: string;
        input?: boolean | 'click';
        look?: unknown;
        focus?: boolean;
        zoom?: number;
      }
    | { op: 'audit'; state: string; issues: unknown[]; truncated?: boolean; why?: string }
    | { op: 'banner'; id?: string; text?: string; needsDone?: boolean; sound?: boolean }
    | ({ op: 'clients' } & Record<string, unknown>)
    | { op: 'copied'; file: string }
    | { op: 'copyText'; text: string }
    | { op: 'crashes'; reports: unknown[]; note?: string }
    | { op: 'detach' }
    | {
        op: 'element';
        tap: string;
        role?: string;
        label?: string;
        ref?: string;
        id?: string;
        selector?: string;
        rect?: { x: number; y: number; w: number; h: number };
        contrast?: string[];
        contrastNote?: string;
      }
    | {
        op: 'flow';
        on: boolean;
        starting: boolean;
        lines: string[];
        look: unknown[];
        file?: string;
      }
    | { op: 'hub'; devices: unknown[]; choices: unknown; showing?: string }
    | {
        op: 'logs';
        reset?: boolean;
        app?: string;
        note?: string;
        lines?: unknown[];
        none?: boolean;
      }
    | { op: 'mark'; bigger: boolean }
    | {
        op: 'measured';
        title: string;
        detail: string;
        ok?: boolean;
        hint?: string;
        value?: string;
        why?: string;
        flagged?: boolean;
        kept?: boolean;
      }
    | { op: 'measuring'; line: string }
    | {
        op: 'network';
        capturing?: NetworkVia | false;
        was?: NetworkVia;
        since?: number;
        entries?: unknown[];
        /** What the op said of the capture, as it said it. */
        note?: unknown;
        ways?: NetworkVia[];
        proxy?: string;
        needs?: string;
      }
    | { op: 'note'; text: string }
    | { op: 'pair'; both?: boolean; with?: string; failing?: string; ended?: boolean }
    | { op: 'perf'; sample: unknown; noise: unknown }
    | ({ op: 'poke' } & Poke)
    | { op: 'quit' }
    | { op: 'raise' }
    | { op: 'record'; file: string }
    | { op: 'recording'; on: boolean }
    | { op: 'recordStop' }
    | { op: 'results'; results: unknown[]; app?: string }
    | { op: 'snapshot'; file: string }
    | { op: 'status'; state: string; title?: string; fix?: string; need?: Need }
    | { op: 'tick'; w?: number; h?: number; seq?: number; turns?: number }
    | { op: 'touchAt'; x: number; y: number; agent?: boolean }
    | { op: 'turns'; turns: number }
    | { op: 'watch'; id: string; ms: number; strip: boolean }
  );

/** The members of `U` whose `K` may be `V`: one that has `V` among other names counts. */
type Naming<U, K extends string, V> =
  U extends Record<K, infer N> ? (V extends N ? U : never) : never;

/** What a viewer says by one name. */
export type ViewerSaid<K extends ViewerMessage['op']> = Naming<ViewerMessage, 'op', K>;

/** What a viewer is told by one name, but its name. */
export type ViewerTold<K extends ViewerOrder['op']> = Omit<Naming<ViewerOrder, 'op', K>, 'op'>;

/** A pane's control by its name, with what it gives. */
export type ViewerControl<N extends Control['name']> = Naming<ViewerSaid<'control'>, 'name', N>;

/** What the hub's window asks of the hub by its action. */
export type ViewerHubAsk<A extends HubAction['action']> = Naming<ViewerSaid<'hub'>, 'action', A>;
