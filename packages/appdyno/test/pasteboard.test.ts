import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const packages = join(root, 'packages');

const sourcesIn = (dir: string, name: RegExp): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourcesIn(p, name);
    return name.test(p) ? [p] : [];
  });

describe("a person's pasteboard", () => {
  /** What runs a test, by a tool of the Mac's: a simulator's own `simctl pbcopy` is its own. */
  const reachesTheMac = (text: string) =>
    /\b(execFile|execFileSync|spawn|spawnSync|exec|execSync)\(\s*['"`]pb(copy|paste)\b|clipboard info|set the clipboard/.test(
      text,
    );
  /** What the viewer writes goes by `MVPlaceBoard`, in that one file: the rest may only read. */
  const writesIt = (line: string) =>
    line.includes('generalPasteboard') && !/stringForType|changeCount/.test(line);

  it('sees what it must', () => {
    expect(reachesTheMac("execFileSync('pbcopy', { input })")).toBe(true);
    expect(reachesTheMac("spawn('xcrun', ['simctl', 'pbcopy', udid])")).toBe(false);
    expect(writesIt('[NSPasteboard.generalPasteboard clearContents];')).toBe(true);
    expect(writesIt('[NSPasteboard.generalPasteboard stringForType:x];')).toBe(false);
  });

  it('is reached by no test or script', () => {
    const tests = [
      join(root, 'device-tests'),
      join(root, 'scripts'),
      ...readdirSync(packages).flatMap((p) => [
        join(packages, p, 'test'),
        join(packages, p, 'scripts'),
      ]),
    ].flatMap((dir) => {
      try {
        return sourcesIn(dir, /\.(ts|mjs|sh)$/);
      } catch {
        return [];
      }
    });
    expect(tests.length).toBeGreaterThan(100);
    const own = join(packages, 'appdyno/test/pasteboard.test.ts');
    expect(
      tests
        .filter((f) => f !== own && reachesTheMac(readFileSync(f, 'utf8')))
        .map((f) => relative(root, f)),
    ).toEqual([]);
  });

  it('is written by no viewer source but the one that keeps a window behind off it', () => {
    const viewer = sourcesIn(join(root, 'mac/Viewer'), /\.(kt|swift|m|h)$/).map((file) => ({
      name: relative(root, file),
      text: readFileSync(file, 'utf8'),
    }));
    expect(viewer.length).toBeGreaterThan(40);
    const writers = viewer
      .filter((f) => f.name !== 'mac/Viewer/Place.m' && f.text.split('\n').some(writesIt))
      .map((f) => f.name);
    expect(writers).toEqual([]);
  });
});
