import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const packages = join(root, 'packages');

describe('the phone stream', () => {
  const driver = join(packages, 'driver-apple/src');
  const outside = readdirSync(driver).filter((f) => f.endsWith('.ts'));

  it('is named by one file, by one reckoned path, and its folder can go', () => {
    const naming = outside.filter((f) =>
      readFileSync(join(driver, f), 'utf8').includes('phone-stream/'),
    );
    // `record.ts` only asks if it is there
    expect(naming.sort()).toEqual(['mirror-phone.ts', 'phone-stream-port.ts', 'record.ts']);
    const text = readFileSync(join(driver, 'mirror-phone.ts'), 'utf8');
    // a literal import would stop a build with the folder gone
    expect(text).not.toMatch(/from '\.\/phone-stream\//);
    expect(text).not.toMatch(/import\('\.\/phone-stream/);
    expect(readFileSync(join(driver, 'phone-stream-port.ts'), 'utf8')).not.toMatch(
      /from '\.\/phone-stream\//,
    );
  });

  it('nothing else in the workspace reaches into it', () => {
    const tracked = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    const offenders = tracked
      .split('\n')
      .map((f) => join(root, f))
      .filter(
        (f) =>
          /\.(ts|mjs)$/.test(f) &&
          !f.includes('/phone-stream/') &&
          existsSync(f) &&
          !f.endsWith('mirror-phone.ts') &&
          !f.endsWith('phone-stream-port.ts') &&
          !f.endsWith('driver-apple/src/record.ts') &&
          !f.endsWith('bundle.mjs') &&
          !f.endsWith('vitest.config.ts') &&
          !f.endsWith('phone-stream.test.ts') &&
          readFileSync(f, 'utf8').includes('phone-stream/'),
      );
    expect(offenders).toEqual([]);
  });
});
