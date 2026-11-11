import { readdirSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { must, stateDir } from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provoked } from './no-real-state.setup.js';

const REAL = join(userInfo().homedir, 'Library/Caches/appdyno');
/** Is not there: with the guard off, what these provoke must still do nothing to a real folder. */
const NOWHERE = join(REAL, 'no-such-folder-for-a-test');
const REFUSED = /reached this Mac's own state/;

describe('a unit test and this Mac’s own state', () => {
  beforeEach(() => {
    provoked.now = true;
  });
  afterEach(() => {
    provoked.now = false;
  });

  it('runs on a state folder of its own', () => {
    expect(process.env.APPDYNO_STATE_DIR).toBeTruthy();
    expect(stateDir().startsWith(REAL)).toBe(false);
    expect(process.env.APPDYNO_TOOLS_DIR?.startsWith(REAL)).toBe(false);
  });

  it("has one no other test file shares, within the run's", () => {
    // the run's folder holds the breaches file: the other worker's files have folders beside this one
    const run = dirname(must(process.env.APPDYNO_TEST_BREACH_FILE, 'the breaches file'));
    expect(dirname(stateDir())).toBe(run);
    expect(basename(stateDir())).toMatch(/^file-/);
  });

  it('cannot read, write or remove there, by either kind of call', async () => {
    expect(() => readdirSync(NOWHERE)).toThrow(REFUSED);
    expect(() => writeFileSync(join(NOWHERE, 'stamp'), '')).toThrow(REFUSED);
    await expect(readdir(NOWHERE)).rejects.toThrow(REFUSED);
    await expect(mkdir(join(NOWHERE, 'a'))).rejects.toThrow(REFUSED);
    await expect(rm(NOWHERE, { force: false })).rejects.toThrow(REFUSED);
  });

  it('is not fooled by a path that only looks away from it', () => {
    expect(() => readdirSync(join(REAL, '..', 'appdyno', 'no-such-folder'))).toThrow(REFUSED);
    expect(() => readdirSync(new URL(`file://${NOWHERE}`))).toThrow(REFUSED);
  });

  it('leaves a folder that only shares its beginning alone', () => {
    expect(() => readdirSync(`${REAL}-not-this-one`)).not.toThrow(REFUSED);
  });
});
