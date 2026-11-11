import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { WindowParts } from './controls.js';

const RECORD_MAX_S = 3_600;

/** How a movie ended: what it came to in words, and why it ended early or holds little. */
export type MovieEnd = { kept: boolean; what: string; why?: string };

/** A window's movie: one at a time, by what its source has, into the person's Movies or a file given. */
export function windowMovie({ device, session, note, stem }: WindowParts) {
  let stopRecording: (() => Promise<MovieEnd>) | undefined;

  /** A movie into `file`, by what this source has, and how to end it: once, however many ask. */
  const movieTo = async (file: string) => {
    const { recorder } = device;
    let finish: () => Promise<MovieEnd>;
    if (session().streamsItsOwn) {
      // its frames as the stream has them: nothing is encoded twice
      session().recording.start(file);
      finish = async () => {
        const r = await session().recording.stop();
        const took = r.seconds ? ` in ${r.seconds.toFixed(1)} s` : '';
        return {
          kept: r.frames > 0,
          what: `${r.frames} frames${took}`,
          ...(r.why && { why: r.why }),
        };
      };
    } else {
      const handle = await recorder.start(file, { maxSeconds: RECORD_MAX_S });
      finish = async () => {
        const { files, note: why } = await recorder.stop(handle);
        const what = `${files.length} file${files.length > 1 ? 's' : ''}`;
        return { kept: files.length > 0, what, ...(why && { why }) };
      };
    }
    let ending: Promise<MovieEnd> | undefined;
    const stop = () => {
      stopRecording = undefined;
      return (ending ??= finish());
    };
    stopRecording = stop;
    return stop;
  };

  /** The Record button: a movie into Movies, or the end of the one running. */
  const record = async () => {
    if (stopRecording) {
      session().tell({ op: 'recording', on: false });
      const { what, why } = await stopRecording();
      note(why ?? `Saved to Movies: ${what}`);
      return;
    }
    const movies = join(homedir(), 'Movies');
    mkdirSync(movies, { recursive: true });
    const type = session().streamsItsOwn ? 'mp4' : device.recorder.extension;
    await movieTo(join(movies, `${stem()}.${type}`));
    session().tell({ op: 'recording', on: true });
  };

  return {
    movieTo,
    record,
    /** A movie still being made ends with the window, and keeps what it has. */
    async end() {
      await stopRecording?.().catch(() => undefined);
      stopRecording = undefined;
    },
  };
}
