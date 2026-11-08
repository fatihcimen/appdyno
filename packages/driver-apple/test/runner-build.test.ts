import { chmodSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inCall } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { BUILD_LINE, buildPhase, checkoutBehind, xcodebuildTelling } from '../src/runner-build.js';

describe("a checkout's runner products", () => {
  /** An ios folder with the runner's sources and a build of them, each file made at `at` seconds from now. */
  const checkout = () => {
    const ios = mkdtempSync(join(tmpdir(), 'appdyno-ios-'));
    const at = (file: string, s: number) => {
      const path = join(ios, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '');
      const t = Date.now() / 1000 + s;
      utimesSync(path, t, t);
    };
    for (const f of ['Runner/A.swift', 'RunnerCore/Sources/B.swift', 'Fixture/C.swift']) at(f, 0);
    at('Appdyno.xcodeproj/project.pbxproj', 0);
    at('.derived-device/Build/Products/Runner_iphoneos27.1-arm64.xctestrun', 60);
    return { ios, at, products: join(ios, '.derived-device/Build/Products') };
  };

  it('are behind once a source of the runner changed after they were built, and say the line that builds them', () => {
    const { ios, at, products } = checkout();
    expect(checkoutBehind('device', products, ios)).toBeUndefined();
    // SwiftPM's own folder, and the project's per-person state, are no source
    at('RunnerCore/.build/x.o', 120);
    at('Appdyno.xcodeproj/xcuserdata/me.xcuserstate', 120);
    expect(checkoutBehind('device', products, ios)).toBeUndefined();
    at('RunnerCore/Sources/B.swift', 120);
    expect(checkoutBehind('device', products, ios)).toBe(BUILD_LINE.device);
    expect(BUILD_LINE.device).toContain('-derivedDataPath .derived-device');
  });

  it('are none of this when they are not the checkout’s own', () => {
    const { ios, at } = checkout();
    at('Fixture/C.swift', 120);
    const elsewhere = join(ios, 'elsewhere');
    at('elsewhere/Runner_iphoneos27.1-arm64.xctestrun', 0);
    expect(checkoutBehind('device', elsewhere, ios)).toBeUndefined();
  });
});

describe('the runner build', () => {
  const path = process.env.PATH;
  afterEach(() => {
    process.env.PATH = path;
    vi.restoreAllMocks();
  });

  /** An xcodebuild that prints `output` and ends with `code`. */
  const fakeXcodebuild = (output: string, code: number) => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-xcodebuild-'));
    const bin = join(dir, 'xcodebuild');
    writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${output}\nEOF\nexit ${code}\n`);
    chmodSync(bin, 0o755);
    process.env.PATH = `${dir}:${path}`;
  };

  it('knows a phase from a line of output, and nothing from others', () => {
    expect(
      buildPhase('=== BUILD TARGET Runner OF PROJECT Appdyno WITH CONFIGURATION Debug ==='),
    ).toBe('target Runner');
    expect(buildPhase('SwiftCompile normal arm64 /x/A.swift')).toBe('compiling');
    expect(buildPhase('SwiftExplicitDependencyGeneratePcm arm64 /x/Foundation.pcm')).toBe(
      'compiling',
    );
    expect(buildPhase('Ld /x/Runner normal')).toBe('linking');
    expect(buildPhase('CodeSign /x/Runner.app')).toBe('signing');
    expect(buildPhase('    cd /x')).toBeUndefined();
  });

  it('tells each phase once, to the client and on stderr', async () => {
    fakeXcodebuild(
      [
        '=== BUILD TARGET Runner OF PROJECT Appdyno ===',
        'SwiftCompile normal arm64 /x/A.swift',
        'SwiftCompile normal arm64 /x/B.swift',
        'Ld /x/Runner normal',
        'SwiftCompile normal arm64 /x/C.swift',
      ].join('\n'),
      0,
    );
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const told: string[] = [];
    await inCall({ progress: (m) => told.push(m) }, () => xcodebuildTelling([], 'building'));
    expect(told.map((m) => /: (.*), \d+ s$/.exec(m)?.[1])).toEqual([
      'starting',
      'target Runner',
      'compiling',
      'linking',
    ]);
    expect(stderr).toHaveBeenCalledTimes(told.length);
  });

  it('fails with the last lines of the output', async () => {
    fakeXcodebuild(['one', 'two', '', 'three', 'four', ''].join('\n'), 65);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const failure = await xcodebuildTelling([], 'building').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DeviceError);
    expect((failure as DeviceError).code).toBe('UNSUPPORTED');
    expect((failure as DeviceError).message).toBe('the iOS runner did not build: two three four');
  });

  it('fails when there is no xcodebuild', async () => {
    process.env.PATH = '/nonexistent';
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await expect(xcodebuildTelling([], 'building')).rejects.toThrow(/did not build: .*ENOENT/);
  });
});
