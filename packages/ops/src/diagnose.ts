import { must } from '@appdyno/core';
import { AUDIT_TYPES } from '@appdyno/protocol';
import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { checkApp, noApp, redactLog } from './policy.js';
import { AuditOut, CrashesOut, LogsOut } from './schemas.js';
import type { Session } from './session.js';
import { defineOp, READ, reply, ToolError } from './tool.js';

const MAX_LINES = 1_000;
const DEFAULT_LINES = 200;
/** What an answer may hold of a log, however long its lines. */
const MAX_LOG_CHARS = 20_000;
const MAX_ISSUES = 50;
const App = z.string().max(200).optional().describe('default: the selected app');
const Since = z.string().max(40).optional().describe('ISO time; default: since the last action');

function appOf(s: Session, ctx: ServerContext, app?: string) {
  const pkg = checkApp(ctx.policy, app ?? s.appId ?? '');
  if (!pkg) throw noApp();
  return pkg;
}

/** A unit of a time given as how long ago, as `5m`, in ms. */
const AGO: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 };

function sinceOf(given: string | undefined, s: Session) {
  if (!given) return s.lastActionAt;
  const [, n, unit = ''] = /^(\d+)([smh])$/.exec(given) ?? [];
  if (n) return Date.now() - Number(n) * must(AGO[unit], 'a unit');
  const t = Date.parse(given);
  if (Number.isNaN(t))
    throw new ToolError(
      `not a time: ${given} (give ISO 8601, or how long ago as 30s, 5m or 2h)`,
      'INVALID_ARGUMENT',
    );
  return t;
}

/** The newest lines that fit: a log is read from its end. */
export function boundLines(lines: string[], maxLines: number, maxChars = MAX_LOG_CHARS) {
  const kept: string[] = [];
  let chars = 0;
  for (const whole of lines.toReversed()) {
    if (kept.length >= maxLines) break;
    const line = whole.slice(0, 2_000);
    if (chars + line.length + 1 > maxChars) break;
    chars += line.length + 1;
    kept.unshift(line);
  }
  return { kept, dropped: lines.length - kept.length };
}

