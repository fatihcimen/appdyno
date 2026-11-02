import type { LogLevel } from '@appdyno/core';
import { AUDIT_TYPES } from '@appdyno/protocol';
import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { checkApp, redactLog } from './policy.js';
import { AuditOut, CrashesOut, LogsOut } from './schemas.js';
import { refused, type Session } from './session.js';
import { defineOp, READ, reply, ToolError, type Op } from './tool.js';

const MAX_LINES = 1_000;
const DEFAULT_LINES = 200;
/** What an answer may hold of a log, however long its lines. */
const MAX_LOG_CHARS = 20_000;
const MAX_ISSUES = 50;
const App = z.string().max(200).optional().describe('default: the selected app');
const Since = z.string().max(40).optional().describe('ISO time; default: since the last action');

function appOf(s: Session, ctx: ServerContext, app?: string) {
  const pkg = checkApp(ctx.policy, app ?? s.appId ?? '');
  if (!pkg) throw new ToolError('give app (or select one with use_device)');
  return pkg;
}

function sinceOf(given: string | undefined, s: Session) {
  if (!given) return s.lastActionAt;
  const t = Date.parse(given);
  if (Number.isNaN(t)) throw new ToolError(`not a time: ${given} (give ISO 8601)`);
  return t;
}

/** The newest lines that fit: a log is read from its end. */
export function boundLines(lines: string[], maxLines: number, maxChars = MAX_LOG_CHARS) {
  const kept: string[] = [];
  let chars = 0;
  for (let i = lines.length - 1; i >= 0 && kept.length < maxLines; i--) {
    const line = lines[i]!.slice(0, 2_000);
    if (chars + line.length + 1 > maxChars) break;
    chars += line.length + 1;
    kept.unshift(line);
  }
  return { kept, dropped: lines.length - kept.length };
}

export function diagnoseOps(ctx: ServerContext, { clean }: Answers): Op[] {
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
        const r = await s.device.audit({ ...(types && { types }), maxIssues }).catch(refused);
        const issues = r.issues.map((i) => ({
          type: i.type,
          rule: i.rule,
          message: clean(i.message),
          ...(i.element?.t || i.element?.d ? { label: clean(i.element.t ?? i.element.d!) } : {}),
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
                `${i.type} ${i.rule}: ${i.message}${i.label ? ` ${JSON.stringify(i.label)}` : ''}${i.x !== undefined ? ` at ${i.x},${i.y}` : ''}`,
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
        "The app's log since the last action or a given time, bounded, secrets redacted. On an iPhone it says what it cannot read.",
      input: z
        .object({
          app: App,
          since: Since,
          level: z.enum(['verbose', 'debug', 'info', 'warn', 'error']).default('info'),
          maxLines: z.number().int().min(1).max(MAX_LINES).default(DEFAULT_LINES),
        })
        .strict(),
      output: LogsOut,
      annotations: READ,
      run: async ({ app, since, level, maxLines }) => {
        const s = await ctx.session();
        if (!s.device.logs) throw new ToolError('this device gives no app log');
        const pkg = appOf(s, ctx, app);
        const from = sinceOf(since, s);
        const { lines, source, note } = await s.device
          .logs({
            app: pkg,
            level: level as LogLevel,
            maxLines,
            ...(from !== undefined && { since: from }),
          })
          .catch(refused);
        const { kept, dropped } = boundLines(lines, maxLines);
        const shown = kept.map((l) => redactLog(ctx.policy, l));
        const head = [
          `${shown.length} line${shown.length === 1 ? '' : 's'} of ${pkg} from ${source}${from !== undefined ? ` since ${new Date(from).toISOString()}` : ''}${dropped ? ` (${dropped} older lines left out)` : ''}`,
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
        "The app's crash and exit reports: a bounded summary and each report's file on this machine. since: ISO time; default: all kept.",
      input: z
        .object({
          app: App,
          since: z.string().max(40).optional(),
          limit: z.number().int().min(1).max(20).default(5),
        })
        .strict(),
      output: CrashesOut,
      annotations: READ,
      run: async ({ app, since, limit }) => {
        const s = await ctx.session();
        if (!s.device.crashes) throw new ToolError('this device gives no crash reports');
        const pkg = appOf(s, ctx, app);
        const from = since ? sinceOf(since, s) : undefined;
        const { reports, source, note } = await s.device
          .crashes({ app: pkg, limit, ...(from !== undefined && { since: from }) })
          .catch(refused);
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
                `${r.at} ${r.reason}${r.file ? `\n  file: ${r.file}` : ''}${r.detail ? `\n  ${r.detail.split('\n').join('\n  ')}` : ''}`,
            ),
          ].join('\n'),
          { reports: shown, source, ...(note && { note }) },
        );
      },
    }),
  ];
}
