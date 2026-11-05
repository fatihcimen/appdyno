import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import {
  safeName,
  decodePng,
  encodePng,
  esc,
  osName,
  paintRects,
  renderScreen,
  reportProgress,
  PAGE_MARK,
  stateDir,
  type Screen,
} from '@appdyno/core';
import { reportPage as page } from './report-page.js';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { checkApp, redactLog } from './policy.js';
import { journalOf, openReports, stepsIn, type Step } from './report-state.js';
import { ReportOut } from './schemas.js';
import type { Session } from './session.js';
import { startTimeline } from './timeline/run.js';
import { defineOp, DESTRUCTIVE, reply, ToolError, type Op, type ToolResult } from './tool.js';

const SHOT_PX = 720;
const MAX_ANSWER = 20_000;
const MAX_LOG_LINES = 1_000;
const MAX_CRASHES = 20;
/** Calls that say nothing about the app. */
export const NOT_STEPS = new Set(['report', 'list_devices', 'simulator', 'mirror', 'hand_off']);

/** What an argument under these names holds names something; a selector's text is what is on the screen. */
const NAMES = new Set([
  'action',
  'answer',
  'app',
  'compile',
  'contains',
  'device',
  'dir',
  'direction',
  'file',
  'har',
  'key',
  'kind',
  'metro',
  'mode',
  'name',
  'orientation',
  'page',
  'path',
  'proxy',
  'read',
  'ref',
  'scenario',
  'scroll',
  'selector',
  'service',
  'target',
  'url',
  'via',
  'what',
]);

/** In `steps`: these only look, so their text is what they look for. */
const LOOKING = new Set(['wait_for', 'assert']);

/**
 * Any other string that goes into a device may be a password, so it is shown by its length: an op written later
 * cannot leave what it was given here. An op that only reads is given what is on the screen.
 */
export function shownArgs(op: Op, args: unknown, clean: (s: string) => string): unknown {
  const walk = (v: unknown, shown: boolean): unknown => {
    if (typeof v === 'string') return shown ? clean(v) : `(${Array.from(v).length} characters)`;
    if (Array.isArray(v)) return v.map((x) => walk(x, shown));
    if (!v || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    const all = shown || LOOKING.has(String(o.action));
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x, all || NAMES.has(k))]));
  };
  return walk(args, op.annotations.readOnlyHint === true);
}

