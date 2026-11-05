import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a script's reckoning, with no types of its own
import { bundledPackages, noticesFor } from '../scripts/notices.mjs';

const root = mkdtempSync(join(tmpdir(), 'appdyno-notices-'));

/** A package as a store holds it, with a license file under `file`, or none. */
const installed = (path: string, name: string, file?: string) => {
  const folder = join(root, path);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, 'package.json'),
    JSON.stringify({ name, version: '1.2.3', license: 'MIT' }),
  );
  if (file) writeFileSync(join(folder, file), `the terms of ${name}\n`);
  return folder;
};

const metafile = (inputs: Record<string, number>) => ({
  outputs: {
    'dist/main.js': {
      inputs: Object.fromEntries(
        Object.entries(inputs).map(([input, bytesInOutput]) => [input, { bytesInOutput }]),
      ),
    },
  },
});

describe('what a copy of the bundle carries', () => {
  it('finds each package with code in the output, and none shaken out', () => {
    const found = bundledPackages(
      [
        metafile({
          'node_modules/.pnpm/a@1/node_modules/a/lib/x.js': 10,
          'node_modules/.pnpm/a@1/node_modules/a/lib/y.js': 5,
          'node_modules/.pnpm/s+b@2_a@1/node_modules/@s/b/index.js': 7,
          'node_modules/.pnpm/gone@1/node_modules/gone/index.js': 0,
          'src/main.ts': 900,
        }),
      ],
      '/repo',
    );
    expect(found.sort()).toEqual([
      '/repo/node_modules/.pnpm/a@1/node_modules/a',
      '/repo/node_modules/.pnpm/s+b@2_a@1/node_modules/@s/b',
    ]);
  });

  it('counts each package once across two bundles', () => {
    const one = metafile({ 'node_modules/a/x.js': 1 });
    expect(bundledPackages([one, one], '/repo')).toHaveLength(1);
  });

  it('puts the repository’s notices first, then each package with its name, version and terms', () => {
    const text = noticesFor('our own notices\n', [
      installed('zeta', 'zeta', 'LICENSE'),
      installed('alpha', 'alpha', 'license.md'),
    ]);
    expect(text.startsWith('our own notices')).toBe(true);
    expect(text).toContain('alpha 1.2.3 (MIT)\n\nthe terms of alpha');
    expect(text).toContain('zeta 1.2.3 (MIT)\n\nthe terms of zeta');
    expect(text.indexOf('alpha 1.2.3')).toBeLessThan(text.indexOf('zeta 1.2.3'));
    expect(text.endsWith('\n')).toBe(true);
  });

  it('stops a build that could not pass a notice on, by name', () => {
    expect(() => noticesFor('', [installed('bare', 'bare')])).toThrow(/bare 1\.2\.3 .* no license/);
  });
});
