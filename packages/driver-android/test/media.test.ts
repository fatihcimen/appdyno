import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidMedia, MEDIA_DIR, mediaRows, placesOf } from '../src/media.js';

const SERIAL = 'emulator-5662';

/** What `content query` printed on an API 35 emulator, two files pushed and one of them scanned. */
const ROWS = `Row: 0 _data=${MEDIA_DIR}/one.jpg, is_pending=0
Row: 1 _data=${MEDIA_DIR}/two.png, is_pending=1
`;

describe('where pushed photos go', () => {
  it('names each by its own name in a folder of its own, in words no shell quotes, two alike told apart', () => {
    expect(placesOf(['/p/a b.jpg', '/q/a_b.jpg', '/p/c.mov']).map((p) => p.path)).toEqual([
      `${MEDIA_DIR}/a_b.jpg`,
      `${MEDIA_DIR}/a_b-2.jpg`,
      `${MEDIA_DIR}/c.mov`,
    ]);
    expect(placesOf(['/p/a.jpg'], ['a.jpg']).map((p) => p.path)).toEqual([`${MEDIA_DIR}/a-2.jpg`]);
  });

  it("reads MediaStore's rows, with whether each is still pending", () => {
    expect(mediaRows(ROWS)).toEqual([
      { path: `${MEDIA_DIR}/one.jpg`, pending: false },
      { path: `${MEDIA_DIR}/two.png`, pending: true },
    ]);
    expect(mediaRows('No result found.\n')).toEqual([]);
  });
});

describe("an Android device's photos", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'android-media-'));
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * A device whose files are as `sizes` says, its folder holding `there`, each command kept, a push written down as it
   * went.
   */
  const device = (sizes: Record<string, number> = {}, rows = ROWS, there = '') => {
    const said: string[] = [];
    const adb = {
      run: (args: string[]) => {
        said.push(`push ${String(args.at(-1))}`);
        return Promise.resolve('');
      },
    } as unknown as Adb;
    const sh = (c: string) => {
      said.push(c);
      if (c.startsWith('content query')) return Promise.resolve(rows);
      if (c.startsWith('ls ')) return Promise.resolve(there);
      const stat = /^stat -c %s '(.*)'/.exec(c)?.[1];
      return Promise.resolve(stat && sizes[stat] !== undefined ? `${sizes[stat]}\n` : '');
    };
    return { media: new AndroidMedia(adb, SERIAL, sh), said };
  };

  const file = (name: string, bytes: number) => {
    const f = join(dir, name);
    writeFileSync(f, Buffer.alloc(bytes));
    return f;
  };

  it('pushes each file, has it scanned, and says how many of them the library lists', async () => {
    const { media, said } = device();
    const said1 = await media.add([file('one.jpg', 1224), file('two.png', 2346)]);
    expect(said1).toBe('the library lists 1 of them, in Pictures/appdyno');
    expect(said.slice(0, 4)).toEqual([
      `ls -1 ${MEDIA_DIR} 2>/dev/null`,
      `mkdir -p ${MEDIA_DIR}`,
      `push ${MEDIA_DIR}/one.jpg`,
      `content call --uri content://media/ --method scan_file --arg '${MEDIA_DIR}/one.jpg'`,
    ]);
    expect(media.holder()).toEqual({ owner: undefined });
  });

  it('takes out exactly what it pushed, leaves one that changed, and forgets both', async () => {
    const { media } = device();
    await media.add([file('one.jpg', 1224), file('two.png', 2346), file('three.mp4', 10)]);
    const gone = device({ [`${MEDIA_DIR}/one.jpg`]: 1224, [`${MEDIA_DIR}/two.png`]: 99 });
    const out = await gone.media.takeOut();
    expect(out).toEqual({ removed: [`${MEDIA_DIR}/one.jpg`], left: [`${MEDIA_DIR}/two.png`] });
    // the folder's row stays in the library after rmdir, on API 35 and 36, until a scan finds it gone; a folder that
    // still holds a file is neither removed nor scanned
    expect(gone.said.filter((c) => c.startsWith('rm'))).toEqual([
      `rm -f '${MEDIA_DIR}/one.jpg'`,
      `rmdir ${MEDIA_DIR} 2>/dev/null && content call --uri content://media/ --method scan_file --arg '${MEDIA_DIR}'`,
    ]);
    expect(gone.media.holder()).toBeUndefined();
  });

  it('pushes over no file of the folder it did not push, nor one a restore left as changed', async () => {
    const { media, said } = device({}, ROWS, 'one.jpg\n');
    await media.add([file('one.jpg', 10)]);
    expect(said).toContain(`push ${MEDIA_DIR}/one-2.jpg`);
    const gone = device({ [`${MEDIA_DIR}/one.jpg`]: 7, [`${MEDIA_DIR}/one-2.jpg`]: 10 });
    expect(await gone.media.takeOut()).toEqual({ removed: [`${MEDIA_DIR}/one-2.jpg`], left: [] });
  });

  it('keeps what a later add pushes under one name once, at its new size', async () => {
    const { media } = device();
    await media.add([file('one.jpg', 10)]);
    // its own file, which the folder now holds, goes under its name again
    await device({}, ROWS, 'one.jpg\n').media.add([file('one.jpg', 20)]);
    const now = device({ [`${MEDIA_DIR}/one.jpg`]: 20 });
    expect((await now.media.takeOut()).removed).toEqual([`${MEDIA_DIR}/one.jpg`]);
  });
});
