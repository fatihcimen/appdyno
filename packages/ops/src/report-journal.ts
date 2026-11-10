import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { renderScreen } from '@appdyno/core';
import type { ServerContext } from './context.js';
import { redactLog } from './policy.js';
import { journalOf, openReports, type Step } from './report-state.js';
import { reportShot } from './report-write.js';
import { LOOKS_ONLY } from './step-schemas.js';
import type { Op, ToolResult } from './tool.js';

const MAX_ANSWER = 20_000;
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
    const all = shown || LOOKS_ONLY.has(String(o.action));
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x, all || NAMES.has(k))]));
  };
  return walk(args, op.annotations.readOnlyHint === true);
}

/** One call in the journal, with the screen after it when it may have changed something. */
async function note(
  ctx: ServerContext,
  op: Op,
  args: unknown,
  began: number,
  out: ToolResult | undefined,
  err: unknown,
) {
  const serial = ctx.currentSerial;
  const open = serial && openReports.read(serial);
  if (!serial || !open || NOT_STEPS.has(op.name)) return;
  const clean = (s: string) => redactLog(ctx.policy, s);
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
      const shot = await reportShot(ctx, s, screen, open.dir, String(n).padStart(4, '0')).catch(
        () => undefined,
      );
      if (shot) step.shot = shot;
    }
  }
  appendFileSync(journal, `${JSON.stringify(step)}\n`);
}

/** The op as the surfaces see it: what it answers is untouched, whatever the journal does. */
export const journaled =
  (ctx: ServerContext) =>
  (op: Op): Op => ({
    ...op,
    handler: async (args) => {
      const began = Date.now();
      try {
        const out = await op.handler(args);
        await note(ctx, op, args, began, out, undefined).catch(() => undefined);
        return out;
      } catch (e) {
        await note(ctx, op, args, began, undefined, e).catch(() => undefined);
        throw e;
      }
    },
  });
