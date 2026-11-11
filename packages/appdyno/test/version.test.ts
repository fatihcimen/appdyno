import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** One version for the release: the packages, the Android agent, the iOS runner, the MCP server. */
const root = join(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

type Package = { identifier: string; version: string };
type Manifest = { name: string; mcpName: string; keywords: string[] };

describe('release version', () => {
  it('is the same everywhere', () => {
    const { version: v } = JSON.parse(read('packages/appdyno/package.json')) as { version: string };
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    for (const p of readdirSync(join(root, 'packages')))
      if (existsSync(join(root, 'packages', p, 'package.json')))
        expect(JSON.parse(read(`packages/${p}/package.json`)), p).toHaveProperty('version', v);
    expect(read('android/agent/build.gradle.kts')).toContain(`versionName = "${v}"`);
    expect(read('ios/Runner/RunnerTests.swift')).toContain(`let agentVersion = "${v}"`);
    expect(read('ios/Appdyno.xcodeproj/project.pbxproj')).toContain(`MARKETING_VERSION = ${v};`);
    expect(read('packages/mcp/src/brand.ts')).toContain(`version: '${v}'`);
    expect(read('CHANGELOG.md')).toContain(`## ${v}`);
    expect(read('CHANGELOG.tr.md')).toContain(`## ${v}`);
    const server = JSON.parse(read('server.json')) as { version: string; packages: Package[] };
    expect(server.version).toBe(v);
    expect(server.packages.map((p) => p.version)).toEqual([v]);
  });

  it('is the one package the MCP registry lists, as npm has it', () => {
    const manifest = JSON.parse(read('packages/appdyno/package.json')) as Manifest;
    const server = JSON.parse(read('server.json')) as {
      name: string;
      description: string;
      packages: Package[];
    };
    expect(server.name).toBe(manifest.mcpName);
    expect(server.packages.map((p) => p.identifier)).toEqual([manifest.name]);
    // the registry's limit
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(manifest.keywords).toEqual(
      expect.arrayContaining(['mcp', 'mcp-server', 'ios', 'android']),
    );
  });

  it('names the repository a release is published from, which update holds it to', () => {
    const { repository } = JSON.parse(read('packages/appdyno/package.json')) as {
      repository: { url: string };
    };
    expect(repository.url).toBe('git+https://github.com/fatihcimen/appdyno.git');
  });

  it('signs the app with one identity, and calls nothing short of notarized a release', () => {
    // each of these stops before anything is built
    const refusal = (env: Record<string, string>, ...flags: string[]) =>
      spawnSync(process.execPath, [join(root, 'scripts/build-app.mjs'), ...flags], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, ...env },
      }).stderr;
    const ours = { APPDYNO_SIGN_IDENTITY: 'Developer ID Application: Fatih Cimen (BKXMF846AT)' };
    expect(refusal({ APPDYNO_SIGN_IDENTITY: 'Apple Distribution: Another' })).toContain(
      `only ${ours.APPDYNO_SIGN_IDENTITY} signs this app`,
    );
    expect(refusal({ APPDYNO_NOTARY_PROFILE: 'p' })).toContain('notarizing needs');
    expect(refusal({}, '--release')).toContain('a release is signed and notarized');
    expect(refusal(ours, '--release')).toContain('a release is signed and notarized');
  });

  it('leaves this Mac only with its Android agent, which a build goes on without', () => {
    const { prepack } = (
      JSON.parse(read('packages/appdyno/package.json')) as { scripts: { prepack: string } }
    ).scripts;
    const folder = mkdtempSync(join(tmpdir(), 'appdyno-prepack-'));
    const packs = () => spawnSync('sh', ['-c', prepack], { cwd: folder, stdio: 'ignore' }).status;
    expect(packs()).toBe(1);
    mkdirSync(join(folder, 'agents/android'), { recursive: true });
    writeFileSync(join(folder, 'agents/android/agent.apk'), '');
    expect(packs()).toBe(0);
  });
});
