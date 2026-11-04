import { mkdirSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deviceStateFile, ownerIn, thisOwner, type Owner } from '@appdyno/core';
import { ToolError } from './tool.js';

export type Claim = Owner;

const LOCK_STALE_MS = 5_000;
const LOCK_WAIT_MS = 2_000;

const fileOf = (serial: string) => deviceStateFile('claims', serial);

/** The live process that holds the device, if any: a dead owner's claim is no claim. */
export const holder = (serial: string) => ownerIn(fileOf(serial));

/** Two processes checking and writing at once: only one may be between the two. */
function locked<T>(file: string, body: () => T): T {
  const lock = `${file}.lock`;
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
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
      else if (Date.now() > end) throw new ToolError(`could not lock ${file}`, 'INTERNAL');
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    return body();
  } finally {
    rmdirSync(lock);
  }
}

/** This process takes the device for its session, or is refused with who holds it. */
export function claim(serial: string, tool: string) {
  const file = fileOf(serial);
  locked(file, () => {
    const h = holder(serial);
    if (h && h.pid !== process.pid)
      throw new ToolError(
        `${serial} is held by pid ${h.pid} (${h.tool}) since ${h.since}`,
        'DEVICE_CLAIMED',
        'use another device, or share this one: use_device with share: true, --share on the command line',
      );
    writeFileSync(file, JSON.stringify(thisOwner(tool)), { mode: 0o600 });
  });
}

export function release(serial: string) {
  const file = fileOf(serial);
  locked(file, () => {
    if (holder(serial)?.pid === process.pid) rmSync(file, { force: true });
  });
}
