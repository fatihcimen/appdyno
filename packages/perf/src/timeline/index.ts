import { randomBytes } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Timeline } from './model.js';
import { renderTimeline } from './page.js';

export * from './model.js';
export { renderTimeline } from './page.js';

/** Past this a page is slow to open and hard to send, so the video stays beside it and the page says so. */
export const VIDEO_INSIDE_BYTES = 64 * 1024 * 1024;

export const TIMELINE_FILE = 'timeline.html';

/**
 * Writes the page in `dir`, whole or not at all, with the video inside it if it fits. `video`: its file there, which
 * has to stay beside the page if it does not.
 */
export async function writeTimeline(t: Timeline, dir: string, video?: string) {
  const inside = !!t.video && !!video && t.video.bytes <= VIDEO_INSIDE_BYTES;
  const html = renderTimeline(t, {
    ...(inside && { bytes: await readFile(video) }),
    ...(video && !inside && { beside: basename(video) }),
  });
  const file = join(dir, TIMELINE_FILE);
  const partial = `${file}.${randomBytes(4).toString('hex')}`;
  await writeFile(partial, html, { mode: 0o600 });
  await rename(partial, file);
  return { file, bytes: (await stat(file)).size, videoInside: inside };
}
