import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** One version for the release: the packages, the Android agent, the iOS runner, the MCP server. */
const root = join(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('release version', () => {
  it('is the same everywhere', () => {
    const v = JSON.parse(read('packages/host/package.json')).version as string;
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JSON.parse(read('packages/mcp/package.json')).version).toBe(v);
    expect(JSON.parse(read('packages/protocol/package.json')).version).toBe(v);
    expect(read('android/agent/build.gradle.kts')).toContain(`versionName = "${v}"`);
    expect(read('ios/Runner/RunnerTests.swift')).toContain(`let agentVersion = "${v}"`);
    expect(read('ios/Appdyno.xcodeproj/project.pbxproj')).toContain(
      `MARKETING_VERSION = ${v};`,
    );
    expect(read('packages/mcp/src/brand.ts')).toContain(`version: '${v}'`);
    expect(read('CHANGELOG.md')).toContain(`## ${v}`);
  });
});
