import { existsSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { must, run } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { sdkDir } from './emulators.js';

/** How many frames an answer holds; the whole tombstone is in the file. */
const FRAMES = 8;
/** A tombstone's name for an ABI, and a build's folder for it. */
const ABI_FOLDERS: Record<string, string> = {
  arm64: 'arm64-v8a',
  arm: 'armeabi-v7a',
  x86_64: 'x86_64',
  x86: 'x86',
};

/** A frame of a tombstone or of `ndk-stack`, short: its library by name, none of what only tells builds apart. */
export const shortFrame = (line: string) =>
  line
    .trim()
    .replace(/ \(offset 0x\w+\)| \(BuildId: \w+\)/g, '')
    .replace(/\S*[/!](\S+\.so)\b/, '$1')
    .replace(/\s{2,}/g, ' ');

/** The newest NDK's `ndk-stack`. */
function ndkStack() {
  const dir = join(sdkDir(), 'ndk');
  const found = (existsSync(dir) ? readdirSync(dir) : [])
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((v) => join(dir, v, 'ndk-stack'))
    .find(existsSync);
  if (!found)
    throw new DeviceError(
      'UNSUPPORTED',
      `naming a tombstone takes ndk-stack, from the NDK, and ${dir} holds none: sdkmanager "ndk;<version>"`,
    );
  return found;
}

/** `ndk-stack -sym` reads one folder of libraries: a build's `lib` folder holds one per ABI. */
function symbolFolder(path: string, tombstone: string) {
  if (!existsSync(path)) throw new DeviceError('NOT_FOUND', `no such folder of symbols: ${path}`);
  const abi = ABI_FOLDERS[/^ABI: '(\w+)'/m.exec(tombstone)?.[1] ?? ''];
  return abi && existsSync(join(path, abi)) ? join(path, abi) : path;
}

/**
 * What `ndk-stack` printed: a line per frame, with the function and the file it found on the lines below
 * joined to it, and each library whose symbols are of another build, which it warns of and does not read.
 */
export function namedFrames(out: string) {
  const frames: string[] = [];
  for (const line of out.split('\n')) {
    if (/^#\d+ 0x/.test(line)) frames.push(shortFrame(line.replace(/ 0x[0-9a-f]+/, '')));
    else if (/^\s{20,}\S/.test(line) && frames.length > 0)
      frames[frames.length - 1] =
        `${must(frames.at(-1), 'a frame')} ${line.trim().replace(/^.*\//, '')}`;
  }
  const other = [
    ...out.matchAll(
      /^WARNING: Mismatched build id for (?:.*\/)?(\S+)\nWARNING:\s+Expected\s+(\w+)\nWARNING:\s+Found\s+(\w+)$/gm,
    ),
  ].map(
    (m) =>
      `${must(m[1], 'a library')}: the crash is of build ${must(m[2], 'a build')}, these symbols of ${must(m[3], 'a build')}`,
  );
  return { frames, otherBuilds: [...new Set(other)] };
}

/**
 * A tombstone with its frames named from the libraries with symbols at `path`, kept in `file`. What
 * named nothing gives no detail: a library of another build is the caller's to say.
 */
export async function namedTombstone(tombstone: string, path: string, file: string) {
  await writeFile(file, tombstone, { mode: 0o600 });
  const { stdout } = await run(ndkStack(), ['-sym', symbolFolder(path, tombstone), '-dump', file], {
    maxBuffer: 1 << 24,
  });
  await writeFile(file, stdout, { mode: 0o600 });
  const { frames, otherBuilds } = namedFrames(stdout);
  const signal = /^signal .*$/m.exec(tombstone)?.[0];
  return {
    detail: [...(signal ? [signal] : []), ...frames.slice(0, FRAMES)].join('\n'),
    otherBuilds,
  };
}
