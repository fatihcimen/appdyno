import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import {
  decodePng,
  encodePng,
  esc,
  osName,
  paintRects,
  PAGE_MARK,
  renderScreen,
  reportProgress,
  type Screen,
} from '@appdyno/core';
import type { ServerContext } from './context.js';
import { redactLog } from './policy.js';
import { reportPage as page } from './report-page.js';
import { stepsIn, type Step } from './report-state.js';
import type { Session } from './session.js';

const SHOT_PX = 720;
const MAX_LOG_LINES = 1_000;
const MAX_CRASHES = 20;

type Clean = (s: string) => string;

const pre = (s: string) => `<pre>${esc(s)}</pre>`;

/** An image of the screen, painted over where an element holds a secret or a password. */
export async function reportShot(
  ctx: ServerContext,
  s: Session,
  screen: Screen,
  dir: string,
  name: string,
) {
  const units = screen.window?.w ?? s.device.hello?.screen.w;
  const secret = (t?: string) => !!t && ctx.policy.secrets.some((x) => x && t.includes(x));
  const hiding = screen.elements.filter(
    (e) => e.rect && (e.password || [e.text, e.label, e.placeholder].some(secret)),
  );
  mkdirSync(join(dir, 'shots'), { recursive: true });
  if (hiding.length === 0) {
    const { data } = await s.device.screenshot({ format: 'jpeg', quality: 60, maxPx: SHOT_PX });
    writeFileSync(join(dir, 'shots', `${name}.jpg`), data);
    return `shots/${name}.jpg`;
  }
  const { data } = await s.device.screenshot({ format: 'png', quality: 100, maxPx: SHOT_PX });
  const img = decodePng(data);
  if (!img || !units) return undefined;
  const k = img.width / units;
  paintRects(
    img,
    hiding.map((e) => ({
      x: e.rect!.x * k,
      y: e.rect!.y * k,
      w: e.rect!.width * k,
      h: e.rect!.height * k,
    })),
  );
  writeFileSync(join(dir, 'shots', `${name}.png`), encodePng(img));
  return `shots/${name}.png`;
}

function headSection(s: Session, since: number | undefined) {
  const hello = s.device.hello;
  return [
    `<header class="bar"><h1>${PAGE_MARK}appdyno <span>report</span></h1></header>`,
    `<p class="who">${esc(s.appId ?? hello?.model ?? s.device.serial)}</p>`,
    `<p class="facts">${esc(
      [
        `${s.device.serial}${hello ? `: ${hello.model}, ${osName(s.device.platform, hello.osVersion)}` : ''}`,
        since ? `from ${new Date(since).toISOString()}` : undefined,
        `to ${new Date().toISOString()}`,
      ]
        .filter(Boolean)
        .join(' · '),
    )}</p>`,
    `<p class="note">Listed secrets and what looks like a credential are hidden in the text. Images are painted over where an element holds a secret or is a password field; text drawn with no element behind it cannot be told, and a video is not painted over.</p>`,
  ];
}

function stepsSection(steps: Step[], since: number | undefined) {
  const out = [`<h2>Steps (${steps.length})</h2>`];
  if (steps.length === 0)
    out.push(`<p class="note">${since ? 'no step ran' : 'none kept: report start keeps them'}</p>`);
  steps.forEach((st, i) => {
    const words = [
      `<h3 id="s${i + 1}"><span class="n">${i + 1}</span>${esc(st.op)} <span class="${st.ok ? 'note' : 'bad'}">${st.ok ? st.at : `failed, ${st.at}`}</span></h3>`,
      pre(JSON.stringify(st.args)),
      pre(st.answer),
      ...(st.screen
        ? [`<details><summary>the screen after it</summary>${pre(st.screen)}</details>`]
        : []),
    ].join('');
    const shot = st.shot ? `<img alt="the screen after step ${i + 1}" src="${esc(st.shot)}">` : '';
    out.push(
      `<article class="step card${st.ok ? '' : ' failed'}"><div>${words}</div>${shot}</article>`,
    );
  });
  return out;
}

