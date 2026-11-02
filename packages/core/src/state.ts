import { homedir } from 'node:os';
import { join } from 'node:path';

/** This machine's state: agent tokens, downloaded tools, measurements. */
export const stateDir = () =>
  process.env.APPDYNO_STATE_DIR ?? join(homedir(), 'Library/Caches/appdyno');
