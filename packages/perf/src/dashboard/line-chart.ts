import { must, round1, esc } from '@appdyno/core';
import type { Unit } from '../record.js';
import { inScale, scaleOf, when, withDigits, type Scale } from './format.js';
import { tooltip } from './marks.js';

export type LinePoint = { at: string; value: number; noisy: boolean; modelled: boolean };

export type LineChart = {
  label: string;
  unit: Unit;
  /** Oldest first, at least two. */
  points: LinePoint[];
  /** The band a value is called unchanged inside. */
  band?: { low: number; high: number };
  /** Limits a line is drawn at: only what falls near the data, or the data would flatten. */
  limits: number[];
  /** The newest point is what needs attention. */
  alert: boolean;
};

const W = 320;
const H = 156;
const X0 = 40;
const X1 = 256;
const Y0 = 18;
const Y1 = 134;
const TICKS = 3;
/** Past this many times the data's top a limit is said in words, not drawn. */
const NEAR = 2;

const niceStep = (span: number, wholeOnly: boolean) => {
  const raw = (span || 1) / TICKS;
  const size = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5].find((n) => raw <= n * size) ?? 10) * size;
  return wholeOnly ? Math.max(1, Math.round(step)) : step;
};

const tickText = (v: number, step: number, s: Scale) =>
  withDigits(v / s.per, Math.max(0, -Math.floor(Math.log10(step / s.per))));

const dayOf = (at: string) => new Date(at).toISOString().slice(0, 10);

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const shortDate = (at: string, sameDay: boolean) =>
  sameDay ? new Date(at).toISOString().slice(11, 16) : DAY.format(new Date(at));

/** One series against one y-scale: a line, the band and limits behind it, a value at its end. */
export function lineChart(c: LineChart): string {
  const values = c.points.map((p) => p.value);
  const top = Math.max(...values, c.band?.high ?? 0);
  const limits = c.limits.filter((l) => l >= 0 && l <= Math.max(top, 1) * NEAR);
  const highest = Math.max(top, ...limits);
  const lowest = Math.min(0, ...values);
  const scale = scaleOf(c.unit, highest);
  const step = niceStep(highest - lowest, c.unit === 'count');
  const low = Math.floor(lowest / step) * step;
  const high = Math.max(Math.ceil(highest / step), 1) * step;
  const y = (v: number) => round1(Y1 - ((v - low) / (high - low)) * (Y1 - Y0));
  const x = (i: number) => round1(X0 + (i / (c.points.length - 1)) * (X1 - X0));

  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, i) => {
    const v = low + i * step;
    return `<line class="grid" x1="${X0}" x2="${X1}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${X0 - 6}" y="${y(v) + 4}" text-anchor="end">${esc(tickText(v, step, scale))}</text>`;
  });
  const band = c.band
    ? `<rect class="band" x="${X0}" width="${X1 - X0}" y="${y(Math.min(c.band.high, high))}" height="${round1(y(Math.max(c.band.low, low)) - y(Math.min(c.band.high, high)))}"/>`
    : '';
  const limitLines = limits
    .map((l) => `<line class="limit" x1="${X0}" x2="${X1}" y1="${y(l)}" y2="${y(l)}"/>`)
    .join('');
  const path = c.points.map((p, i) => `${i ? 'L' : 'M'}${x(i)} ${y(p.value)}`).join('');
  const estimate = c.points.some((p) => p.modelled);
  const noisy = c.points
    .map((p, i) =>
      p.noisy ? `<circle class="noisy" cx="${x(i)}" cy="${y(p.value)}" r="3.5"/>` : '',
    )
    .join('');
  const last = c.points.length - 1;
  const lastPoint = must(c.points[last], 'a last point');
  const first = must(c.points[0], 'a first point');
  const sameDay = dayOf(first.at) === dayOf(lastPoint.at);

  // each point owns the column nearest to it, so the pointer need only be closest; these draw nothing until hovered
  const halfStep = (X1 - X0) / last / 2;
  const hovers = c.points.map((p, i) => {
    const lines = [
      inScale(p.value, scale),
      when(p.at),
      ...(p.noisy ? ['taken under noise'] : []),
      ...(p.modelled ? ['an estimate, from a model'] : []),
    ];
    return `<g class="pt${i === last ? ' newest' : ''}"><rect class="hit" x="${round1(x(i) - halfStep)}" y="${Y0}" width="${round1(halfStep * 2)}" height="${Y1 - Y0}"/><line class="cross" x1="${x(i)}" x2="${x(i)}" y1="${Y0}" y2="${Y1}"/><circle class="hot" cx="${x(i)}" cy="${y(p.value)}" r="4"/>${tooltip(x(i), Y0, lines, W)}</g>`;
  });

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(
    `${c.label}: ${c.points.length} runs, newest ${inScale(lastPoint.value, scale)}, lowest ${inScale(Math.min(...values), scale)}, highest ${inScale(Math.max(...values), scale)}`,
  )}">${band}${ticks.join('')}${limitLines}<line class="axis" x1="${X0}" x2="${X1}" y1="${y(low)}" y2="${y(low)}"/><text class="tick" x="${X0 - 6}" y="9" text-anchor="end">${esc(scale.suffix)}</text><path class="line${estimate ? ' est' : ''}" d="${path}"/>${noisy}<circle class="end${c.alert ? ' alert' : ''}" cx="${x(last)}" cy="${y(lastPoint.value)}" r="4"/><text class="endv" x="${X1 + 8}" y="${y(lastPoint.value) + 4}">${esc(inScale(lastPoint.value, scale))}</text><text class="tick" x="${X0}" y="${H - 6}">${esc(shortDate(first.at, sameDay))}</text><text class="tick" x="${X1}" y="${H - 6}" text-anchor="end">${esc(shortDate(lastPoint.at, sameDay))}</text>${hovers.join('')}</svg>`;
}
