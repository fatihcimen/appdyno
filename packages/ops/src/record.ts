import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readVideo, reportProgress, stateDir, type RecordingHandle } from '@appdyno/core';
import type { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { reportVideoDir } from './report.js';
import { RecordOut } from './schemas.js';
import { refused, type Session } from './session.js';
import { defineOp, DESTRUCTIVE, reply, ToolError, type Op } from './tool.js';

const DEFAULT_S = 1_800;
const MAX_S = 3_600;

type Running = { handle: RecordingHandle; since: string; file: string };

const stateOf = (serial: string) =>
  join(stateDir(), 'video', `${serial.replace(/[^\w.-]/g, '_')}.json`);

const running = (serial: string): Running | undefined => {
  try {
    return JSON.parse(readFileSync(stateOf(serial), 'utf8')) as Running;
  } catch {
    return undefined;
  }
};

/** Ends the device's recording and checks what came of it; a file that does not play is a refusal. */
export async function endRecording(s: Session) {
  const r = running(s.device.serial);
  if (!r || !s.device.recorder) return undefined;
  reportProgress('ending the recording');
  const { files, note } = await s.device.recorder.stop(r.handle).catch((e: unknown) => {
    // the next start must not be refused for a recording that has ended, however it ended; a device
    // that went away may come back, and its recording with it
    const code = (e as DeviceError).code;
    if (code !== 'DEVICE_GONE' && code !== 'TIMEOUT')
      rmSync(stateOf(s.device.serial), { force: true });
    return refused(e);
  });
  rmSync(stateOf(s.device.serial), { force: true });
  const videos = await Promise.all(files.map((f) => readVideo(f).catch(refused)));
  const lines = files.map((f, i) => {
    const v = videos[i]!;
    return `${f}: ${(v.durationMs / 1000).toFixed(1)} s, ${v.frames} frames, ${v.width}x${v.height}, ${v.codec}`;
  });
  return {
    text: [...lines, ...(note ? [note] : [])].join('\n'),
    data: {
      done: lines.join('\n'),
      files,
      durationMs: videos.reduce((a, v) => a + v.durationMs, 0),
      frames: videos.reduce((a, v) => a + v.frames, 0),
      since: r.since,
      ...(note && { note }),
    },
  };
}

export function recordOps(ctx: ServerContext): Op[] {
  return [
    defineOp({
      name: 'record',
      title: 'Screen video',
      description: `Screen video, one per device. start (file; maxSeconds); stop checks that it plays or says why not. A session's end stops it too.`,
      input: z
        .object({
          action: z.enum(['start', 'stop']),
          file: z.string().max(1_000).optional(),
          maxSeconds: z.number().int().min(1).max(MAX_S).default(DEFAULT_S),
        })
        .strict(),
      output: RecordOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, file, maxSeconds }) => {
        const s = await ctx.session();
        const recorder = s.device.recorder;
        if (!recorder) throw new ToolError('this device cannot record its screen', 'UNSUPPORTED');
        if (action === 'stop') {
          const end = await endRecording(s);
          if (!end) throw new ToolError(`no recording runs on ${s.device.serial}`, 'NOT_FOUND');
          return reply(end.text, end.data);
        }
        const now = running(s.device.serial);
        if (now)
          throw new ToolError(
            `a recording has run on ${s.device.serial} since ${now.since} (to ${now.file}): stop it first`,
          );
        const since = new Date().toISOString();
        const to = resolve(
          file ??
            join(
              reportVideoDir(s.device.serial) ?? join(stateDir(), 'video'),
              `${s.device.serial.replace(/[^\w.-]/g, '_')}-${since.replace(/\W/g, '')}.${recorder.extension}`,
            ),
        );
        // a folder that cannot be written is said now, not after the recording
        try {
          mkdirSync(dirname(to), { recursive: true });
        } catch (e) {
          throw new ToolError(`cannot write ${to}: ${(e as Error).message}`);
        }
        const handle = await recorder.start(to, { maxSeconds }).catch(refused);
        mkdirSync(dirname(stateOf(s.device.serial)), { recursive: true, mode: 0o700 });
        writeFileSync(stateOf(s.device.serial), JSON.stringify({ handle, since, file: to }), {
          mode: 0o600,
        });
        const t = `recording to ${to}, at most ${maxSeconds} s`;
        return reply(t, { done: t, files: [to], since });
      },
    }),
  ];
}
