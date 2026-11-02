import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inCall } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { buildPhase, xcodebuildTelling } from '../src/runner.js';

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
