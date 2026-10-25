import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installTools, traceProcessor } from '../src/tools.js';

describe('pinned host tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('never unpacks a download whose sha256 is not the pinned one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gd-tools-'));
    vi.stubEnv('APPDYNO_STATE_DIR', dir);
    vi.stubGlobal('fetch', async () => new Response(Buffer.from('not the release')));
    const e = await installTools().catch((x: unknown) => x);
    expect((e as { code?: string }).code).toBe('POLICY_DENIED');
    expect(existsSync(join(dir, 'tools')) ? readdirSync(join(dir, 'tools')) : []).toEqual([]);
  });

  it('says how to install the trace processor when it is missing, and honours an explicit path', async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'gd-tools-')));
    vi.stubEnv('APPDYNO_TRACE_PROCESSOR', '');
    await expect(traceProcessor()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    vi.stubEnv('APPDYNO_TRACE_PROCESSOR', '/opt/tp');
    await expect(traceProcessor()).resolves.toBe('/opt/tp');
  });
});
