import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installingApp } from '../src/manage.js';

const plist = (platform: string) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleSupportedPlatforms</key><array><string>${platform}</string></array>
</dict></plist>`;

/** An app built for `platform`, in a folder of its own. */
function appFor(platform: string) {
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-app-'));
  const app = join(dir, 'Payload/Thing.app');
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'Info.plist'), plist(platform));
  return { dir, app };
}

const ipaOf = (dir: string) => {
  execFileSync('zip', ['-qry', 'thing.ipa', 'Payload'], { cwd: dir });
  return join(dir, 'thing.ipa');
};

describe('what an iOS device installs', () => {
  it('takes an .app as it is', async () => {
    const { app } = appFor('iPhoneSimulator');
    const given: string[] = [];
    await installingApp(app, 'iPhoneSimulator', async (a) => given.push(a));
    expect(given).toEqual([app]);
  });

  it('takes the app inside an .ipa, and leaves no copy of it', async () => {
    const { dir } = appFor('iPhoneOS');
    let inside = '';
    await installingApp(ipaOf(dir), 'iPhoneOS', async (a) => {
      inside = a;
      expect(execFileSync('ls', [a]).toString()).toContain('Info.plist');
    });
    expect(inside).toMatch(/Payload\/Thing\.app$/);
    expect(() => execFileSync('ls', [inside], { stdio: 'ignore' })).toThrow();
  });

  it('refuses a build for another kind of device, saying which it is for', async () => {
    const { dir } = appFor('iPhoneOS');
    await expect(
      installingApp(ipaOf(dir), 'iPhoneSimulator', async () => undefined),
    ).rejects.toThrow(/is built for iPhoneOS, not for iPhoneSimulator/);
  });

  it('refuses what is neither', async () => {
    await expect(installingApp('/no/such.apk', 'iPhoneOS', async () => undefined)).rejects.toThrow(
      /not a local .app bundle or .ipa/,
    );
  });
});
