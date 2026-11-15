import { statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { deviceState, Owner, type AddedMedia } from '@appdyno/core';
import { z } from 'zod';
import { shq, type Adb } from './adb.js';

/** Where photos and videos are pushed: a folder of this tool's own in the shared Pictures, which the library reads. */
export const MEDIA_DIR = '/storage/emulated/0/Pictures/appdyno';

const Added = z.object({
  files: z.array(z.object({ path: z.string(), size: z.number() })),
  owner: Owner.optional(),
});

/** Kept on this Mac by device: each file pushed, by its path and size, so that restore deletes exactly those. */
const added = deviceState('android-media', Added);

/** A file's name on the device: letters, digits, dot, dash and underscore, which no shell or link has to quote. */
export const deviceName = (file: string) => basename(file).replace(/[^\w.-]/g, '_');

/** Where each file goes, two that would take one name told apart. */
export function placesOf(files: string[]) {
  const used = new Set<string>();
  return files.map((file) => {
    const name = deviceName(file);
    const ext = extname(name);
    let place = name;
    for (let n = 2; used.has(place); n++) place = `${basename(name, ext)}-${n}${ext}`;
    used.add(place);
    return { file, path: `${MEDIA_DIR}/${place}` };
  });
}

/** The paths a MediaStore query's rows name, and whether each is still pending, out of `content query`'s lines. */
export function mediaRows(out: string) {
  return out.split('\n').flatMap((line) => {
    const path = /_data=(.*?)(?:, \w+=|$)/.exec(line)?.[1];
    return path ? [{ path, pending: line.includes('is_pending=1') }] : [];
  });
}

/** Photos and videos pushed into an Android device's library, and taken out again by path and size. */
export class AndroidMedia implements AddedMedia {
  owner: Owner | undefined;

  constructor(
    private readonly adb: Adb,
    private readonly serial: string,
    private readonly sh: (command: string) => Promise<string>,
  ) {}

  /**
   * Each file written down, then pushed and scanned: a file the device's storage made a row for stays pending, out of
   * the library's sight, until it is scanned. What the library then lists.
   */
  async add(files: string[]) {
    const places = placesOf(files);
    const paths = new Set(places.map((p) => p.path));
    // written down before anything goes: a process that dies in between leaves nothing restore cannot find
    added.update(this.serial, (now) => ({
      files: [
        ...(now?.files.filter((f) => !paths.has(f.path)) ?? []),
        ...places.map((p) => ({ path: p.path, size: statSync(p.file).size })),
      ],
      ...(this.owner && { owner: this.owner }),
    }));
    await this.sh(`mkdir -p ${MEDIA_DIR}`);
    for (const { file, path } of places) {
      await this.adb.run(['-s', this.serial, 'push', file, path]);
      // MediaProvider's own scan of one file: the scanner's broadcast scans nothing on API 36
      await this.sh(`content call --uri content://media/ --method scan_file --arg ${shq(path)}`);
    }
    const where = `_data LIKE '${MEDIA_DIR}/%'`;
    const rows = mediaRows(
      await this.sh(
        `content query --uri content://media/external/file --projection _data:is_pending --where ${shq(where)}`,
      ),
    );
    const listed = places.filter((p) => rows.some((r) => r.path === p.path && !r.pending)).length;
    return `the library lists ${listed} of them, in Pictures/appdyno`;
  }

  holder() {
    const now = added.read(this.serial);
    return now && { owner: now.owner };
  }

  /** Each file pushed, deleted where it is as it was pushed; one gone already is neither. */
  async takeOut() {
    const removed: string[] = [];
    const left: string[] = [];
    for (const f of added.read(this.serial)?.files ?? []) {
      const size = (await this.sh(`stat -c %s ${shq(f.path)} 2>/dev/null`)).trim();
      if (!size) continue;
      if (Number(size) !== f.size) {
        left.push(f.path);
        continue;
      }
      // the storage takes the library's row with the file
      await this.sh(`rm -f ${shq(f.path)}`);
      removed.push(f.path);
    }
    // the folder goes once nothing else is in it
    await this.sh(`rmdir ${MEDIA_DIR} 2>/dev/null`);
    added.remove(this.serial);
    return { removed, left };
  }
}
