import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AddedMedia, Owner } from '@appdyno/core';
import type { Policy } from './policy.js';
import { ToolError } from './tool.js';
import { readInside } from './writes.js';

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

/** A folder's file where a tool reads, if it is one: one a link leads elsewhere from, or that is gone, is none. */
const readable = (policy: Policy, file: string) => {
  try {
    return readInside(policy, file);
  } catch (e) {
    if (e instanceof ToolError) return undefined;
    throw e;
  }
};

/**
 * The photos and videos `value` names, a file or a folder's own files, each where a tool reads (`readInside`): a client
 * names the path, and no other folder of this Mac, the state folder's secrets least, goes to a device.
 */
export function mediaFiles(policy: Policy, value: string | undefined) {
  if (!value)
    throw new ToolError(
      'media needs path: a photo or a video, or a folder of them, in the folders this server reads',
      'INVALID_ARGUMENT',
    );
  const given = resolve(value);
  const real = readInside(policy, given);
  const found = statSync(real).isDirectory()
    ? readdirSync(real)
        .sort()
        .map((f) => readable(policy, join(given, f)))
    : [real];
  const media = found.filter(
    (f): f is string => f !== undefined && MEDIA.test(f) && statSync(f).isFile(),
  );
  if (media.length === 0)
    throw new ToolError(
      found.length === 1 && found[0] === real
        ? `${given} is not a photo or video file`
        : `${given} holds no photo or video in the folders this server reads`,
      'INVALID_ARGUMENT',
    );
  return media;
}
