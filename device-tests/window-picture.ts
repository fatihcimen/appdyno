import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { pictureApart, SAME_PICTURE } from '../packages/core/test/picture-apart.js';

const SHOT_MS = 10_000;

/** The device's screen alone, as a real window shows it this moment: what a person sees, not what was sent. */
export async function shownByWindow(session: { tell(m: Record<string, unknown>): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-shown-'));
  const file = join(dir, 'screen.png');
  session.tell({ op: 'snapshot', file, screen: true });
  const end = Date.now() + SHOT_MS;
  for (;;) {
    const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    if (size > 0) break;
    if (Date.now() > end) throw new Error(`no picture of the window in ${SHOT_MS} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
  const png = readFileSync(file);
  rmSync(dir, { recursive: true, force: true });
  return png;
}

/** On a still screen a window shows what the device says it shows, and where: suites read a phone back, and never this. */
export function expectSamePicture(shown: Buffer, device: Buffer) {
  const { difference, shift } = pictureApart(shown, device);
  // a passing test prints nothing, and how near a stream comes to the limit is the point: APPDYNO_PICTURE_LOG keeps it
  const log = process.env.APPDYNO_PICTURE_LOG;
  if (log) appendFileSync(log, `${difference.toFixed(1)} levels apart of ${SAME_PICTURE}\n`);
  expect(shift).toEqual({ x: 0, y: 0 });
  expect(difference).toBeLessThan(SAME_PICTURE);
}