async function screenNowSection(ctx: ServerContext, s: Session, dir: string, clean: Clean) {
  const screen = await s.read().catch(() => undefined);
  if (!screen) return [];
  const shot = await reportShot(ctx, s, screen, dir, 'now').catch(() => undefined);
  return [
    `<h2>The screen now</h2>`,
    ...(shot ? [`<img alt="the screen" src="${esc(shot)}">`] : []),
    pre(renderScreen(screen.list, clean)),
  ];
}

function videoSection(steps: Step[], dir: string) {
  const inFolder = join(dir, 'video');
  const videos = [
    ...new Set([
      ...steps.flatMap((st) => (st.op === 'record' ? (st.files ?? []) : [])),
      // a recording the session's end stopped was no step
      ...(existsSync(inFolder) ? readdirSync(inFolder).map((f) => join(inFolder, f)) : []),
    ]),
  ];
  if (videos.length === 0) return [];
  return [
    `<h2>Video</h2>`,
    ...videos.map((v) =>
      !relative(dir, v).startsWith('..') && existsSync(v)
        ? `<video controls src="${esc(relative(dir, v))}"></video>`
        : `<p>${esc(existsSync(v) ? v : `${v} (not there)`)}</p>`,
    ),
  ];
}

async function logSection(s: Session, since: number | undefined, clean: Clean) {
  const app = s.appId;
  if (!app) return [`<h2>Log</h2>`, `<p class="note">no app selected: no log</p>`];
  const logs = await s.device
    .logs({
      app,
      level: 'info',
      maxLines: MAX_LOG_LINES,
      ...(since !== undefined && { since }),
    })
    .catch((e: Error) => ({ lines: [] as string[], source: '', note: e.message }));
  return [
    `<h2>Log</h2>`,
    `<p class="note">${esc(`${logs.lines.length} lines${logs.source ? ` from ${logs.source}` : ''}${logs.note ? `: ${logs.note}` : ''}`)}</p>`,
    ...(logs.lines.length ? [pre(logs.lines.map(clean).join('\n'))] : []),
  ];
}

async function crashSection(s: Session, since: number | undefined, clean: Clean) {
  const app = s.appId;
  if (!app) return [`<h2>Crashes</h2>`, `<p class="note">no app selected: no crash reports</p>`];
  const c = await s.device
    .crashes({ app, limit: MAX_CRASHES, ...(since !== undefined && { since }) })
    .catch((e: Error) => ({ reports: [], source: '', note: e.message }));
  return [
    `<h2>Crashes</h2>`,
    `<p class="note">${esc(`${c.reports.length} reports${c.source ? ` from ${c.source}` : ''}${c.note ? `: ${c.note}` : ''}`)}</p>`,
    ...c.reports.map((r) => pre(clean(`${r.at} ${r.reason}${r.detail ? `\n${r.detail}` : ''}`))),
  ];
}

/** The device's measurements since `since`, as they were stored. */
function measurementsSince(ctx: ServerContext, since: number) {
  const dir = ctx.measurementsDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      try {
        return [JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>];
      } catch {
        return [];
      }
    })
    .filter((m) => Date.parse(String(m.at)) >= since)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** Writes the report in `dir`: every section says what it has, or why it has nothing. */
export async function writeReport(
  ctx: ServerContext,
  s: Session,
  dir: string,
  since: number | undefined,
) {
  const clean = (t: string) => redactLog(ctx.policy, t);
  reportProgress(`writing the report in ${dir}`);
  mkdirSync(dir, { recursive: true });
  const steps = stepsIn(dir);
  const measured = since !== undefined ? measurementsSince(ctx, since) : [];
  const out = [
    ...headSection(s, since),
    ...stepsSection(steps, since),
    ...(steps.length === 0 ? await screenNowSection(ctx, s, dir, clean) : []),
    ...videoSection(steps, dir),
    ...(await logSection(s, since, clean)),
    ...(await crashSection(s, since, clean)),
    `<h2>Measurements (${measured.length})</h2>`,
    ...measured.map((m) => pre(clean(JSON.stringify(m, null, 1)))),
  ];
  const file = join(dir, 'index.html');
  writeFileSync(file, page(`appdyno report ${basename(dir)}`, out.join('\n')));
  return { file, steps: steps.length, measurements: measured.length };
}
