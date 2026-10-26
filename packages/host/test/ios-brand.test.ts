import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandRunner, branded, RUNNER_NAME } from '../src/ios/brand.js';

describe('runner branding', () => {
  it('names the runner appdyno and gives it its icon', async () => {
    const app = join(mkdtempSync(join(tmpdir(), 'gd-brand-')), 'Runner-Runner.app');
    mkdirSync(app);
    writeFileSync(
      join(app, 'Info.plist'),
      '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleName</key><string>Runner-Runner</string></dict></plist>',
    );
    expect(await branded(app)).toBe(false);
    await brandRunner(app);
    expect(await branded(app)).toBe(true);
    const read = (key: string) =>
      execFileSync('plutil', ['-extract', key, 'raw', join(app, 'Info.plist')], {
        encoding: 'utf8',
      }).trim();
    expect(read('CFBundleName')).toBe(RUNNER_NAME);
    expect(read('CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles.0')).toBe('AppIcon60x60');
    expect(existsSync(join(app, 'AppIcon60x60@3x.png'))).toBe(true);
  });
});
