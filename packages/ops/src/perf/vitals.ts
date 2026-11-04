import { MIN_FRAMES, type FrameHistogram } from '@appdyno/core';
import {
  FROZEN_MIN_FRAMES,
  latestRuns,
  playDay,
  playCall,
  type Metric,
  type PerfRecord,
  type RunKey,
} from '@appdyno/perf';

const percentOf = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 10_000) / 100 : 0;

const worded = (kind: string, value: number) => playCall(kind, value)?.says ?? '';

/**
 * Play's two shares of frames, from each round's histogram: slow frames round by round, as the gate takes them, and
 * frozen frames over all of them, as a share of frames that small means nothing under 1,000.
 */
export function frameVitals(rounds: FrameHistogram[]): {
  metrics: Metric[];
  lines: string[];
  shares?: { slowPercent?: number; frozenPercent?: number };
} {
  if (rounds.length === 0) return { metrics: [], lines: [] };
  const shares = rounds
    .filter((h) => h.frames >= MIN_FRAMES)
    .map((h) => percentOf(h.over16, h.frames));
  const frames = rounds.reduce((a, h) => a + h.frames, 0);
  const frozen = percentOf(
    rounds.reduce((a, h) => a + h.over700, 0),
    frames,
  );
  const whole = percentOf(
    rounds.reduce((a, h) => a + h.over16, 0),
    frames,
  );
  const enough = frames >= FROZEN_MIN_FRAMES;
  return {
    shares: {
      ...(frames >= MIN_FRAMES && { slowPercent: whole }),
      ...(enough && { frozenPercent: frozen }),
    },
    metrics: [
      { kind: 'frames.slow_percent', unit: 'percent', samples: shares },
      { kind: 'frames.frozen_percent', unit: 'percent', samples: enough ? [frozen] : [] },
    ],
    lines: [
      `Play: ${
        frames >= MIN_FRAMES
          ? worded('frames.slow_percent', whole)
          : `too few frames to say of slow frames (${frames})`
      }`,
      `Play: ${
        enough
          ? worded('frames.frozen_percent', frozen)
          : `too few frames to say of frozen frames (${frames} of the ${FROZEN_MIN_FRAMES} it takes)`
      }`,
    ],
  };
}

/** The longest of today's kept launches of this key, this run's among them: what Play records of a state's day. */
export async function dayLongest(
  dir: string,
  key: RunKey,
  run: { kind: string; value: number; at: string },
): Promise<number> {
  const day = playDay(run.at);
  const kept: PerfRecord[][] = await latestRuns(dir, key, 200).catch(() => []);
  return Math.max(
    run.value,
    ...kept.flat().flatMap((r) => (r.kind === run.kind && playDay(r.at) === day ? [r.value] : [])),
  );
}

/** A number in Play's words. */
export const playLine = (kind: string, value: number) => `Play: ${worded(kind, value)}`;
