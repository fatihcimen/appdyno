import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DeviceError } from '@appdyno/protocol';

const LOCK_STALE_MS = 5_000;
const LOCK_WAIT_MS = 2_000;

/** This machine's state: agent tokens, downloaded tools, measurements. */
export const stateDir = () =>
  process.env.APPDYNO_STATE_DIR ?? join(homedir(), 'Library/Caches/appdyno');

/** Where traces are kept, and from where the prune takes them. */
export const tracesDir = (state = stateDir()) => join(state, 'traces');

/** A device's id or a label as part of a file name. */
export const safeName = (s: string) => s.replace(/[^\w.-]/g, '_');

/** What is kept per device, in its own folder of the state directory. */
export const deviceStateFile = (folder: string, serial: string) =>
  join(stateDir(), folder, `${safeName(serial)}.json`);

type Parser<T> = { parse(x: unknown): T };

/** A state file as its schema says, or nothing when it is missing or not that. */
export function readState<T>(file: string, schema: Parser<T>): T | undefined {
  try {
    return schema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return undefined;
  }
}

/**
 * A file whole or not at all: a process killed here leaves the old one, never part of the new. `durable`, for a person's
 * own file, holds through a power cut too: left to itself a rename can reach the disk before the text it names.
 */
export function writeWhole(file: string, text: string, { mode = 0o600, durable = false } = {}) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    const fd = openSync(temp, 'w', mode);
    try {
      writeFileSync(fd, text);
      // as asked: a mode given to a new file is narrowed by the process's umask
      fchmodSync(fd, mode);
      if (durable) fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
  } catch (e) {
    rmSync(temp, { recursive: true, force: true });
    throw e;
  }
}

/** Only this user may read it: some hold an agent's token. */
export const writeState = (file: string, value: unknown) => writeWhole(file, JSON.stringify(value));

/** Two processes checking and writing at once: only one may be between the two. */
function locked<T>(file: string, body: () => T): T {
  const lock = `${file}.lock`;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const end = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      const age = (() => {
        try {
          return Date.now() - statSync(lock).mtimeMs;
        } catch {
          return 0;
        }
      })();
      if (age > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
      else if (Date.now() > end) throw new DeviceError('INTERNAL', `could not lock ${file}`);
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    return body();
  } finally {
    rmdirSync(lock);
  }
}

/** A change to a state file with nothing between its read and its write; undefined removes the file. */
export function updateState<T>(
  file: string,
  schema: Parser<T>,
  change: (now: T | undefined) => T | undefined,
) {
  return locked(file, () => {
    const next = change(readState(file, schema));
    if (next === undefined) rmSync(file, { force: true });
    else writeState(file, schema.parse(next));
    return next;
  });
}

/** One kind of state, a file per device. */
export function deviceState<T>(folder: string, schema: Parser<T>) {
  const fileOf = (serial: string) => deviceStateFile(folder, serial);
  return {
    read: (serial: string) => readState(fileOf(serial), schema),
    // what the schema would not read back is refused here, not lost silently at the next read
    write: (serial: string, value: T) => writeState(fileOf(serial), schema.parse(value)),
    update: (serial: string, change: (now: T | undefined) => T | undefined) =>
      updateState(fileOf(serial), schema, change),
    remove: (serial: string) => rmSync(fileOf(serial), { force: true }),
    /** A file that cannot be read moves aside, so that the next write does not take its place; where, if it did. */
    setAside(serial: string) {
      const file = fileOf(serial);
      if (!existsSync(file) || readState(file, schema) !== undefined) return undefined;
      const kept = `${file}.bad`;
      renameSync(file, kept);
      return kept;
    },
  };
}

/** An agent's state file, for the drivers. */
export const readStateFile = async <T>(file: string, schema: Parser<T>) => readState(file, schema);

export const writeStateFile = async (file: string, value: unknown) => writeState(file, value);
