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
