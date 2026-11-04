import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installCheck, installedBy, said } from '../src/installed.js';

const GLOBAL = 'lib/node_modules/tool';

function copyAt(path: string) {
  const root = join(mkdtempSync(join(tmpdir(), 'appdyno-installed-test-')), path);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'tool', version: '1.0.0' }));
  return root;
}

describe('where a copy is installed', () => {
  it.each([
    ['/opt/homebrew/lib/node_modules/tool', { by: 'npm', prefix: '/opt/homebrew' }],
    ['/usr/local/lib/node_modules/tool', { by: 'npm', prefix: '/usr/local' }],
    [
      '/Users/a/.nvm/versions/node/v24.1.0/lib/node_modules/tool',
      { by: 'npm', prefix: '/Users/a/.nvm/versions/node/v24.1.0' },
    ],
    ['/Users/a/Library/pnpm/global/5/.pnpm/tool@1.0.0/node_modules/tool', { by: 'pnpm' }],
    ['/Users/a/Library/pnpm/store/v11/links/@/tool/1.0.0/50b769/node_modules/tool', { by: 'pnpm' }],
  ])('takes %s', (path, place) => {
    expect(installedBy(path, 'tool')).toEqual(place);
  });

  it.each([
    [
      '/Users/a/.npm/_npx/a9bef924e4cb6cdb/node_modules/tool',
      'a one-off npx run',
      /npm install -g/,
    ],
    ['/opt/homebrew/Cellar/tool/1.0.0/libexec/lib/node_modules/tool', 'kept by', /brew upgrade/],
    [
      '/Users/a/.volta/tools/image/packages/tool/lib/node_modules/tool',
      'kept by',
      /what installed/,
    ],
    ['/nix/store/abc-tool-1.0.0/lib/node_modules/tool', 'kept by', /what installed/],
    ['/work/app/node_modules/tool', 'no manager known', /what installed it/],
    ['/work/app/node_modules/.pnpm/tool@1.0.0/node_modules/tool', 'no manager', /what installed/],
  ])('says what to do instead at %s', (path, by, instead) => {
    const place = installedBy(path, 'tool');
    expect(said(place)).toContain(by);
    expect(place).toMatchObject({ instead: expect.stringMatching(instead) });
  });

  it('knows a source checkout by its sources, whatever the path', () => {
    const root = copyAt('work/lib/node_modules/tool');
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/main.ts'), '');
    expect(installedBy(root, 'tool')).toMatchObject({ by: 'a source checkout' });
  });

  it('gives doctor the version, the place and the manager, and starts nothing to do it', () => {
    const root = copyAt(GLOBAL);
    expect(installCheck(root)).toEqual({
      name: 'tool',
      ok: true,
      detail: `1.0.0 at ${root}, installed by npm`,
    });
  });
});
