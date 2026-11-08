import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deviceStateFile, type DeviceState, type Need } from '@appdyno/core';
import type { Decoded, DecodedDict } from './xpc-codec.js';

/** A dark phone keeps its stream at a picture a second, and a lit one still sends about twenty. */
const DARK_PICTURES = 2;
const DARK_SECONDS = 3;
const LIT_PICTURES = 5;

/** A reason of the phone's in a form a person can act on; what it said goes along. */
export class StreamRefusal extends Error {
  constructor(
    readonly need: Need | undefined,
    message: string,
  ) {
    super(message);
  }
}

/** Apple's words for what stops a stream, as its daemon has them. */
const WORDS: [RegExp, Need][] = [
  [/microphone or camera/i, 'camera-or-mic'],
  [/phone or voip call/i, 'call'],
  [/personal assistant/i, 'siri'],
  [/requires iOS|not supported on this device/i, 'os-too-old'],
];

export const needOf = (words: string): Need | undefined => WORDS.find(([w]) => w.test(words))?.[1];

/** Told the pictures so far each second, says when the screen went dark or came back. */
export class DarkWatch {
  private last = 0;
  private low = 0;
  private dark = false;

  tick(pictures: number): DeviceState | undefined {
    const inSecond = pictures - this.last;
    this.last = pictures;
    this.low = inSecond <= DARK_PICTURES ? this.low + 1 : 0;
    if (!this.dark && this.low >= DARK_SECONDS) {
      this.dark = true;
      return 'asleep';
    }
    if (this.dark && inSecond >= LIT_PICTURES) {
      this.dark = false;
      return 'ok';
    }
    return undefined;
  }
}

export const number = (v: Decoded | undefined) => (typeof v === 'number' ? v : 0);
export const dict = (v: Decoded | undefined) =>
  v && typeof v === 'object' && !Buffer.isBuffer(v) && !Array.isArray(v) ? v : ({} as DecodedDict);

/** Who holds the phone's streams now, by the id each start gave. */
export function sessionsOf(status: DecodedDict): string[] {
  const sessions = Array.isArray(status.sessions) ? status.sessions : [];
  const ids = sessions.map((s) => {
    const options = dict(dict(dict(s).connection).options);
    const { uuid } = dict(options.avcMediaStreamOptionClientSessionID);
    return typeof uuid === 'string' ? uuid : '';
  });
  return [...new Set(ids)];
}

/** The sessions we started on this phone and have not seen end: a stream left by a process that died is one. */
const ownFile = (udid: string) => deviceStateFile('phone-stream', udid);
export const compact = (id: string) => id.replaceAll('-', '').toLowerCase();

export function ownSessions(udid: string): string[] {
  try {
    return JSON.parse(readFileSync(ownFile(udid), 'utf8')) as string[];
  } catch {
    return [];
  }
}

export function rememberOwn(udid: string, ids: string[]) {
  const file = ownFile(udid);
  if (!ids.length) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(ids), { mode: 0o600 });
}
