import { esc } from '@appdyno/core';
import { chip } from '../dashboard/marks.js';
import type { Span, Timeline, TimelineRow } from './model.js';

/** A plot's own units: it stretches to the page, and what is drawn in it does not care how wide that is. */
const WIDTH = 1000;
const HEIGHT = 44;
/** A frame this long reaches the top of its lane: above it a frame is a frame that stopped the screen. */
const TALLEST_FRAME_MS = 100;
const MIN_MARK = 1.5;

const tenth = (n: number) => Math.round(n * 10) / 10;

type Plot = { x: (at: number) => number; w: (ms: number) => number };

const plotOf = (t: Timeline): Plot => {
  const k = WIDTH / Math.max(t.to - t.from, 1);
  return { x: (at) => tenth((at - t.from) * k), w: (ms) => Math.max(tenth(ms * k), MIN_MARK) };
};

const svg = (label: string, body: string) =>
  `<svg class="plot" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${body}</svg>`;

const span = (p: Plot, m: Span, cls: string, y = 8, h = HEIGHT - 16, title?: string) =>
  `<rect class="${cls}" x="${p.x(m.at)}" y="${y}" width="${p.w(m.ms)}" height="${h}">${title ? `<title>${esc(title)}</title>` : ''}</rect>`;

/** A polyline of a row of readings. */
const line = <T extends { at: number }>(
  p: Plot,
  marks: T[],
  value: (m: T) => number,
  cls: string,
) => {
  const top = Math.max(...marks.map(value), 1);
  const points = marks.map(
    (m) => `${p.x(m.at)},${tenth(HEIGHT - 4 - (value(m) / top) * (HEIGHT - 8))}`,
  );
  return `<polyline class="${cls}" points="${points.join(' ')}"/>`;
};

/** Thousands of frames as one path, and the late ones on their own, so that a long run stays a small file. */
function frames(t: Timeline, p: Plot) {
  const height = (ms: number) => tenth(Math.min(ms / TALLEST_FRAME_MS, 1) * (HEIGHT - 4));
  const onTime = t.frames.marks.filter((f) => !f.late);
  const path = onTime.map((f) => `M${p.x(f.at)} ${HEIGHT}v-${height(f.ms)}`).join('');
  const late = t.frames.marks
    .filter((f) => f.late)
    .map((f) => {
      const h = Math.max(height(f.ms), 6);
      return span(p, f, 'late', HEIGHT - h, h, `${f.ms} ms, late`);
    });
  return `<path class="frame" d="${path}"/>${late.join('')}`;
}

/** A lane: its name, and the plot or why it has none. */
function lane<T>(name: string, row: TimelineRow<T>, plot: () => string, info?: string) {
  const body = row.absent
    ? `<div class="absent">${chip('no', row.absent)}</div>`
    : row.marks.length === 0
      ? `<div class="absent">${chip('no', row.note ?? 'nothing in this stretch')}</div>`
      : svg(name, plot());
  const note = !row.absent && row.marks.length > 0 && row.note ? ` title="${esc(row.note)}"` : '';
  return `<div class="lane"${note}><div class="name">${esc(name)}${info ? `<span class="m">${esc(info)}</span>` : ''}</div><div class="track">${body}</div></div>`;
}

/** Every row of the page, on one scale. Click anywhere on a plot to go to that moment. */
export function lanes(t: Timeline) {
  const p = plotOf(t);
  const log = t.logs.marks;
  const spoken = log.flatMap(({ at, level }) => (level ? [{ at, level }] : []));
  return [
    lane('Touches', t.touches, () => t.touches.marks.map((m) => span(p, m, 'touch')).join('')),
    lane('Steps', t.steps, () =>
      t.steps.marks.map((m) => span(p, m, m.ok ? 'step' : 'late', 8, HEIGHT - 16, m.name)).join(''),
    ),
    lane('Frames', t.frames, () => frames(t, p), 'height: its length, to 100 ms'),
    lane('Stalls', t.stalls, () => t.stalls.marks.map((m) => span(p, m, 'late')).join('')),
    lane('Requests', t.network, () =>
      t.network.marks
        .map((r, i) =>
          span(
            p,
            { at: r.at, ms: r.ms ?? 0 },
            r.failed ? 'late' : 'step',
            4 + (i % 4) * 9,
            7,
            r.name,
          ),
        )
        .join(''),
    ),
    lane(
      'Traffic',
      t.traffic,
      () => line(p, t.traffic.marks, (m) => m.inKbps + m.outKbps, 'line'),
      'in and out',
    ),
    lane('Log', t.logs, () =>
      [
        ...log
          .filter((l) => !l.level)
          .map((l) => span(p, { at: l.at, ms: 0 }, 'tick', 12, HEIGHT - 24)),
        ...spoken.map((l) => span(p, { at: l.at, ms: 0 }, l.level, 4, HEIGHT - 8)),
      ].join(''),
    ),
    lane('Memory', t.memory, () => line(p, t.memory.marks, (m) => m.mb, 'line')),
  ].join('');
}
