import { createHash } from 'node:crypto';
import { esc, selfContainedPage } from '@appdyno/core';
import { formatValue, when, withDigits } from '../dashboard/format.js';
import { chip, ICONS } from '../dashboard/marks.js';
import { STYLE } from '../dashboard/style.js';
import { lanes } from './lanes.js';
import { SLOW_FRAME_MS, type Span, type StallSpan, type Timeline } from './model.js';
import { SCRIPT } from './script.js';

/** How many of the slowest moments are listed: past these a list says nothing a plot does not. */
const SHOWN_SLOW = 40;

const OWN_STYLE = `.top{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:.75rem;align-items:start}
.screen{position:sticky;top:.5rem}.screen video{display:block;width:100%;max-height:calc(100vh - 5rem);background:#000;border-radius:4px}
.side{display:grid;gap:.75rem;min-width:0}.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 1rem}
.now h3{margin:.5rem 0 .15rem;font-size:.85rem}.now ul{list-style:none;margin:0;padding:0;font-size:.8rem;overflow-wrap:anywhere}.now li{padding:.1rem 0}
.now .late,.now .error{color:var(--critical)}.now .warn{color:var(--ink2)}
.count.at{font-size:1.4rem}
#plots{position:relative;cursor:crosshair;margin-left:7.5rem}
.lane{display:flex;align-items:stretch;border-top:1px solid var(--grid);min-height:2.75rem;margin-left:-7.5rem}
.lane .name{flex:none;width:7.5rem;padding:.3rem .5rem .3rem 0;font-size:.8rem;font-weight:600}.lane .name .m{display:block;font-weight:400}
.track{flex:1;min-width:0;position:relative}.plot{display:block;width:100%;height:2.75rem}.absent{padding:.45rem 0;font-size:.8rem}
#cursor{position:absolute;top:0;bottom:0;width:0;border-left:1px solid var(--ink);pointer-events:none}
#scrub{width:100%;margin:.4rem 0 0}
.frame{stroke:var(--series);fill:none;vector-effect:non-scaling-stroke}.late{fill:var(--critical)}.touch,.step{fill:var(--series)}.tick{fill:var(--axis)}.warn{fill:var(--warning)}.error{fill:var(--critical)}
.slow button{all:unset;cursor:pointer;display:block;width:100%}.slow button:hover,.slow button:focus-visible{text-decoration:underline}
.holds{margin:.25rem 0 0;padding-left:1.1rem;font-size:.85rem}
@media screen and (max-width:720px){.top{grid-template-columns:minmax(0,1fr)}}`;

const hashOf = (text: string) => createHash('sha256').update(text).digest('base64');

/** Data inside a script tag ends at the first `</script>` of any text in it: no `<` may stand in it as itself. */
export const inert = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

const size = (bytes: number) => formatValue(bytes, 'bytes');
const ms = (n: number) => `${withDigits(n, n >= 10 ? 0 : 1)} ms`;
const sinceStart = (t: Timeline, at: number) => `+${withDigits((at - t.from) / 1_000, 3)} s`;

/** The slowest moments, longest first: what a person came to look at. */
function slowest(t: Timeline) {
  const frames = t.frames.marks.filter((f) => f.late || f.ms >= SLOW_FRAME_MS);
  const moments: (Span & { what: string })[] = [
    ...frames.map((f) => ({ ...f, what: f.late ? 'late frame' : 'slow frame' })),
    ...t.stalls.marks.map((s: StallSpan) => ({ ...s, what: `main thread stopped (${s.how})` })),
  ];
  return moments.sort((a, b) => b.ms - a.ms).slice(0, SHOWN_SLOW);
}

const tile = (value: string, label: string) =>
  `<div class="tile"><div class="count">${esc(value)}</div><div class="cap">${esc(label)}</div></div>`;

function tiles(t: Timeline) {
  const f = t.frames.marks;
  const worst = f.length ? Math.max(...f.map((x) => x.ms)) : undefined;
  return `<div class="tiles">${[
    tile(`${withDigits((t.to - t.from) / 1_000, 1)} s`, 'in all'),
    ...(f.length ? [tile(withDigits(f.length, 0), 'frames')] : []),
    ...(worst !== undefined ? [tile(ms(worst), 'longest frame')] : []),
    ...(t.stalls.marks.length
      ? [tile(String(t.stalls.marks.length), 'stalls no frame shows')]
      : []),
    ...(t.network.marks.length ? [tile(String(t.network.marks.length), 'requests')] : []),
    ...(t.logs.marks.length ? [tile(String(t.logs.marks.length), 'log lines')] : []),
  ].join('')}</div>`;
}

