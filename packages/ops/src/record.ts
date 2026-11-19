import { existsSync, mkdirSync } from 'node:fs';
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
import { picturesHideNothing } from './policy.js';
import { reportVideoDir } from './report-state.js';
import { Handle, RecordOut } from './schemas.js';
import type { Session } from './session.js';
import { definePart, DESTRUCTIVE, reply, ToolError } from './tool.js';
import { inside } from './writes.js';

const DEFAULT_S = 1_800;
const MAX_S = 3_600;

/** The device's recording: it outlives the process, so that a command line can start and stop one. */
export const filming = deviceState(
  'video',
  z.object({
    handle: Handle,
    since: z.string(),
    file: z.string(),
    owner: Owner.optional(),
    /** When one `record` started is past its time: it has ended then, whatever its process says, as on a Mac that slept. */
    until: z.string().optional(),
    /** A timeline's or the flight recorder's, which end it themselves. */
    by: z.enum(['timeline', 'flight']).optional(),
  }),
);
type Filming = NonNullable<ReturnType<typeof filming.read>>;

/** When a recording ended by itself, as its recorder says or as its time came; none while it runs. */
async function endedAt(s: Session, r: Filming) {
  const ended = await s.device.recorder.endedAt?.(r.handle);
  if (ended !== undefined) return ended;
  const until = Date.parse(r.until ?? '');
  return until <= Date.now() ? until : undefined;
}

/**
 * Refuses while a recording runs on the device, saying how it ends. One `record` started that has ended by itself, at
 * its time or as its process went, is finished as `stop` would, and said in the line this gives; a timeline's or the
 * flight recorder's is theirs to end. `also`: what the refusal adds.
 */
export async function noRecordingRuns(s: Session, also = ''): Promise<string | undefined> {
  const serial = s.device.serial;
  const r = filming.read(serial);
  if (!r) return undefined;
  const at = r.by ? undefined : await endedAt(s, r);
  if (at === undefined)
    throw new ToolError(
      `a recording has run on ${serial} since ${r.since} (to ${r.file})${also}`,
      'DEVICE_CLAIMED',
      `record_session with kind ${r.by ?? 'video'} and action stop ends it`,
    );
  const kept = await endRecording(s).then(
    (end) => end?.data.files.join(', ') ?? r.file,
    (e: unknown) => {
      // a device gone, or a recorder that would not end, still holds it
      if (filming.read(serial)) throw e;
      return `it could not be kept: ${e instanceof Error ? e.message : String(e)}`;
    },
  );
  return `the last recording on ${serial} ended on its own${at ? ` at ${new Date(at).toISOString()}` : ''}: ${kept}`;
}

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
    definePart({
      name: 'record',
      input: z
        .object({
          action: z.enum(['start', 'stop']),
          file: z.string().max(1_000).optional(),
          overwrite: z.boolean().optional(),
          maxSeconds: z.number().int().min(1).max(MAX_S).default(DEFAULT_S),
        })
        .strict(),
      output: RecordOut,
      annotations: DESTRUCTIVE,
      run: async ({ action, file, overwrite, maxSeconds }) => {
        const s = await ctx.session();
        const recorder = s.device.recorder;
        if (action === 'stop') {
          const end = await endRecording(s);
          if (!end) throw new ToolError(`no recording runs on ${s.device.serial}`, 'NOT_FOUND');
          return reply(end.text, end.data);
        }
        const ended = await noRecordingRuns(s);
        const since = new Date().toISOString();
        const to = resolve(
          (file ? inside(ctx.policy, file) : undefined) ??
            join(
              reportVideoDir(s.device.serial) ?? join(stateDir(), 'video'),
              `${safeName(s.device.serial)}-${since.replace(/\W/g, '')}.${recorder.extension}`,
            ),
        );
        // a file given is a video of this device's kind, and one that is there is replaced only when asked
        if (file && !to.toLowerCase().endsWith(`.${recorder.extension}`))
          throw new ToolError(
            `${to}: a .${recorder.extension} file, as this device records`,
            'INVALID_ARGUMENT',
          );
        if (file && existsSync(to) && !overwrite)
          throw new ToolError(
            `${to} is there already`,
            'INVALID_ARGUMENT',
            'overwrite replaces it',
          );
        // a folder that cannot be written is said now, not after the recording
        try {
          mkdirSync(dirname(to), { recursive: true });
        } catch (e) {
          throw new ToolError(`cannot write ${to}: ${(e as Error).message}`, 'INVALID_ARGUMENT');
        }
        const handle = await recorder.start(to, { maxSeconds });
        const until = new Date(Date.now() + maxSeconds * 1_000).toISOString();
        filming.write(s.device.serial, { handle, since, file: to, owner: s.owner, until });
        const t = `recording to ${to}, at most ${maxSeconds} s${picturesHideNothing(ctx.policy, 'video')}`;
        return reply(ended ? `${t}\n${ended}` : t, {
          done: t,
          files: [to],
          since,
          ...(ended && { note: ended }),
        });
      },
    }),
  ];
}
