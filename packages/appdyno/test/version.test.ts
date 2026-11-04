import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** One version for the release: the packages, the Android agent, the iOS runner, the MCP server. */
const root = join(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('release version', () => {
  it('is the same everywhere', () => {
    const v = JSON.parse(read('packages/appdyno/package.json')).version as string;
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    for (const p of readdirSync(join(root, 'packages')))
      if (existsSync(join(root, 'packages', p, 'package.json')))
        expect(JSON.parse(read(`packages/${p}/package.json`)).version, p).toBe(v);
    expect(read('android/agent/build.gradle.kts')).toContain(`versionName = "${v}"`);
    expect(read('ios/Runner/RunnerTests.swift')).toContain(`let agentVersion = "${v}"`);
    expect(read('ios/Appdyno.xcodeproj/project.pbxproj')).toContain(`MARKETING_VERSION = ${v};`);
    expect(read('packages/mcp/src/brand.ts')).toContain(`version: '${v}'`);
    expect(read('CHANGELOG.md')).toContain(`## ${v}`);
  });

  it('names the repository a release is published from, which update holds it to', () => {
    const { repository } = JSON.parse(read('packages/appdyno/package.json')) as {
      repository: { url: string };
    };
    expect(repository.url).toBe('git+https://github.com/fatihcimen/appdyno.git');
  });
});
