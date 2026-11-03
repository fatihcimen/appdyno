import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import {
  decodePng,
  encodePng,
  esc,
  paintRects,
  renderScreen,
  reportProgress,
  selfContainedPage,
  stateDir,
  type Screen,
} from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { redactLog } from './policy.js';
import { ReportOut } from './schemas.js';
import type { Session } from './session.js';
import { defineOp, DESTRUCTIVE, reply, ToolError, type Op, type ToolResult } from './tool.js';

const SHOT_PX = 720;
const MAX_ANSWER = 20_000;
const MAX_LOG_LINES = 1_000;
const MAX_CRASHES = 20;
/** Calls that say nothing about the app. */
const NOT_STEPS = new Set(['report', 'list_devices', 'simulator']);

type Open = { dir: string; since: number };
type Step = {
  at: string;
  op: string;
  args: unknown;
  ok: boolean;
  answer: string;
  screen?: string;
  shot?: string;
  /** Videos this call made. */
  files?: string[];
};

const openFile = (serial: string) =>
  join(stateDir(), 'reports', `${serial.replace(/[^\w.-]/g, '_')}.json`);

const opened = (serial: string): Open | undefined => {
  try {
    return JSON.parse(readFileSync(openFile(serial), 'utf8')) as Open;
  } catch {
    return undefined;
  }
};

/** The open report's folder for videos, so that a report is one folder. */
export const reportVideoDir = (serial: string) => {
  const o = opened(serial);
  return o && join(o.dir, 'video');
};

const journalOf = (dir: string) => join(dir, 'steps.jsonl');

/** Typed text says what was typed into a password field as well: its length is enough here. */
function shownArgs(op: string, args: unknown, clean: (s: string) => string): unknown {
  const walk = (v: unknown, typed: boolean): unknown => {
    if (typeof v === 'string') return clean(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, typed));
    if (!v || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    const isTyped = typed || o.action === 'type_text' || o.action === 'type';
    return Object.fromEntries(
      Object.entries(o).map(([k, x]) => [
        k,
        isTyped && k === 'text' && typeof x === 'string'
          ? `(${Array.from(x).length} characters)`
          : walk(x, false),
      ]),
    );
  };
  return walk(args, op === 'type_text' || op === 'clipboard');
}

const pre = (s: string) => `<pre>${esc(s)}</pre>`;

const STYLE = `body{font:14px -apple-system,system-ui,sans-serif;margin:2rem auto;max-width:60rem;padding:0 1rem;color:#222}
h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem;border-bottom:1px solid #ccc}h3{font-size:.95rem;margin:1.2rem 0 .3rem}
pre{background:#f5f5f5;padding:.5rem;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px}
img,video{max-height:30rem;max-width:100%;border:1px solid #ccc;display:block;margin:.3rem 0}
.bad{color:#b00020}.note{color:#666}`;

const page = (title: string, body: string) =>
  selfContainedPage({
    title,
    body,
    style: STYLE,
    sources: "img-src 'self' file:; media-src 'self' file:; ",
  });