const pre = (s: string) => `<pre>${esc(s)}</pre>`;

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
  const note = async (
    op: Op,
    args: unknown,
    began: number,
    out: ToolResult | undefined,
    err: unknown,
  ) => {
    const serial = ctx.currentSerial;
    const open = serial && openReports.read(serial);
    if (!serial || !open || NOT_STEPS.has(op.name)) return;
    const answer = out
      ? out.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
      : (err as Error).message;
    const journal = journalOf(open.dir);
    const n = existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').length : 1;
    const step: Step = {
      began,
      at: new Date().toISOString(),
      op: op.name,
      args: shownArgs(op, args, clean),
      ok: !err,
      answer: clean(answer).slice(0, MAX_ANSWER),
      ...(Array.isArray(out?.data.files) && { files: out.data.files as string[] }),
    };
    const s = await ctx.session();
    // a timeline's video has every screen, and a read and a picture after each step would be in its frames
    if (!op.annotations.readOnlyHint && !s.timeline) {
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
      const began = Date.now();
      let out: ToolResult | undefined;
      let err: unknown;
      try {
        out = await op.handler(args);
      } catch (e) {
        err = e;
      }
      await note(op, args, began, out, err).catch(() => undefined);
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
    const steps = stepsIn(dir);
    const hello = s.device.hello;
    const app = s.appId;
    const out: string[] = [
      `<header class="bar"><h1>${PAGE_MARK}appdyno <span>report</span></h1></header>`,
      `<p class="who">${esc(app ?? hello?.model ?? s.device.serial)}</p>`,
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

    out.push(`<h2>Steps (${steps.length})</h2>`);
    if (steps.length === 0)
      out.push(
        `<p class="note">${since ? 'no step ran' : 'none kept: report start keeps them'}</p>`,
      );
    steps.forEach((st, i) => {
      const words = [
        `<h3 id="s${i + 1}"><span class="n">${i + 1}</span>${esc(st.op)} <span class="${st.ok ? 'note' : 'bad'}">${st.ok ? st.at : `failed, ${st.at}`}</span></h3>`,
        pre(JSON.stringify(st.args)),
        pre(st.answer),
        ...(st.screen
          ? [`<details><summary>the screen after it</summary>${pre(st.screen)}</details>`]
          : []),
      ].join('');
      const shot = st.shot
        ? `<img alt="the screen after step ${i + 1}" src="${esc(st.shot)}">`
        : '';
      out.push(
        `<article class="step card${st.ok ? '' : ' failed'}"><div>${words}</div>${shot}</article>`,
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
    const open = openReports.read(s.device.serial);
    if (!open) return undefined;
    await s.timeline?.finish();
    const r = await write(s, open.dir, open.since);
    openReports.remove(s.device.serial);
    return r;
  };

  /** Sources run in this process, so one that ends with the command has no timeline to give. */
  const timelineApp = (s: Session) => {
    if (!s.owner)
      throw new ToolError(
        'a timeline runs in a process that stays, and a command ends here: `appdyno timeline`',
        'UNSUPPORTED',
      );
    const app = checkApp(ctx.policy, s.appId ?? '');
    if (!app) throw new ToolError('select an app with use_device first', 'INVALID_ARGUMENT');
    return app;
  };

  const ops = () => [
    defineOp({
      name: 'report',
      title: 'Session report',
      description:
        "index.html: steps, video, logs, crashes, measurements; secrets hidden. start (dir), until stop or the session's end; write: now. timeline: one page on one clock.",
      input: z
        .object({
          action: z.enum(['start', 'timeline', 'write', 'stop']),
          dir: z.string().max(1_000).optional(),
        })
        .strict(),
      output: ReportOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, dir }) => {
        const s = await ctx.session();
        const serial = s.device.serial;
        const open = openReports.read(serial);
        const named = () =>
          resolve(
            dir ??
              join(
                stateDir(),
                'reports',
                `${safeName(serial)}-${new Date().toISOString().replace(/\W/g, '')}`,
              ),
          );
        if (action === 'start' || action === 'timeline') {
          if (open)
            throw new ToolError(
              `a report is open on ${serial} since ${new Date(open.since).toISOString()}: stop it first`,
              'INVALID_ARGUMENT',
            );
          const app = action === 'timeline' ? timelineApp(s) : undefined;
          const to = named();
          mkdirSync(to, { recursive: true });
          openReports.write(serial, { dir: to, since: Date.now(), owner: s.owner });
          const t = app
            ? await startTimeline(ctx, s, app, to).catch((e: unknown) => {
                openReports.remove(serial);
                throw e;
              })
            : `keeping steps for a report in ${to}`;
          return reply(t, { done: t, dir: to });
        }
        if (action === 'stop' && !open)
          throw new ToolError(`no report is open on ${serial}`, 'NOT_FOUND');
        const timeline = action === 'stop' ? await s.timeline?.finish() : undefined;
        const r = await write(s, open?.dir ?? named(), open?.since);
        if (action === 'stop') openReports.remove(serial);
        const t = [
          `report: ${r.file} (${r.steps} steps, ${r.measurements} measurements)`,
          ...(timeline ? [timeline.text] : []),
        ].join('\n');
        return reply(t, {
          done: t,
          dir: dirOf(r.file),
          file: r.file,
          steps: r.steps,
          ...(timeline && { timeline: timeline.file, timelineBytes: timeline.bytes }),
        });
      },
    }),
  ];

  return { wrap, close, ops };
}

const dirOf = (file: string) => file.slice(0, -'/index.html'.length);
