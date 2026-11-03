import { existsSync } from 'node:fs';
import { DeviceError } from '@appdyno/protocol';

export const assertAppBundle = (path: string) => {
  if (!path.endsWith('.app') || !existsSync(path))
    throw new DeviceError('INVALID_ARGUMENT', `not a local .app bundle: ${path}`);
};

export const on = (v: string, yes: string, no: string) => ({ on: yes, off: no })[v] ?? v;
