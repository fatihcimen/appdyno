import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAdb, installTools, PLATFORM_TOOLS, traceProcessor } from '../src/tools.js';

describe('pinned host tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('never unpacks a download whose sha256 is not the pinned one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-tools-'));
    vi.stubEnv('APPDYNO_STATE_DIR', dir);
    vi.stubGlobal('fetch', async () => new Response(Buffer.from('not the release')));
    const e = await installTools().catch((x: unknown) => x);
    expect((e as { code?: string }).code).toBe('POLICY_DENIED');
    expect(existsSync(join(dir, 'tools')) ? readdirSync(join(dir, 'tools')) : []).toEqual([]);
  });

  it('says how to install the trace processor when it is missing, and honours an explicit path', async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-tools-')));
    vi.stubEnv('APPDYNO_TRACE_PROCESSOR', '');
    await expect(traceProcessor()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    vi.stubEnv('APPDYNO_TRACE_PROCESSOR', '/opt/tp');
    await expect(traceProcessor()).resolves.toBe('/opt/tp');
  });
});

describe('adb, from Google', () => {
  it('is pinned to terms that let a person take it, and a digest', () => {
    expect(PLATFORM_TOOLS.url).toContain('platform-tools_r37.0.1-darwin.zip');
    expect(PLATFORM_TOOLS.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(PLATFORM_TOOLS.terms).toMatch(/^https:/);
  });

  it('is never unpacked when its digest differs', async () => {
    process.env.APPDYNO_STATE_DIR = mkdtempSync(join(tmpdir(), 'appdyno-adb-'));
    vi.stubGlobal('fetch', async () => new Response(Buffer.from('not the zip')));
    await expect(installAdb()).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(existsSync(join(process.env.APPDYNO_STATE_DIR, 'tools'))).toBe(false);
    vi.unstubAllGlobals();
  });
});
