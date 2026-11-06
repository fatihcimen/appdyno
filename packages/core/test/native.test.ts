import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inCheckout, NATIVE_PARTS, nativeBinary, nativeFile, NeedError } from '../src/index.js';

const root = join(import.meta.dirname, '../../..');

describe('a native part', () => {
  it.each([
    ['viewer', 'main.m'],
    ['mac', 'TextScan.m'],
    ['ios', 'Appdyno.xcodeproj'],
    ['ios', 'SimHelper/SimHID.m'],
    ['ios', 'Branding'],
  ] as const)('%s has %s where the list says', (part, file) => {
    expect(existsSync(join(root, NATIVE_PARTS[part].repo, file))).toBe(true);
    expect(nativeFile(part, file)).toBe(join(root, NATIVE_PARTS[part].repo, file));
  });

  it('knows a checkout by the project in it, so a folder of that name is no checkout', () => {
    expect(inCheckout('ios')).toBe(join(root, 'ios'));
    expect(NATIVE_PARTS.agent.repo).toMatch(/^android\//);
  });

  it('says what is missing, and from where', () => {
    expect(() => nativeFile('mac', 'NoSuch.m')).toThrow('NoSuch.m is missing from this install');
  });
});

describe('a compile', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('with no compiler says what a person needs', async () => {
    vi.stubEnv('PATH', '/nowhere');
    await expect(
      nativeBinary({
        name: 'x',
        sources: [nativeFile('mac', 'TextScan.m')],
        flags: ['--no-such-flag', String(Date.now())],
      }),
    ).rejects.toBeInstanceOf(NeedError);
  });
});
