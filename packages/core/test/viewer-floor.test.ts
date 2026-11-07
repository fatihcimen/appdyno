import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { VIEWER_TEST_FILES } from '../src/index.js';

/** A Mac at the floor is one nobody here has, so what it lacks fails nowhere but on its owner's screen. */
const root = join(import.meta.dirname, '../../..');
const viewer = join(root, 'mac/Viewer');
const floor = /^const MIN_MACOS = '([\d.]+)';$/m.exec(
  readFileSync(join(root, 'scripts/build-app.mjs'), 'utf8'),
)![1]!;
const sources = readdirSync(viewer).filter((f) => f.endsWith('.m') && !VIEWER_TEST_FILES.test(f));
const SYMBOLS =
  '/System/Library/PrivateFrameworks/SFSymbols.framework/Versions/A/Resources/CoreGlyphs.bundle/Contents/Resources/name_availability.plist';
const COMPILE_MS = 300_000;

describe.runIf(process.platform === 'darwin')(`the viewer at macOS ${floor}`, () => {
  it(
    'calls nothing newer without a guard: it would end the process there',
    async () => {
      const { stderr } = await promisify(execFile)(
        'xcrun',
        [
          'clang',
          '-fobjc-arc',
          '-fsyntax-only',
          `-mmacosx-version-min=${floor}`,
          '-Wunguarded-availability',
          '-Wunguarded-availability-new',
          ...sources,
        ],
        { cwd: viewer, maxBuffer: 64 * 1024 * 1024 },
      );
      expect(stderr.split('\n').filter((line) => line.includes('is only available'))).toEqual([]);
    },
    COMPILE_MS,
  );

  it.skipIf(!existsSync(SYMBOLS))(
    'has an older symbol for each that is newer: none draws blank',
    () => {
      const table = JSON.parse(
        execFileSync('plutil', ['-convert', 'json', '-o', '-', SYMBOLS], {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }),
      ) as { symbols: Record<string, string>; year_to_release: Record<string, { macOS: string }> };
      const texts = sources.map((f) => readFileSync(join(viewer, f), 'utf8'));
      const said = new Set(
        texts.flatMap((t) => [...t.matchAll(/@"([a-z0-9]+(?:\.[a-z0-9]+)+)"/g)].map((m) => m[1]!)),
      );
      const style = readFileSync(join(viewer, 'Style.m'), 'utf8');
      for (const name of said) {
        const year = table.symbols[name];
        if (
          year &&
          Number.parseFloat(table.year_to_release[year]!.macOS) > Number.parseFloat(floor)
        )
          expect(style, name).toContain(`@"${name}": @"`);
      }
    },
  );
});
