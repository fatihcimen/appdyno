import { quantile, type Measured, type SurfaceFrames } from '@appdyno/core';
import { assertPkg, shq } from '../adb.js';
import { at, sh, type PerfDevice } from './shared.js';

/** Play's two bars for a game's frame: not presented less than this long after the one before. */
const SLOW_MS = [34, 50] as const;
/** A frame still on its way is held at the largest number there is. */
const PENDING = 2 ** 62;

/** `dumpsys SurfaceFlinger --latency`: the refresh period, then per frame desired, presented and ready, in ns. */
export function parseLatency(text: string) {
  const [first = '', ...rows] = text.trim().split('\n');
  const presents = rows
    .map((row) => Number(row.trim().split(/\s+/)[1]))
    .filter((t) => t > 0 && t < PENDING);
  return { periodNs: Number(first.trim()), presents };
}

const NO_SURFACE: SurfaceFrames = {
  layer: '',
  refreshMs: 0,
  frames: 0,
  fps: 0,
  p50Ms: 0,
  p95Ms: 0,
  worstMs: 0,
  slow34Percent: 0,
  slow50Percent: 0,
  lastFrameAgoMs: 0,
};

const round = (x: number) => Math.round(x * 10) / 10;

/**
 * A surface's frames, from when each was presented. A present lands on the display's refresh, so a gap is
 * read in whole refreshes: 49.9 and 50.1 ms are one gap of three at 60 Hz, and a share taken from the raw
 * numbers would fall either side of a bar by chance, and in tenths, as three of a period of 16666666 ns come
 * to just under 50. Play counts a frame not presented less than 50 ms after the last, so that gap is a slow
 * one, and at 60 Hz nothing falls between the two bars.
 */
export function surfaceStats(
  layer: string,
  { periodNs, presents }: ReturnType<typeof parseLatency>,
  nowMs: number,
): SurfaceFrames {
  const refreshMs = periodNs / 1e6;
  const gaps = presents.slice(1).map((t, i) => (t - presents[i]!) / 1e6);
  const whole = gaps.map((g) => round(Math.round(g / refreshMs) * refreshMs)).sort((a, b) => a - b);
  const slow = (bar: number) =>
    round((whole.filter((g) => g >= bar).length / Math.max(whole.length, 1)) * 100);
  const spanMs = gaps.reduce((a, b) => a + b, 0);
  const [slow34Percent, slow50Percent] = SLOW_MS.map(slow) as [number, number];
  return {
    layer,
    refreshMs: round(refreshMs),
    frames: presents.length,
    fps: round((gaps.length / Math.max(spanMs, 1)) * 1000),
    p50Ms: quantile(whole, 0.5),
    p95Ms: quantile(whole, 0.95),
    worstMs: whole.at(-1) ?? 0,
    slow34Percent,
    slow50Percent,
    // the uptime is in hundredths of a second: a frame just shown can read as yet to come
    lastFrameAgoMs: Math.max(0, Math.round(nowMs - (presents.at(-1) ?? 0) / 1e6)),
  };
}

/**
 * Frames of the app's `SurfaceView`, as SurfaceFlinger presented them: a game or an engine draws there, past
 * the View toolkit, and `gfxinfo` counts none of it. It keeps a surface's last 127 frames, whatever their age.
 */
export async function surfaceFrames(d: PerfDevice, pkg: string): Promise<Measured<SurfaceFrames>> {
  await d.readyToMeasure();
  assertPkg(pkg);
  const list = await sh(d, 'dumpsys SurfaceFlinger --list');
  const layers = list
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('SurfaceView') && l.includes(pkg));
  const raws = [list];
  let best = NO_SURFACE;
  for (const layer of layers) {
    const raw = await sh(d, `cat /proc/uptime; dumpsys SurfaceFlinger --latency ${shq(layer)}`);
    raws.push(raw);
    const [uptime = '', ...rest] = raw.trim().split('\n');
    const read = parseLatency(rest.join('\n'));
    if (read.presents.length > best.frames)
      best = surfaceStats(layer, read, Number(uptime.split(' ')[0]) * 1000);
  }
  return { value: best, raw: raws.join('\n---\n'), at: at() };
}
