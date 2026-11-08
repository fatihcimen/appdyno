import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a script's reckoning, with no types of its own
import { bundledPackages, inlinedPackages, noticesFor } from '../scripts/notices.mjs';

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

describe('what another package inlined', () => {
  /** A bundled file whose build put `inside` in it, as such a build marks it. */
  const inlining = (inside: string[]) => {
    const file = 'node_modules/.pnpm/host@1/node_modules/host/dist/chunk.mjs';
    mkdirSync(join(root, file, '..'), { recursive: true });
    const regions = inside.map(
      (p) => `//#region ../../node_modules/.pnpm/${p}/node_modules/x/index.js`,
    );
    writeFileSync(join(root, file), `${regions.join('\nvar x = 1;\n')}\n`);
    return file;
  };
  const held = join(root, 'held');
  installed('held/kept', 'kept', 'LICENSE');
  installed('held/@s/scoped', '@s/scoped', 'LICENSE');

  it('finds each package by the region its code sits in, with the notice held for it', () => {
    const file = inlining(['kept@1.2.3', '@s+scoped@1.2.3_kept@1.2.3']);
    const folders = inlinedPackages([metafile({ [file]: 40 })], root, held);
    expect(folders.sort()).toEqual([join(held, '@s/scoped'), join(held, 'kept')]);
    expect(noticesFor('', folders)).toContain('@s/scoped 1.2.3 (MIT)\n\nthe terms of @s/scoped');
  });

  it('counts nothing of a file tree-shaking emptied', () => {
    expect(inlinedPackages([metafile({ [inlining(['other@9.9.9'])]: 0 })], root, held)).toEqual([]);
  });

  it('stops a build with no notice held for one, or one of another version, by name', () => {
    const missing = metafile({ [inlining(['other@9.9.9'])]: 1 });
    expect(() => inlinedPackages([missing], root, held)).toThrow(
      /other 9\.9\.9 is inlined .* none/,
    );
    const stale = metafile({ [inlining(['kept@2.0.0'])]: 1 });
    expect(() => inlinedPackages([stale], root, held)).toThrow(
      /kept 2\.0\.0 .* the notice of 1\.2\.3/,
    );
  });
});

describe('what ships', () => {
  const pkg = fileURLToPath(new URL('..', import.meta.url));

  it('has the notice of every package with code in the bundle, inlined in another or not', async () => {
    // the bundle's own entries, from the sources: what is inlined comes from node_modules either way
    const { metafile: shipped } = await build({
      absWorkingDir: pkg,
      tsconfig: 'tsconfig.json',
      platform: 'node',
      format: 'esm',
      target: 'node22',
      entryPoints: ['src/main.ts', 'src/index.ts'],
      bundle: true,
      metafile: true,
      write: false,
      outdir: 'out',
      logLevel: 'silent',
    });
    const inlined = inlinedPackages([shipped], pkg, join(pkg, 'licenses'));
    // what the MCP SDK builds into its own files, which this check must see to be worth anything
    expect(inlined.map((f: string) => f.slice(join(pkg, 'licenses').length + 1))).toContain('ajv');
    expect(() => noticesFor('', [...bundledPackages([shipped], pkg), ...inlined])).not.toThrow();
  });
});
