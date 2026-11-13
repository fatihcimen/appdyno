import { must, quantile, sleep, type Measured, type SurfaceFrames } from '@appdyno/core';
import { assertPkg, shq } from '../adb.js';
import { at, sh, type PerfDevice } from './shared.js';

/** Play's two bars for a game's frame: not presented less than this long after the one before. */
const SLOW_MS = [34, 50] as const;
/** A frame still on its way is held at the largest number there is. */
const PENDING = 2 ** 62;
/** Long enough for a frame of a surface at 3 a second to come. */
const STILL_DRAWING_MS = 400;

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
  drawing: false,
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
  drawing: boolean,
): SurfaceFrames {
  const gaps = presents.slice(1).map((t, i) => (t - must(presents[i], 'a present')) / 1e6);
  return statsOfGaps(layer, periodNs, presents.length, gaps, drawing);
}

/** `surfaceStats` of the gaps between presents, in ms: those across a stretch not read are left out by the caller. */
function statsOfGaps(
  layer: string,
  periodNs: number,
  frames: number,
  gaps: number[],
  drawing: boolean,
): SurfaceFrames {
  const refreshMs = periodNs / 1e6;
  const whole = gaps.map((g) => round(Math.round(g / refreshMs) * refreshMs)).sort((a, b) => a - b);
  const slow = (bar: number) =>
    round((whole.filter((g) => g >= bar).length / Math.max(whole.length, 1)) * 100);
  const spanMs = gaps.reduce((a, b) => a + b, 0);
  const [slow34Percent, slow50Percent] = SLOW_MS.map(slow) as [number, number];
  return {
    layer,
    refreshMs: round(refreshMs),
    frames,
    fps: round((gaps.length / Math.max(spanMs, 1)) * 1000),
    p50Ms: round(quantile(whole, 0.5)),
    p95Ms: round(quantile(whole, 0.95)),
    worstMs: whole.at(-1) ?? 0,
    slow34Percent,
    slow50Percent,
    drawing,
  };
}

/**
 * The layers that may hold the app's surface: a name alone a line on API 34, on Android 16 as
 * `RequestedLayerState{ad16944 SurfaceView[...](BLAST)#111504 parentId=...`.
 */
