import { chmod, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** This machine's state: agent tokens, downloaded tools, measurements. */
export const stateDir = () =>
  process.env.APPDYNO_STATE_DIR ?? join(homedir(), 'Library/Caches/appdyno');

/** A device's id or a label as part of a file name. */
export const safeName = (s: string) => s.replace(/[^\w.-]/g, '_');

/** What is kept per device, in its own folder of the state directory. */
export const deviceStateFile = (folder: string, serial: string) =>
  join(stateDir(), folder, `${safeName(serial)}.json`);

/** An agent's state file as its schema says, or nothing when it is missing or not that. */
export async function readStateFile<T>(
  file: string,
  schema: { parse(x: unknown): T },
): Promise<T | undefined> {
  try {
    return schema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return undefined;
  }
}

/** Only this user may read it: it holds an agent's token. */
export async function writeStateFile(file: string, value: unknown) {
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  await chmod(file, 0o600);
}
