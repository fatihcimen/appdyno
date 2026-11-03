import { CdpSession, devToolsTargets, pause, type DevToolsTarget } from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { boundLines } from './diagnose.js';
import { redactLog } from './policy.js';
import { ReactNativeOut } from './schemas.js';
import { defineOp, DESTRUCTIVE, reply, ToolError, type Op } from './tool.js';

const DEFAULT_METRO = 'localhost:8081';
const DEFAULT_LOG_MS = 3_000;
const MAX_LOG_MS = 60_000;
const MAX_LINES = 500;

type Console = {
  type?: string;
  args?: { type?: string; value?: unknown; description?: string }[];
};

const shown = (a: { value?: unknown; description?: string; type?: string }) =>
  typeof a.value === 'string'
    ? a.value
    : a.value !== undefined
      ? JSON.stringify(a.value)
      : (a.description ?? a.type ?? '');

/** Metro on this Mac, and the Hermes runtime it fronts over the DevTools protocol. Needs no device. */
export function reactNativeOps(ctx: ServerContext): Op[] {
  const targetsAt = (base: string) =>
    devToolsTargets(base).catch((e: Error) => {
      throw new ToolError(
        `no Metro answers at ${base}: ${e.message}. Start it (npx react-native start), or give metro`,
        'NOT_FOUND',
      );
    });

  const one = async (base: string, wanted: string | undefined): Promise<DevToolsTarget> => {
    const all = (await targetsAt(base)).filter((t) => t.webSocketDebuggerUrl);
    const hit = wanted ? all.find((t) => t.id === wanted) : all.at(-1);
    if (!hit)
      throw new ToolError(
        wanted
          ? `no target ${wanted} at ${base}`
          : `no app is connected to the Metro at ${base}: open the app with Hermes on`,
        'NOT_FOUND',
      );
    return hit;
  };

  return [
    defineOp({
      name: 'react_native',
      title: 'React Native',
      description: `A debug React Native app through Metro. targets; logs (the JS console for ms); reload. metro: host:port.`,
      input: z
        .object({
          action: z.enum(['targets', 'logs', 'reload']),
          metro: z
            .string()
            .regex(/^[\w.-]+:\d+$/)
            .default(DEFAULT_METRO),
          target: z.string().max(200).optional(),
          ms: z.number().int().min(100).max(MAX_LOG_MS).default(DEFAULT_LOG_MS),
        })
        .strict(),
      output: ReactNativeOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, metro, target, ms }) => {
        const base = `http://${metro}`;
        if (action === 'targets') {
          const list = await targetsAt(base);
          const t =
            list
              .map((x) => `${x.id} ${JSON.stringify(x.title ?? '')} ${x.description ?? ''}`.trim())
              .join('\n') || `no app is connected to the Metro at ${base}`;
          return reply(t, {
            done: t,
            targets: list.map((x) => ({ id: x.id, ...(x.title && { title: x.title }) })),
          });
        }
        if (action === 'reload') {
          // Metro's own route; a server without it still has the runtime's
          const r = await fetch(`${base}/reload`, {
            method: 'POST',
            signal: AbortSignal.timeout(5_000),
          }).catch(() => undefined);
          if (r?.ok) return reply('reloaded through Metro', { done: 'reloaded through Metro' });
          const t = await one(base, target);
          const session = await CdpSession.open(t.webSocketDebuggerUrl!);
          try {
            await session.send('Page.reload');
          } finally {
            session.close();
          }
          return reply(`reloaded ${t.id}`, { done: `reloaded ${t.id}` });
        }
        const t = await one(base, target);
        const session = await CdpSession.open(t.webSocketDebuggerUrl!);
        const lines: string[] = [];
        try {
          session.on('Runtime.consoleAPICalled', (p) => {
            const c = p as Console;
            lines.push(`${c.type ?? 'log'}: ${(c.args ?? []).map(shown).join(' ')}`);
          });
          // the runtime replays what it kept from before anyone listened
          await session.send('Runtime.enable');
          await pause(ms);
        } finally {
          session.close();
        }
        const { kept, dropped } = boundLines(lines, MAX_LINES);
        const out = kept.map((l) => redactLog(ctx.policy, l));
        const head = `${out.length} console lines of ${t.id} in ${ms} ms${dropped ? ` (${dropped} older left out)` : ''}`;
        return reply([head, ...out].join('\n'), { done: head, lines: out.length, dropped });
      },
    }),
  ];
}
