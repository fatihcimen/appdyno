import { readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { AddedMedia, Owner } from '@appdyno/core';
import { ToolError } from './tool.js';

/** What changed on the device since it was added: not this tool's to delete. */
const leftWords = (left: string[]) =>
  `left ${left.join(', ')} in the library: changed since it was added`;

/**
 * What this tool added to a device's library, taken out by path and size, as a session's end takes it: refused, after
 * the rest is out, where a file changed since.
 */
export async function takeOutMedia(media: AddedMedia) {
  const { removed, left } = await media.takeOut();
  if (left.length > 0) throw new Error(leftWords(left));
  return removed.length;
}

/**
 * The same at a restore, where `whose` takes the one who holds it: what its answer says was done, and what it could not
 * restore, as a condition's. Nothing of either on a device that takes nothing out, as a simulator, or holds nothing.
 */
export async function mediaRestored(
  media: AddedMedia | undefined,
  whose: (owner: Owner | undefined) => boolean,
): Promise<{ done: string[]; failed: string[] }> {
  const held = media?.holder();
  if (!media || !held || !whose(held.owner)) return { done: [], failed: [] };
  const { removed, left } = await media.takeOut();
  const n = removed.length;
  return {
    done:
      n > 0
        ? [`took out the ${n} ${n === 1 ? 'photo or video' : 'photos and videos'} it added`]
        : [],
    failed: left.length > 0 ? [`media: ${leftWords(left)}`] : [],
  };
}

/** What a photo library takes, by the file's extension: pictures and videos. */
const MEDIA = /\.(jpe?g|png|heic|heif|gif|webp|bmp|tiff?|mp4|mov|m4v|3gp|webm|mkv)$/i;

const realOf = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

/**
 * The photos and videos `value` names, a file or a folder's own files, each inside the folder this server runs in once
 * its links are followed: a client names the path, and no other folder of this Mac, the state folder's secrets least,
 * goes to a device.
 */
export function mediaFiles(value: string | undefined) {
  if (!value)
    throw new ToolError(
      "media needs value: a photo or a video, or a folder of them, inside this server's folder",
      'INVALID_ARGUMENT',
    );
  const root = realpathSync(process.cwd());
  const inside = (p: string | undefined) => {
    const r = p === undefined ? '..' : relative(root, p);
    return !r.startsWith('..') && !isAbsolute(r);
  };
  const given = resolve(value);
  const real = realOf(given);
  if (!real) throw new ToolError(`${given}: no such file or folder`, 'NOT_FOUND');
  if (!inside(real))
    throw new ToolError(
      `${given} is outside the folder this server runs in`,
      'POLICY_DENIED',
      `give a path inside ${root}`,
    );
  const found = statSync(real).isDirectory()
    ? readdirSync(real)
        .sort()
        .map((f) => realOf(join(real, f)))
    : [real];
  const media = found.filter(
    (f): f is string => f !== undefined && inside(f) && MEDIA.test(f) && statSync(f).isFile(),
  );
  if (media.length === 0)
    throw new ToolError(
      found.length === 1 && found[0] === real
        ? `${given} is not a photo or video file`
        : `${given} holds no photo or video inside this server's folder`,
      'INVALID_ARGUMENT',
    );
  return media;
}
