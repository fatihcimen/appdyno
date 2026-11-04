import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deviceStateFile, stateDir, type MirrorStatus } from '@appdyno/core';
import { alive } from '../claims.js';

/** A mirror's parent, as other processes find it: no socket, one file per device. */
export type MirrorFile = {
  pid: number;
  /** A pid alone may be some later process's. */
  started: string;
  session: string;
  serial: string;
  status: MirrorStatus;
};

const fileOf = (serial: string) => deviceStateFile('mirror', serial);
const logOf = (serial: string) => `${fileOf(serial)}.log`;

export const mirrorLog = logOf;

/**
 * Asks a mirror's parent to bring its window forward. Not SIGUSR1, which Node takes as a request to open a
 * debugger's port; a parent has its handler before its file exists, so this signal never finds it without one.
 */
export const FOCUS_SIGNAL = 'SIGUSR2';

/** Whole or not at all: a reader never sees half. */
export function writeMirrorFile(file: MirrorFile) {
  const to = fileOf(file.serial);
  mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
  const tmp = `${to}.${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 });
  renameSync(tmp, to);
}

export const removeMirrorFile = (serial: string) => rmSync(fileOf(serial), { force: true });

function read(path: string): MirrorFile | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as MirrorFile;
  } catch {
    return undefined;
  }
}

/** The live parent of this device's mirror; a dead one's file is no mirror, and is removed. */
export function liveMirror(serial: string): MirrorFile | undefined {
  const f = read(fileOf(serial));
  if (!f) return undefined;
  if (alive(f)) return f;
  removeMirrorFile(serial);
  return undefined;
}

/** Every live mirror on this Mac. */
export function liveMirrors(): MirrorFile[] {
  const dir = join(stateDir(), 'mirror');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .flatMap((n) => {
      const f = read(join(dir, n));
      return f && liveMirror(f.serial) ? [f] : [];
    });
}
