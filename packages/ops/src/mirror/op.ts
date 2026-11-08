import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { must, NEEDS, pause, reportProgress, isAlive } from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { checkDevice } from '../policy.js';
import { MirrorOut } from '../schemas.js';
import { ACT, defineOp, reply, ToolError } from '../tool.js';
import {
  FOCUS_SIGNAL,
  liveMirror,
  liveMirrors,
  mirrorLog,
  type MirrorFile,
} from '../mirror-state.js';

/** A first use compiles the viewer: 25 s was measured at load 270. */
const OPEN_MS = 180_000;
/** A window ends its stream and proves it: a loaded Mac took over 10 s. */
const CLOSE_MS = 30_000;
const POLL_MS = 100;

const ago = (ms: number) => `${Math.round((Date.now() - ms) / 1000)} s ago`;

function line({ serial, pid, status: s }: MirrorFile): string {
  const words =
    s.state === 'waiting'
      ? `waiting: ${NEEDS[s.need].title}. ${NEEDS[s.need].fix}`
      : s.state === 'reconnecting'
        ? `reconnecting, try ${s.attempt}`
        : s.state;
  const touched = s.touchedAt ? `, a person touched it ${ago(s.touchedAt)}` : '';
  const note = s.note ? `; ${s.note}` : '';
  return `${serial}: ${words}${s.picture ? `, ${s.picture.w}x${s.picture.h} ${s.picture.codec}` : ''}${touched} (pid ${pid})${note}`;
}

function statsLine(f: MirrorFile): string {
  const n = f.status.stats;
  if (!n) return `${f.serial}: no numbers yet`;
  // the viewer's own numbers, read from its file: one it left out reads as it always has
  const of = (k: string) => String(n[k]);
  const none = '– (none counted)';
  const capture =
    n.captureP50 === undefined ? none : `p50 ${n.captureP50}, p95 ${of('captureP95')} ms`;
  const decode = n.decodeP95 === undefined ? none : `p95 ${n.decodeP95} ms`;
  return `${f.serial}: ${of('shown')} frames/s shown of ${of('arrived')} arrived, ${of('dropped')} dropped, ${of('mbps')} Mbit/s; capture to arrival ${capture}; decode ${decode}; ${of('source')} ${of('mode')} ${of('w')}x${of('h')}; viewer ${of('cpu')}% of a core, ${of('rssMb')} MB`;
}

const asData = (f: MirrorFile) => ({ serial: f.serial, pid: f.pid, ...f.status });

/** The parent's last word, from the file it logs to. */
function lastWord(serial: string): string {
  try {
    return readFileSync(mirrorLog(serial), 'utf8').trim().split('\n').pop() ?? '';
  } catch {
    return '';
  }
}

export function mirrorOps(ctx: ServerContext) {
  const open = async (quality: string, wifi: boolean) => {
    const serial = await ctx.defaultSerial();
    checkDevice(ctx.policy, serial);
    const running = liveMirror(serial);
    if (running) {
      process.kill(running.pid, FOCUS_SIGNAL);
      return reply(`${line(running)}; brought forward`, {
        done: 'already open',
        mirrors: [asData(running)],
      });
    }
    const command = ctx.mirrorCommand;
    if (!command)
      throw new ToolError(
        'this host cannot start a window',
        'UNSUPPORTED',
        'appdyno mirror, in a terminal',
      );
    const log = mirrorLog(serial);
    mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
    const out = openSync(log, 'w', 0o600);
    const child = spawn(
      must(command[0], "the window's command"),
      [
        ...command.slice(1),
        '--device',
        serial,
        '--input-on-click',
        '--quality',
        quality,
        ...(wifi ? ['--wifi'] : []),
      ],
      { detached: true, stdio: ['ignore', out, out] },
    );
    closeSync(out);
    child.unref();
    // the child's events set it, which the compiler cannot follow into the loop
    let ended = false as boolean;
    child.on('exit', () => (ended = true));
    child.on('error', () => (ended = true));
    reportProgress(`opening a window on ${serial}`);
    const end = Date.now() + OPEN_MS;
    while (Date.now() < end && !ended) {
      const f = liveMirror(serial);
      if (f && f.status.state !== 'connecting') {
        child.removeAllListeners('exit');
        return reply(line(f), { done: 'open', mirrors: [asData(f)] });
      }
      await pause(POLL_MS);
    }
    throw new ToolError(
      `no window on ${serial}: ${lastWord(serial) || 'the viewer did not say why'}`,
      ended ? 'UNSUPPORTED' : 'TIMEOUT',
    );
  };

  const close = async () => {
    const named = await ctx.defaultSerial().catch(() => undefined);
    const open = liveMirrors().filter((m) => ctx.allowed(m.serial));
    const f = named
      ? open.find((m) => m.serial === named)
      : open.length === 1
        ? open[0]
        : undefined;
    if (!f)
      throw new ToolError(
        open.length > 0
          ? `no mirror to close here; open on ${open.map((m) => m.serial).join(', ')}`
          : 'no mirror is open',
        'NOT_FOUND',
      );
    // only its own parent, as the file names it with its start time
    process.kill(f.pid, 'SIGTERM');
    const end = Date.now() + CLOSE_MS;
    while (isAlive(f) && Date.now() < end) await pause(POLL_MS);
    if (isAlive(f)) throw new ToolError(`the mirror of ${f.serial} did not end`, 'TIMEOUT');
    const t = `closed the mirror of ${f.serial}`;
    return reply(t, { done: t, mirrors: [] });
  };

  return [
    defineOp({
      name: 'mirror',
      title: 'Live window',
      description:
        'A live screen mirror for your person, who can touch it as you drive. status: what stands in its way, the fix; stats: true frame rates. No frames: use screenshot, record.',
      input: z
        .object({
          action: z.enum(['open', 'close', 'status', 'stats']),
          quality: z.enum(['auto', 'high', 'standard']).default('auto'),
          wifi: z.boolean().default(false),
        })
        .strict(),
      output: MirrorOut,
      annotations: ACT,
      run: async ({ action, quality, wifi }) => {
        if (action === 'open') return open(quality, wifi);
        if (action === 'close') return close();
        const mirrors = liveMirrors().filter((f) => ctx.allowed(f.serial));
        if (mirrors.length === 0) return reply('no mirror is open', { done: 'none', mirrors: [] });
        return reply(mirrors.map(action === 'stats' ? statsLine : line).join('\n'), {
          done: `${mirrors.length} open`,
          mirrors: mirrors.map(asData),
        });
      },
    }),
  ];
}
