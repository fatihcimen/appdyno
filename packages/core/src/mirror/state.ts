import { NEEDS, type Need } from './need.js';

export type MirrorState =
  | { state: 'connecting' }
  | { state: 'live' }
  | { state: 'waiting'; need: Need }
  | { state: 'reconnecting'; attempt: number }
  | { state: 'stopped'; why: string; need?: Need };

/** A second's numbers, as the viewer reports them. */
export type MirrorStats = Record<string, string | number>;

export type MirrorStatus = MirrorState & {
  since: number;
  picture?: { w: number; h: number; codec: string };
  stats?: MirrorStats;
  /** What a person should know of this picture, as its feeder said it. */
  note?: string;
  /** When a person last touched the window. */
  touchedAt?: number;
  inputDropped: number;
  inputFailed: number;
};

/** A clock a test can run by hand. */
export type MirrorClock = {
  now(): number;
  after(ms: number, then: () => void): () => void;
};

export const realClock: MirrorClock = {
  now: Date.now,
  after: (ms, then) => {
    const t = setTimeout(then, ms);
    return () => clearTimeout(t);
  },
};

/** What a window says for a state: none when it is live. */
export function wordsOf(s: MirrorState): { title: string; fix: string } | undefined {
  switch (s.state) {
    case 'waiting':
      return NEEDS[s.need];
    case 'reconnecting':
      return { title: 'Reconnecting', fix: `try ${s.attempt}` };
    case 'connecting':
      return { title: 'Connecting', fix: '' };
    case 'stopped':
      return s.need ? NEEDS[s.need] : { title: 'Stopped', fix: s.why };
    default:
      return undefined;
  }
}