export function reportFor(ctx: ServerContext) {
  const clean = (s: string) => redactLog(ctx.policy, s);

  /** An image of the screen, painted over where an element holds a secret or a password. */
  const shoot = async (s: Session, screen: Screen, dir: string, name: string) => {
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
  };

  /** One call in the journal, with the screen after it when it may have changed something. */
  const note = async (op: Op, args: unknown, out: ToolResult | undefined, err: unknown) => {
    const serial = ctx.currentSerial;
    const open = serial && opened(serial);
    if (!serial || !open || NOT_STEPS.has(op.name)) return;
    const answer = out
      ? out.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      : (err as Error).message;
    const journal = journalOf(open.dir);
    const n = existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').length : 1;
    const step: Step = {
      at: new Date().toISOString(),
      op: op.name,
      args: shownArgs(op.name, args, clean),
      ok: !err,
      answer: clean(answer).slice(0, MAX_ANSWER),
      ...(Array.isArray(out?.data.files) && { files: out.data.files as string[] }),
    };
    if (!op.annotations.readOnlyHint) {
      const s = await ctx.session();
      const screen = await s.read().catch(() => undefined);
      if (screen) {
        step.screen = renderScreen(screen.list, clean);
        const shot = await shoot(s, screen, open.dir, String(n).padStart(4, '0')).catch(
          () => undefined,
        );
        if (shot) step.shot = shot;
      }
    }
    appendFileSync(journal, `${JSON.stringify(step)}\n`);
  };

  /** The op as the surfaces see it: what it answers is untouched, whatever the journal does. */
  const wrap = (op: Op): Op => ({
    ...op,
    handler: async (args) => {
      let out: ToolResult | undefined;
      let err: unknown;
      try {
        out = await op.handler(args);
      } catch (e) {
        err = e;
      }
      await note(op, args, out, err).catch(() => undefined);
      if (err !== undefined) throw err;
      return out!;
    },
  });

  /** The device's measurements since `since`, as they were stored. */
  const measurements = (since: number) => {
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
  };

  /** Writes the report in `dir`: every section says what it has, or why it has nothing. */
  const write = async (s: Session, dir: string, since: number | undefined) => {
    reportProgress(`writing the report in ${dir}`);
    mkdirSync(dir, { recursive: true });
    const journal = journalOf(dir);
    const steps = existsSync(journal)
      ? readFileSync(journal, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Step)
      : [];
    const hello = s.device.hello;
    const app = s.appId;
    const out: string[] = [
      '<h1>appdyno report</h1>',
      `<p>${esc(
        [
          `${s.device.serial}${hello ? `: ${hello.model}, ${s.device.platform} ${hello.osVersion}` : ''}`,
          app ? `app ${app}` : 'no app selected',
          since ? `from ${new Date(since).toISOString()}` : undefined,
          `to ${new Date().toISOString()}`,
        ]
          .filter(Boolean)
          .join(' · '),
      )}</p>`,
      `<p class="note">Listed secrets and what looks like a credential are hidden in the text. Images are painted over where an element holds a secret or is a password field; text drawn with no element behind it cannot be told, and a video is not painted over.</p>`,
    ];

    out.push(`<h2>Steps (${steps.length})</h2>`);
    if (steps.length === 0)
      out.push(
        `<p class="note">${since ? 'no step ran' : 'none kept: report start keeps them'}</p>`,
      );
    steps.forEach((st, i) => {
      out.push(
        `<h3 id="s${i + 1}">${i + 1}. ${esc(st.op)} <span class="${st.ok ? 'note' : 'bad'}">${st.ok ? st.at : `failed, ${st.at}`}</span></h3>`,
        pre(JSON.stringify(st.args)),
        pre(st.answer),
        ...(st.shot ? [`<img alt="the screen after step ${i + 1}" src="${esc(st.shot)}">`] : []),
        ...(st.screen
          ? [`<details><summary>the screen after it</summary>${pre(st.screen)}</details>`]
          : []),
      );
    });

    if (steps.length === 0) {
      const screen = await s.read().catch(() => undefined);
      if (screen) {
        const shot = await shoot(s, screen, dir, 'now').catch(() => undefined);
        out.push(
          `<h2>The screen now</h2>`,
          ...(shot ? [`<img alt="the screen" src="${esc(shot)}">`] : []),
          pre(renderScreen(screen.list, clean)),
        );
      }
    }

    const inFolder = join(dir, 'video');
    const videos = [
      ...new Set([
        ...steps.flatMap((st) => (st.op === 'record' ? (st.files ?? []) : [])),
        // a recording the session's end stopped was no step
        ...(existsSync(inFolder) ? readdirSync(inFolder).map((f) => join(inFolder, f)) : []),
      ]),
    ];
    if (videos.length > 0) {
      out.push(`<h2>Video</h2>`);
      for (const v of videos) {
        const inside = !relative(dir, v).startsWith('..');
        out.push(
          inside && existsSync(v)
            ? `<video controls src="${esc(relative(dir, v))}"></video>`
            : `<p>${esc(existsSync(v) ? v : `${v} (not there)`)}</p>`,
        );
      }
    }

    out.push(`<h2>Log</h2>`);
    if (!app) out.push(`<p class="note">no app selected: no log</p>`);
    else if (!s.device.logs) out.push(`<p class="note">this device gives no app log</p>`);
    else {
      const logs = await s.device
        .logs({
          app,
          level: 'info',
          maxLines: MAX_LOG_LINES,
          ...(since !== undefined && { since }),
        })
        .catch((e: Error) => ({ lines: [] as string[], source: '', note: e.message }));
      out.push(
        `<p class="note">${esc(`${logs.lines.length} lines${logs.source ? ` from ${logs.source}` : ''}${logs.note ? `: ${logs.note}` : ''}`)}</p>`,
        ...(logs.lines.length ? [pre(logs.lines.map(clean).join('\n'))] : []),
      );
    }

    out.push(`<h2>Crashes</h2>`);
    if (!app) out.push(`<p class="note">no app selected: no crash reports</p>`);
    else if (!s.device.crashes) out.push(`<p class="note">this device gives no crash reports</p>`);
    else {
      const c = await s.device
        .crashes({ app, limit: MAX_CRASHES, ...(since !== undefined && { since }) })
        .catch((e: Error) => ({ reports: [], source: '', note: e.message }));
      out.push(
        `<p class="note">${esc(`${c.reports.length} reports${c.source ? ` from ${c.source}` : ''}${c.note ? `: ${c.note}` : ''}`)}</p>`,
        ...c.reports.map((r) =>
          pre(clean(`${r.at} ${r.reason}${r.detail ? `\n${r.detail}` : ''}`)),
        ),
      );
    }

    const measured = since !== undefined ? measurements(since) : [];
    out.push(`<h2>Measurements (${measured.length})</h2>`);
    out.push(...measured.map((m) => pre(clean(JSON.stringify(m, null, 1)))));

    const file = join(dir, 'index.html');
    writeFileSync(file, page(`appdyno report ${basename(dir)}`, out.join('\n')));
    return { file, steps: steps.length, measurements: measured.length };
  };

  /** A session is over: its open report is written. */
  const close = async (s: Session) => {
    const open = opened(s.device.serial);
    if (!open) return undefined;
    const r = await write(s, open.dir, open.since);
    rmSync(openFile(s.device.serial), { force: true });
    return r;
  };

  const ops = (): Op[] => [
    defineOp({
      name: 'report',
      title: 'Session report',
      description:
        "A folder with index.html: steps, the screen and an image after each, video, logs, crashes, measurements; secrets hidden, nothing from the network. action: start (dir) keeps steps until stop or the session's end; write writes it now; stop.",
      input: z
        .object({
          action: z.enum(['start', 'write', 'stop']),
          dir: z.string().max(1_000).optional(),
        })
        .strict(),
      output: ReportOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, dir }) => {
        const s = await ctx.session();
        const serial = s.device.serial;
        const open = opened(serial);
        const named = () =>
          resolve(
            dir ??
              join(
                stateDir(),
                'reports',
                `${serial.replace(/[^\w.-]/g, '_')}-${new Date().toISOString().replace(/\W/g, '')}`,
              ),
          );
        if (action === 'start') {
          if (open)
            throw new ToolError(
              `a report is open on ${serial} since ${new Date(open.since).toISOString()}: stop it first`,
            );
          const to = named();
          mkdirSync(to, { recursive: true });
          mkdirSync(join(stateDir(), 'reports'), { recursive: true, mode: 0o700 });
          writeFileSync(openFile(serial), JSON.stringify({ dir: to, since: Date.now() }), {
            mode: 0o600,
          });
          const t = `keeping steps for a report in ${to}`;
          return reply(t, { done: t, dir: to });
        }
        if (action === 'stop' && !open)
          throw new ToolError(`no report is open on ${serial}`, 'NOT_FOUND');
        const r = await write(s, open?.dir ?? named(), open?.since);
        if (action === 'stop') rmSync(openFile(serial), { force: true });
        const t = `report: ${r.file} (${r.steps} steps, ${r.measurements} measurements)`;
        return reply(t, { done: t, dir: dirOf(r.file), file: r.file, steps: r.steps });
      },
    }),
  ];

  return { wrap, close, ops };
}

const dirOf = (file: string) => file.slice(0, -'/index.html'.length);
