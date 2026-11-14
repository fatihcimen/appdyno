import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  safeName,
  deviceState,
  must,
  Owner,
  readVideo,
  reportProgress,
  stateDir,
} from '@appdyno/core';
import type { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { reportVideoDir } from './report-state.js';
import { Handle, RecordOut } from './schemas.js';
import type { Session } from './session.js';
import { defineOp, DESTRUCTIVE, reply, ToolError } from './tool.js';

const DEFAULT_S = 1_800;
const MAX_S = 3_600;

/** The device's recording: it outlives the process, so that a command line can start and stop one. */
export const filming = deviceState(
  'video',
  z.object({ handle: Handle, since: z.string(), file: z.string(), owner: Owner.optional() }),
);

/** Ends the device's recording and checks what came of it; a file that does not play is a refusal. */
export async function endRecording(s: Session) {
  const serial = s.device.serial;
  const r = filming.read(serial);
  if (!r) return undefined;
  reportProgress('ending the recording');
  const { files, note } = await s.device.recorder.stop(r.handle).catch((e: unknown) => {
    // the next start must not be refused for a recording that has ended, however it ended; a device
    // that went away may come back, and its recording with it
    const code = (e as DeviceError).code;
    if (code !== 'DEVICE_GONE' && code !== 'TIMEOUT') filming.remove(serial);
    throw e;
  });
  filming.remove(serial);
  const videos = await Promise.all(files.map((f) => readVideo(f)));
  const lines = files.map((f, i) => {
    const v = must(videos[i], `the video of ${f}`);
    // what a player shows: the frames' own time ended at the last change, 5.3 s of a file that plays 7.4 s
    return `${f}: ${(v.playsMs / 1000).toFixed(1)} s, ${v.frames} frames, ${v.width}x${v.height}, ${v.codec}`;
  });
  return {
    text: [...lines, ...(note ? [note] : [])].join('\n'),
    data: {
      done: lines.join('\n'),
      files,
      durationMs: videos.reduce((a, v) => a + v.playsMs, 0),
      frames: videos.reduce((a, v) => a + v.frames, 0),
      since: r.since,
      ...(note && { note }),
    },
  };
}

export function recordOps(ctx: ServerContext) {
  return [
    defineOp({
      name: 'record',
      title: 'Screen video',
      description: `Screen video, one per device (to record actions for replay: flow). stop checks that it plays or says why not; a session's end stops it too.`,
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
        if (action === 'stop') {
          const end = await endRecording(s);
          if (!end) throw new ToolError(`no recording runs on ${s.device.serial}`, 'NOT_FOUND');
          return reply(end.text, end.data);
        }
        const now = filming.read(s.device.serial);
        if (now)
          throw new ToolError(
            `a recording has run on ${s.device.serial} since ${now.since} (to ${now.file}): stop it first`,
            'INVALID_ARGUMENT',
          );
        const since = new Date().toISOString();
        const to = resolve(
          file ??
            join(
              reportVideoDir(s.device.serial) ?? join(stateDir(), 'video'),
              `${safeName(s.device.serial)}-${since.replace(/\W/g, '')}.${recorder.extension}`,
            ),
        );
        // a folder that cannot be written is said now, not after the recording
        try {
          mkdirSync(dirname(to), { recursive: true });
        } catch (e) {
          throw new ToolError(`cannot write ${to}: ${(e as Error).message}`, 'INVALID_ARGUMENT');
        }
        const handle = await recorder.start(to, { maxSeconds });
        filming.write(s.device.serial, { handle, since, file: to, owner: s.owner });
        const t = `recording to ${to}, at most ${maxSeconds} s`;
        return reply(t, { done: t, files: [to], since });
      },
    }),
  ];
}
