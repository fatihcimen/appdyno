import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { NEEDS, pause, reportProgress } from '@appdyno/core';
import { z } from 'zod';
import { alive } from '../claims.js';
import type { ServerContext } from '../context.js';
import { checkDevice } from '../policy.js';
import { MirrorOut } from '../schemas.js';
import { ACT, defineOp, reply, ToolError, type Op } from '../tool.js';
import { FOCUS_SIGNAL, liveMirror, liveMirrors, mirrorLog, type MirrorFile } from './state.js';

/** A first use compiles the viewer: 25 s was measured at load 270. */
const OPEN_MS = 180_000;
const CLOSE_MS = 10_000;
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
  return `${f.serial}: ${n.shown} frames/s shown of ${n.arrived} arrived, ${n.dropped} dropped, ${n.mbps} Mbit/s; capture to arrival p50 ${n.captureP50}, p95 ${n.captureP95} ms; decode p95 ${n.decodeP95} ms; ${n.source} ${n.mode} ${n.w}x${n.h}; viewer ${n.cpu}% of a core, ${n.rssMb} MB`;
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

export function mirrorOps(ctx: ServerContext): Op[] {
  const open = async (quality: string) => {
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
      command[0]!,
      [...command.slice(1), '--device', serial, '--share', '--quality', quality],
      { detached: true, stdio: ['ignore', out, out] },
    );
    closeSync(out);
    child.unref();
    let ended = false;
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
    while (alive(f) && Date.now() < end) await pause(POLL_MS);
    if (alive(f)) throw new ToolError(`the mirror of ${f.serial} did not end`, 'TIMEOUT');
    const t = `closed the mirror of ${f.serial}`;
    return reply(t, { done: t, mirrors: [] });
  };

  return [
    defineOp({
      name: 'mirror',
      title: 'Live window',
      description:
        "A device's live window for your person, who can touch it as you drive: open, close, status (what stands in its way, and the fix), stats (true frame rates). No frames here: screenshot and record are yours.",
      input: z
        .object({
          action: z.enum(['open', 'close', 'status', 'stats']),
          quality: z.enum(['auto', 'high', 'standard']).default('auto'),
        })
        .strict(),
      output: MirrorOut,
      annotations: ACT,
      run: async ({ action, quality }) => {
        if (action === 'open') return open(quality);
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
