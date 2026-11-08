import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { run, stateDir, type CrashesAnswer, must } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';

/** How many frames an answer holds; the whole thread is in the file. */
const FRAMES = 8;

type Binary = { uuid: string; arch: string; path: string };
type Image = { uuid?: string; name?: string; base?: number; path?: string };
type Frame = { imageIndex?: number; imageOffset?: number; symbol?: string };

/** `dwarfdump --uuid`, a line per architecture: `UUID: C828F7A9-… (arm64) /…/DWARF/Fixture`. */
export const parseUuids = (out: string): Binary[] =>
  [...out.matchAll(/^UUID: (\S+) \((\S+)\) (.+)$/gm)].map(([, uuid, arch, path]) => ({
    uuid: must(uuid, 'a UUID').toLowerCase(),
    arch: must(arch, 'an architecture'),
    path: must(path, 'a path'),
  }));

/** The binaries of a `.dSYM`, or of every one under a folder such as a build's products. */
export async function dsymBinaries(path: string) {
  if (!existsSync(path)) throw new DeviceError('NOT_FOUND', `no such dSYM or folder: ${path}`);
  const found = path.endsWith('.dSYM')
    ? [path]
    : (readdirSync(path, { recursive: true }) as string[])
        .filter((f) => f.endsWith('.dSYM'))
        .map((f) => join(path, f));
  if (found.length === 0) throw new DeviceError('NOT_FOUND', `no .dSYM under ${path}`);
  return parseUuids((await run('xcrun', ['dwarfdump', '--uuid', ...found])).stdout);
}

/** The crashed thread of a `.ips` report, each frame with its image. */
export function crashedFrames(text: string): { frame: Frame; image?: Image }[] {
  const body = JSON.parse(text.slice(text.indexOf('\n') + 1)) as {
    faultingThread?: number;
    usedImages?: Image[];
    threads?: { frames?: Frame[] }[];
  };
  return (body.threads?.[body.faultingThread ?? 0]?.frames ?? []).map((frame) => {
    const image = body.usedImages?.[frame.imageIndex ?? -1];
    return { frame, ...(image && { image }) };
  });
}

/**
 * `atos`'s line as a name and where it was written, or nothing for an address it could not name:
 * `fixtureCrash(_:) (in Fixture) (FixtureApp.swift:201)`. Optimized code may have no place to give.
 */
export function atosName(line: string): string | undefined {
  const m = /^(.*?) \(in [^)]*\)(?: \((.*)\))?(?: \+ \d+)?$/.exec(line.trim());
  const name = m?.[1];
  if (!m || name === undefined || name.startsWith('0x')) return undefined;
  return m[2] && !m[2].includes('<compiler-generated>') ? `${name} (${m[2]})` : name;
}

export async function named(binary: Binary, base: number, offsets: number[]) {
  const hex = (n: number) => `0x${n.toString(16)}`;
  const { stdout } = await run('xcrun', [
    'atos',
    ...['-arch', binary.arch, '-o', binary.path, '-l', hex(base)],
    ...offsets.map((o) => hex(base + o)),
  ]);
  return stdout.trimEnd().split('\n').map(atosName);
}

/**
 * Names the crashed thread of each report from the dSYMs at `path`, an image only from the dSYM with its
 * UUID: any other would name the wrong functions and look right. What found none is said in the note.
 */
export async function withSymbols(answer: CrashesAnswer, path: string): Promise<CrashesAnswer> {
  const binaries = await dsymBinaries(path);
  const unmatched = new Set<string>();
  const dir = join(stateDir(), 'crashes');
  const reports: CrashesAnswer['reports'] = [];
  for (const r of answer.reports) {
    if (!r.file) {
      reports.push(r);
      continue;
    }
    const frames = crashedFrames(await readFile(r.file, 'utf8'));
    const names = new Map<Frame, string>();
    const images = new Set(
      frames.flatMap(({ image, frame }) => (image && !frame.symbol ? [image] : [])),
    );
    for (const image of images) {
      const binary = binaries.find((b) => b.uuid === image.uuid?.toLowerCase());
      if (!binary) {
        // the system's own frameworks have no dSYM of anyone's: only the app's is worth a word
        if (image.path?.includes('.app/'))
          unmatched.add(`${String(image.name)} ${String(image.uuid)}`);
        continue;
      }
      const bare = frames.filter((f) => f.image === image && !f.frame.symbol);
      const got = await named(
        binary,
        image.base ?? 0,
        bare.map((f) => f.frame.imageOffset ?? 0),
      );
      bare.forEach((f, i) => got[i] && names.set(f.frame, got[i]));
    }
    if (names.size === 0) {
      reports.push(r);
      continue;
    }
    const lines = frames.map(({ frame, image }) =>
      `${image?.name ?? '?'} ${names.get(frame) ?? frame.symbol ?? ''}`.trim(),
    );
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const symbolicated = join(dir, `${basename(r.file)}.symbolicated.txt`);
    await writeFile(symbolicated, `${lines.join('\n')}\n`, { mode: 0o600 });
    reports.push({ ...r, detail: lines.slice(0, FRAMES).join('\n'), symbolicated });
  }
  const held = binaries.map((b) => `${basename(b.path)} ${b.uuid}`).join(', ');
  return {
    ...answer,
    reports,
    ...(unmatched.size > 0 && {
      note: [answer.note, `no dSYM for ${[...unmatched].join(', ')}: ${path} has ${held}`]
        .filter(Boolean)
        .join('\n'),
    }),
  };
}
