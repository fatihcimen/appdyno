import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidApps } from '../src/apps.js';

const PKG = 'dev.appdyno.fixture';

describe('an Android app data', () => {
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'app-data-test-'));
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  const screen = {} as ConstructorParameters<typeof AndroidApps>[2];
  /** A phone that answers each shell command by the first rule whose words it holds. */
  const phone = (rules: [string, string][], archive = Buffer.alloc(0)) => {
    const said: string[] = [];
    const adb = {
      exec: async (_: string, c: string) => {
        said.push(c);
        return rules.find(([w]) => c.includes(w))?.[1] ?? '';
      },
      execBuffer: async (_: string, c: string) => {
        said.push(c);
        return archive;
      },
      run: async (args: string[]) => {
        said.push(args.join(' '));
        return '';
      },
    } as unknown as Adb;
    return { said, apps: new AndroidApps(adb, 'phone', screen) };
  };

  it('opens only on a debuggable build, and says what the phone said', async () => {
    const { apps, said } = phone([['true', `run-as: package not debuggable: ${PKG}`]]);
    await expect(apps.downloadData(PKG, folder)).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: expect.stringContaining('debuggable') as string,
    });
    await expect(apps.replaceData(PKG, folder)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(said.every((c) => c.includes('true'))).toBe(true);
  });

  it('downloads into the folder, leaving no archive there', async () => {
    const made = join(folder, 'made');
    mkdirSync(join(made, 'files'), { recursive: true });
    writeFileSync(join(made, 'files', 'a.txt'), 'kept');
    const archive = execFileSync('tar', ['-cf', '-', '-C', made, '.']);
    const to = join(folder, 'to');
    mkdirSync(to);
    await phone([], archive).apps.downloadData(PKG, to);
    expect(readFileSync(join(to, 'files', 'a.txt'), 'utf8')).toBe('kept');
  });

  it('keeps the old data until the app has read the new, and leaves nothing on the phone', async () => {
    writeFileSync(join(folder, 'a.txt'), 'new');
    const { apps, said } = phone([['tar -tf', 'run-as: cannot open']]);
    await expect(apps.replaceData(PKG, folder)).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(said.some((c) => c.includes('rm -rf'))).toBe(false);
    expect(said.at(-1)).toContain('rm -f /data/local/tmp/');
  });

  it('stops the app, empties all but its libraries, and unpacks', async () => {
    writeFileSync(join(folder, 'a.txt'), 'new');
    const { apps, said } = phone([['tar -tf', 'read']]);
    await apps.replaceData(PKG, folder);
    const at = (w: string) => said.findIndex((c) => c.includes(w));
    expect(at('tar -tf')).toBeLessThan(at('am force-stop'));
    expect(at('am force-stop')).toBeLessThan(at('rm -rf'));
    expect(said[at('rm -rf')]).toContain('! -name lib');
    expect(at('rm -rf')).toBeLessThan(at('tar -xf'));
    expect(said.at(-1)).toContain('rm -f /data/local/tmp/');
  });

  it('only empties, given an empty folder', async () => {
    const { apps, said } = phone([]);
    await apps.replaceData(PKG, folder);
    expect(said.some((c) => c.includes('rm -rf'))).toBe(true);
    expect(said.some((c) => c.includes('tar') || c.includes('push'))).toBe(false);
  });
});
