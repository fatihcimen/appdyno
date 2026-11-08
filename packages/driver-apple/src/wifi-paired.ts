import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { deviceStateFile, stateDir } from '@appdyno/core';

/**
 * Which phones this Mac has paired for Wi-Fi: files, and no word with any phone, as a list reads it often and a build
 * with no phone stream still builds.
 */
const FOLDER = 'wifi-pairing';
const JSON_FILE = /\.json$/;

export const identityFile = (udid: string) => deviceStateFile(FOLDER, udid);

export function pairedPhones() {
  try {
    return readdirSync(join(stateDir(), FOLDER))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(JSON_FILE, ''));
  } catch {
    return [];
  }
}

/** This Mac forgets the phone. The phone keeps its half until a person clears it there. */
export const forgetPhone = (udid: string) => rmSync(identityFile(udid), { force: true });