export const surfaceLayers = (list: string, pkg: string) =>
  list
    .split('\n')
    .map((l) =>
      l
        .trim()
        .replace(/^RequestedLayerState\{/, '')
        .replace(/ parentId=.*$/, ''),
    )
    .filter((l) => /^(\w+ )?SurfaceView/.test(l) && l.includes(pkg));

/**
 * Frames of the app's `SurfaceView`, as SurfaceFlinger presented them: a game or an engine draws there, past
 * the View toolkit, and `gfxinfo` counts none of it. It keeps a surface's last 127 frames, whatever their age,
 * so a second read says whether they are still coming: a present's clock leaves out the time a phone slept
 * and `/proc/uptime` does not, 12 hours apart on one that had.
 */
export async function surfaceFrames(d: PerfDevice, pkg: string): Promise<Measured<SurfaceFrames>> {
  await d.readyToMeasure();
  assertPkg(pkg);
  const list = await sh(d, 'dumpsys SurfaceFlinger --list');
  const layers = surfaceLayers(list, pkg);
  const raws = [list];
  const latency = async (layer: string) => {
    const raw = await sh(d, `dumpsys SurfaceFlinger --latency ${shq(layer)}`);
    raws.push(raw);
    return parseLatency(raw);
  };
  let held: { layer: string; read: ReturnType<typeof parseLatency> } | undefined;
  for (const layer of layers) {
    const read = await latency(layer);
    if (read.presents.length > (held?.read.presents.length ?? 0)) held = { layer, read };
  }
  if (!held) return { value: NO_SURFACE, raw: raws.join('\n---\n'), at: at() };
  await sleep(STILL_DRAWING_MS);
  const again = await latency(held.layer);
  const drawing = again.presents.at(-1) !== held.read.presents.at(-1);
  return {
    value: surfaceStats(held.layer, held.read, drawing),
    raw: raws.join('\n---\n'),
    at: at(),
  };
}

/** How often a surface is read while frames are counted: it keeps its last 127, a second's at 120 Hz. */
const SURFACE_READ_MS = 500;

/**
 * Each frame of a `--latency` read, known by the time it was to be shown (else by when it was ready), which a later read
 * gives again as it was, with the time it was shown: SurfaceFlinger corrects that of its newest frame after a first read
 * of it, which, taken for a frame of its own, was a second frame a refresh or less after it, once in each read.
 */
export function latencyRows(text: string) {
  const [first = '', ...rows] = text.trim().split('\n');
  return {
    periodNs: Number(first.trim()),
    rows: rows.flatMap((row) => {
      const [desired = 0, shown = 0, ready = 0] = row.trim().split(/\s+/).map(Number);
      const key = desired || ready;
      return key > 0 && shown > 0 && shown < PENDING ? [{ key, shown }] : [];
    }),
  };
}

/**
 * The app's surfaces read from now until `stop`, every SURFACE_READ_MS, as each keeps only its last 127 frames: the
 * frames of the one that drew the most, those it held before left out, and no gap across a stretch a late read missed.
 * None where the app shows no surface, or none drew.
 */
export async function watchSurface(d: PerfDevice, pkg: string) {
  const layers = surfaceLayers(await sh(d, 'dumpsys SurfaceFlinger --list'), assertPkg(pkg));
  const read = (layer: string) =>
    d
      .shellAlongside(`LC_ALL=C dumpsys SurfaceFlinger --latency ${shq(layer)}`, 10_000)
      .then(latencyRows, () => undefined);
  let periodNs = 0;
  type Kept = { since: number; newest: number; shown: Map<number, number>; holes: Set<number> };
  const kept = new Map<string, Kept>();
  const take = (layer: string, r: ReturnType<typeof latencyRows> | undefined) => {
    if (!r) return;
    periodNs ||= r.periodNs;
    const k = must(kept.get(layer), 'a layer');
    const fresh = r.rows.filter((x) => x.key > k.since);
    if (!fresh.length) return;
    // a read that came late holds none of the frames the last had: the gap over what it missed is no frame's
    const after = Math.max(k.since, k.newest);
    if (!r.rows.some((x) => x.key <= after))
      k.holes.add(Math.min(...fresh.filter((x) => x.key > after).map((x) => x.key)));
    for (const x of fresh) k.shown.set(x.key, x.shown);
    k.newest = Math.max(k.newest, ...fresh.map((x) => x.key));
  };
  // what each held before is none of this
  for (const layer of layers) {
    const r = await read(layer);
    kept.set(layer, {
      since: Math.max(0, ...(r?.rows.map((x) => x.key) ?? [])),
      newest: 0,
      shown: new Map(),
      holes: new Set(),
    });
    periodNs ||= r?.periodNs ?? 0;
  }
  let on = layers.length > 0;
  const reading = (async () => {
    while (on) {
      await sleep(SURFACE_READ_MS);
      for (const layer of layers) take(layer, await read(layer));
    }
  })();
  return {
    async stop(): Promise<SurfaceFrames | undefined> {
      on = false;
      await reading;
      for (const layer of layers) take(layer, await read(layer));
      const [layer, most] = [...kept].sort((a, b) => b[1].shown.size - a[1].shown.size)[0] ?? [];
      if (!layer || !most?.shown.size || !periodNs) return undefined;
      const keys = [...most.shown.keys()].sort((a, b) => a - b);
      const gaps = keys
        .slice(1)
        .flatMap((key, i) =>
          most.holes.has(key)
            ? []
            : [
                (must(most.shown.get(key), 'a frame') -
                  must(most.shown.get(must(keys[i], 'a key')), 'a frame')) /
                  1e6,
              ],
        );
      return statsOfGaps(layer, periodNs, keys.length, gaps, true);
    },
  };
}
