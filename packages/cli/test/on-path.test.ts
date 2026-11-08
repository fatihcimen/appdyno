import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  symlinkSync,
} from 'node:fs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { followMove, PATH_LINK, putOnPath, takeOffPath } from '../src/on-path.js';
import type { Run } from '../src/release.js';

const COMMAND = '/Applications/Appdyno.app/Contents/Resources/bin/appdyno';

describe('appdyno on the PATH', () => {
  let home: string;
  let bin: string;
  let link: string;
  let scripts: string[];
  const noPassword: Run = (_, args) => {
    scripts.push(must(args[1], 'a script'));
    return Promise.resolve({ stdout: '' });
  };
  const options = (run = noPassword) => ({
    home,
    command: COMMAND,
    run,
    link,
    out: () => undefined,
  });
  const stable = () => join(home, 'Library/Application Support/appdyno/appdyno');

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'appdyno-path-test-'));
    bin = join(home, 'bin');
    mkdirSync(bin);
    link = join(bin, 'appdyno');
    scripts = [];
  });

  it('lands where every shell of a Mac looks', () => {
    expect(PATH_LINK).toBe('/usr/local/bin/appdyno');
  });

  it('links through a name in the home, which a moved app repoints with no password', async () => {
    expect(await putOnPath(options())).toBe(0);
    expect(readlinkSync(link)).toBe(stable());
    expect(readlinkSync(stable())).toBe(COMMAND);
    expect(scripts).toEqual([]);
    const moved = '/Users/a/Tools/Appdyno.app/Contents/Resources/bin/appdyno';
    followMove(home, moved);
    expect(readlinkSync(stable())).toBe(moved);
    expect(readlinkSync(link)).toBe(stable());
  });

  it('asks the Mac for a password only for a folder this person cannot write', async () => {
    chmodSync(bin, 0o555);
    try {
      expect(await putOnPath(options())).toBe(0);
    } finally {
      chmodSync(bin, 0o755);
    }
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('with administrator privileges');
    expect(scripts[0]).toContain(`quoted form of "${link}"`);
  });

  it('keeps a quote in a home out of the script', async () => {
    home = join(home, 'o"brien');
    mkdirSync(home);
    chmodSync(bin, 0o555);
    try {
      await putOnPath(options());
    } finally {
      chmodSync(bin, 0o755);
    }
    expect(scripts[0]).toContain('o\\"brien');
  });

  it('says so when the person dismisses the password dialog', async () => {
    const dismissed: Run = () =>
      Promise.reject(Object.assign(new Error('x'), { stderr: 'User canceled. (-128)' }));
    chmodSync(bin, 0o555);
    try {
      await expect(putOnPath(options(dismissed))).rejects.toMatchObject({ code: 'CANCELLED' });
    } finally {
      chmodSync(bin, 0o755);
    }
  });

  it('never takes the place of what is there', async () => {
    symlinkSync('../lib/node_modules/appdyno/dist/main.js', link);
    await expect(putOnPath(options())).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: expect.stringMatching(/not this app's/) as unknown,
    });
    expect(readlinkSync(link)).toContain('node_modules');
    expect(existsSync(stable())).toBe(false);
  });

  it('refuses a plain file there too', async () => {
    writeFileSync(link, 'someone else');
    await expect(putOnPath(options())).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('asks nothing a second time', async () => {
    await putOnPath(options());
    expect(await putOnPath(options())).toBe(0);
    expect(scripts).toEqual([]);
  });

  it('takes off what it made, and only that', async () => {
    await putOnPath(options());
    expect(await takeOffPath(options())).toBe(0);
    expect(existsSync(link)).toBe(false);
    expect(existsSync(stable())).toBe(false);
    symlinkSync('/somewhere/else', link);
    await takeOffPath(options());
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('makes nothing for a person who never asked, when an app moves', () => {
    followMove(home, COMMAND);
    expect(existsSync(stable())).toBe(false);
  });
});