export function diagnoseOps(ctx: ServerContext, { clean }: Answers) {
  return [
    defineOp({
      name: 'audit',
      title: 'Accessibility audit',
      description:
        'Accessibility issues of the current screen: contrast, touch targets, labels, reading order.',
      input: z
        .object({
          types: z.array(z.enum(AUDIT_TYPES)).max(AUDIT_TYPES.length).optional(),
          maxIssues: z.number().int().min(1).max(MAX_ISSUES).default(MAX_ISSUES),
        })
        .strict(),
      output: AuditOut,
      annotations: READ,
      run: async ({ types, maxIssues }) => {
        const s = await ctx.session();
        const r = await s.device.audit({ ...(types && { types }), maxIssues });
        const issues = r.issues.map((i) => ({
          type: i.type,
          rule: i.rule,
          message: clean(i.message),
          ...(i.element?.t || i.element?.d
            ? { label: clean(i.element.t ?? must(i.element.d, 'its description')) }
            : {}),
          ...(i.b && {
            x: Math.round((i.b[0] + i.b[2]) / 2),
            y: Math.round((i.b[1] + i.b[3]) / 2),
          }),
        }));
        const head = `${issues.length} accessibility issue${issues.length === 1 ? '' : 's'}${r.truncated ? ' (more not shown)' : ''}`;
        return reply(
          [
            head,
            ...issues.map(
              (i) =>
                // iOS's rule is the kind again, `XCUIAccessibilityAuditType.textClipped`
                `${i.rule.endsWith(`.${i.type}`) ? i.type : `${i.type} ${i.rule}`}: ${i.message}${i.label ? ` ${JSON.stringify(i.label)}` : ''}${i.x !== undefined && i.y !== undefined ? ` at ${i.x},${i.y}` : ''}`,
            ),
          ].join('\n'),
          { engine: r.engine, truncated: r.truncated, issues },
        );
      },
    }),
    defineOp({
      name: 'logs',
      title: 'App log',
      description:
        "The app's own log lines (logcat on Android), newest last, bounded, secrets redacted; contains: only lines with this text, whatever its case. On an iPhone it says what it cannot read.",
      input: z
        .object({
          app: App,
          since: Since,
          level: z.enum(['verbose', 'debug', 'info', 'warn', 'error']).default('info'),
          maxLines: z.number().int().min(1).max(MAX_LINES).default(DEFAULT_LINES),
          contains: z.string().min(1).max(200).optional(),
        })
        .strict(),
      output: LogsOut,
      annotations: READ,
      run: async ({ app, since, level, maxLines, contains }) => {
        const s = await ctx.session();
        const pkg = appOf(s, ctx, app);
        const from = sinceOf(since, s);
        const { lines, source, note } = await s.device.logs({
          app: pkg,
          level,
          maxLines,
          ...(from !== undefined && { since: from }),
        });
        // matched as shown: a secret's words find nothing
        const want = contains?.toLowerCase();
        const read = lines.map((l) => redactLog(ctx.policy, l));
        const { kept: shown, dropped } = boundLines(
          want ? read.filter((l) => l.toLowerCase().includes(want)) : read,
          maxLines,
        );
        const head = [
          `${shown.length} line${shown.length === 1 ? '' : 's'}${want ? ` with ${JSON.stringify(contains)}` : ''} of ${pkg} from ${source}${from !== undefined ? ` since ${new Date(from).toISOString()}` : ''}${dropped ? ` (${dropped} older lines left out)` : ''}`,
          ...(note ? [note] : []),
        ];
        return reply([...head, ...shown].join('\n'), {
          lines: shown.length,
          dropped,
          source,
          ...(note && { note }),
        });
      },
    }),
    defineOp({
      name: 'crashes',
      title: 'Crashes',
      description:
        "The app's crash, ANR and exit reports: a bounded summary, each report's file on this machine. since: ISO time; default: all kept.",
      input: z
        .object({
          app: App,
          since: z.string().max(40).optional(),
          limit: z.number().int().min(1).max(20).default(5),
          symbols: z
            .string()
            .max(1_000)
            .optional()
            .describe('a .dSYM or folder of them; Android: a folder of .so'),
        })
        .strict(),
      output: CrashesOut,
      annotations: READ,
      run: async ({ app, since, limit, symbols }) => {
        const s = await ctx.session();
        const pkg = appOf(s, ctx, app);
        const from = since ? sinceOf(since, s) : undefined;
        const { reports, source, note, exits } = await s.device.crashes({
          app: pkg,
          limit,
          ...(from !== undefined && { since: from }),
          ...(symbols && { symbols }),
        });
        const shown = reports.map((r) => ({
          ...r,
          reason: clean(r.reason),
          ...(r.detail && { detail: redactLog(ctx.policy, r.detail).slice(0, 1_000) }),
        }));
        const head = `${shown.length} crash report${shown.length === 1 ? '' : 's'} of ${pkg} from ${source}${note ? `\n${note}` : ''}`;
        return reply(
          [
            head,
            ...shown.map(
              (r) =>
                `${r.at} ${r.reason}${r.file ? `\n  file: ${r.file}` : ''}${r.symbolicated ? `\n  named: ${r.symbolicated}` : ''}${r.detail ? `\n  ${r.detail.split('\n').join('\n  ')}` : ''}`,
            ),
            ...(exits?.length
              ? [
                  `every exit kept: ${exits
                    .map(
                      (e) =>
                        `${e.reason} ${e.count}${e.memory ? ` (the last with ${e.memory})` : ''}`,
                    )
                    .join(', ')}`,
                ]
              : []),
          ].join('\n'),
          { reports: shown, source, ...(note && { note }), ...(exits && { exits }) },
        );
      },
    }),
  ];
}
