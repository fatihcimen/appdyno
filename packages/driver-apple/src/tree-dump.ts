import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Tree } from '@appdyno/protocol';

/** Diagnostics: while this file exists, iOS tree reads are written to DUMP_DIR. */
const DUMP_FLAG = join(homedir(), 'Library/Caches/appdyno/dump-trees');

const DUMP_DIR = join(homedir(), 'Library/Caches/appdyno/tree-dumps');

/** Diagnostics: while the flag file exists, every read of a device is kept (this machine only). */
export async function keepTreeDump(serial: string, t: Tree) {
  if (existsSync(DUMP_FLAG))
    await mkdir(DUMP_DIR, { recursive: true, mode: 0o700 })
      .then(() =>
        writeFile(join(DUMP_DIR, `${Date.now()}-${serial.slice(0, 8)}.json`), JSON.stringify(t), {
          mode: 0o600,
        }),
      )
      .catch(() => undefined);
}
