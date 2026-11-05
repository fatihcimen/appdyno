import { existsSync } from 'node:fs';
import { DeviceError } from '@appdyno/protocol';

/** What an iOS app owns in its container; the rest there is the system's. */
export const DATA_FOLDERS = ['Documents', 'Library', 'tmp'];

export const assertAppBundle = (path: string) => {
  if (!path.endsWith('.app') || !existsSync(path))
    throw new DeviceError('INVALID_ARGUMENT', `not a local .app bundle: ${path}`);
};

/** A language for one launch, in the arguments the system reads for it. */
export const languageArgs = (language: string | undefined) =>
  language ? ['-AppleLanguages', `(${language})`, '-AppleLocale', language.replace('-', '_')] : [];

export const on = (v: string, yes: string, no: string) => ({ on: yes, off: no })[v] ?? v;
