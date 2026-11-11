import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');

const sourcesIn = (dir: string, name: RegExp): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourcesIn(p, name);
    return name.test(p) ? [p] : [];
  });

describe('the Xcode project', () => {
  it('builds every Swift source of the runner and the fixture', () => {
    const project = readFileSync(join(root, 'ios/Appdyno.xcodeproj/project.pbxproj'), 'utf8');
    const swift = ['ios/Fixture', 'ios/Runner', 'ios/RunnerCore/Sources']
      .flatMap((dir) => sourcesIn(join(root, dir), /\.swift$/))
      .map((file) => relative(join(root, 'ios'), file));
    expect(swift.length).toBeGreaterThan(20);
    expect(swift.filter((file) => !project.includes(`path = "${file}"`))).toEqual([]);
  });
});