function slowList(t: Timeline) {
  const rows = slowest(t);
  if (rows.length === 0) return `<p class="note">No slow frame in this stretch.</p>`;
  const row = (m: Span & { what: string }) =>
    `<tr><td><button data-t="${m.at}">${esc(sinceStart(t, m.at))}</button></td><td><button data-t="${m.at}">${esc(ms(m.ms))}</button></td><td>${esc(m.what)}</td></tr>`;
  return `<table class="data slow"><thead><tr><th>When</th><th>How long</th><th>What</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`;
}

/** The clock in words and figures: two rows can be apart by at most the sum of their own figures. */
function clockSection(t: Timeline) {
  const c = t.clock;
  const rows = c.sources.map(
    (s) =>
      `<tr><td>${esc(s.row)}</td><td>${esc(s.readOn)}</td><td>${esc(s.by)}</td><td>${esc(`±${ms(s.withinMs)}`)}</td></tr>`,
  );
  return `<h3>One clock</h3><p class="note">Everything here stands on the device's clock. It read ${esc(ms(Math.abs(c.offsetMs)))} ${c.offsetMs < 0 ? 'behind' : 'ahead of'} this Mac, to within ±${esc(ms(c.boundMs))}, and moved ${esc(ms(Math.abs(c.driftMs)))} between the first reading and the last. Two rows can be apart by at most the sum of their figures below.</p>
<table class="data"><thead><tr><th>Row</th><th>Read on</th><th>Placed by</th><th>Within</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

/** What is in the file, said before anything else: it gets sent to people. */
function holds(t: Timeline) {
  const items = [
    ...(t.video ? [`the screen, as a video of ${size(t.video.bytes)}, not painted over`] : []),
    ...(t.logs.marks.length
      ? [
          `${t.logs.marks.length} of the app's log lines, with listed secrets and what looks like a credential hidden`,
        ]
      : []),
    ...(t.network.marks.length
      ? [`${t.network.marks.length} requests: ${t.network.note ?? 'their names and timings'}`]
      : []),
    ...(t.steps.marks.length ? [`${t.steps.marks.length} steps, by name`] : []),
  ];
  return `<details class="note"><summary>What this file holds: read it before you send it</summary><ul class="holds">${items
    .map((i) => `<li>${esc(i)}</li>`)
    .join('')}</ul></details>`;
}

const SAYS_OF_VIDEO = (t: Timeline) =>
  t.video
    ? `${size(t.video.bytes)}, ${t.video.width}×${t.video.height}, ${t.video.codec}`
    : (t.noVideo ?? 'no video');

function screen(t: Timeline, src: string | undefined) {
  const player = t.video
    ? `<video controls muted playsinline${src ? ` src="${esc(src)}"` : ''}></video>`
    : chip('no', t.noVideo ?? 'no video');
  return `<div class="card screen">${player}<p class="cap">${esc(SAYS_OF_VIDEO(t))}</p></div>`;
}

const NOW = `<div class="card now"><div class="count at" id="now"></div><div class="cols">
<div><h3>On the screen</h3><ul id="now-screen"></ul></div>
<div><h3>Requests</h3><ul id="now-requests"></ul></div>
<div><h3>Log</h3><ul id="now-logs"></ul></div></div></div>`;

/** The whole page. `bytes`: the video inside it; `beside`: its name next to the page, for one too large to carry. */
export function renderTimeline(t: Timeline, video: { bytes?: Buffer; beside?: string } = {}) {
  const worst = slowest(t)[0];
  const span = t.to - t.from;
  const body = `${ICONS}<main>
<header class="head"><h1>${esc(t.title)}</h1><span class="m">${esc(when(new Date(t.from).toISOString()))}</span></header>
${t.reason ? `<p>${chip('warning', t.reason)}</p>` : ''}${holds(t)}${tiles(t)}
<div class="top">${screen(t, video.beside)}<div class="side">
<section class="card"><h2>Timeline</h2><div id="plots">${lanes(t)}<div id="cursor"></div></div>
<input id="scrub" type="range" min="0" max="${span}" step="10" data-first="${worst?.at ?? t.from}" aria-label="Moment in this stretch"></section>
${NOW}
<section class="card"><h2>Slowest moments</h2><p class="note">Click one: the video goes there.</p>${slowList(t)}${clockSection(t)}</section>
</div></div>
</main>
<script type="application/json" id="timeline">${inert(t)}</script>
${video.bytes ? `<script type="text/plain" id="video-bytes">${video.bytes.toString('base64')}</script>` : ''}
<script>${SCRIPT}</script>`;
  return selfContainedPage({
    title: t.title,
    style: `${STYLE}\n${OWN_STYLE}`,
    // by its hash: only this script runs, whatever a log line holds
    sources: `script-src 'sha256-${hashOf(SCRIPT)}'; media-src blob: 'self' file:; `,
    body,
  });
}
