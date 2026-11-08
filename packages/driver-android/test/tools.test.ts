import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { noting } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAdb,
  installTools,
  PERFETTO,
  PLATFORM_TOOLS,
  traceProcessor,
  traceProcessorCheck,
} from '../src/tools.js';

const BIN = 'trace_processor_shell';
const pin = PERFETTO.assets[`${platform()}-${arch()}`];
assert(pin, 'Perfetto has a build for this Mac');
const folder = pin.name.replace(/\.zip$/, '');
const pinned = pin.sha256;

/** A zip laid out as Perfetto's release is, with more in it than is taken. */
function release() {
  const root = mkdtempSync(join(tmpdir(), 'appdyno-release-'));
  mkdirSync(join(root, folder));
  writeFileSync(join(root, folder, BIN), '#!/bin/sh\n');
  writeFileSync(join(root, folder, 'LICENSE'), 'Apache License\n');
  writeFileSync(join(root, folder, 'traceconv'), 'not taken\n');
  execFileSync('zip', ['-q', '-r', 'release.zip', folder], { cwd: root });
  return readFileSync(join(root, 'release.zip'));
}

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

describe('the trace processor, fetched on first need', () => {
  let tools = '';
  let fetches = 0;
  const serve = (body: () => Promise<Response>) => {
    vi.stubGlobal('fetch', () => {
      fetches++;
      return body();
    });
  };

  beforeEach(() => {
    tools = join(mkdtempSync(join(tmpdir(), 'appdyno-tools-')), 'tools');
    fetches = 0;
    vi.stubEnv('APPDYNO_TOOLS_DIR', tools);
    vi.stubEnv('APPDYNO_TRACE_PROCESSOR', '');
    vi.stubEnv('APPDYNO_HELPERS', '');
  });
  afterEach(() => {
    pin.sha256 = pinned;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  /** The release a fake fetch serves, pinned for the test as the real one is. */
  const pinRelease = () => {
    const zip = release();
    pin.sha256 = createHash('sha256').update(zip).digest('hex');
    return zip;
  };

  it('downloads once for the calls that need it at once, takes only it and its license, and says so', async () => {
    const zip = pinRelease();
    serve(() => Promise.resolve(new Response(zip)));
    const [a, b] = await Promise.all([noting(traceProcessor), noting(traceProcessor)]);
    expect(fetches).toBe(1);
    const bin = join(tools, `perfetto-${PERFETTO.version}`, folder, BIN);
    expect([a.value, b.value]).toEqual([bin, bin]);
    expect(statSync(bin).mode & 0o111).not.toBe(0);
    expect(readdirSync(join(tools, `perfetto-${PERFETTO.version}`, folder)).sort()).toEqual([
      'LICENSE',
      BIN,
    ]);
    // nothing half done is left beside it
    expect(readdirSync(tools)).toEqual([`perfetto-${PERFETTO.version}`]);
    for (const { notes } of [a, b]) {
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(
        /^fetched Perfetto's trace processor v59\.1 \(0\.0 MB\) in \d+\.\d s, once/,
      );
    }
    expect(await noting(traceProcessor)).toEqual({ value: bin, notes: [] });
    expect(fetches).toBe(1);
  });

  it('unpacks nothing from a download whose sha256 is not the pinned one, and says how to do without', async () => {
    serve(() => Promise.resolve(new Response(Buffer.from('not the release'))));
    const e = await refusal(traceProcessor());
    assert(e instanceof DeviceError);
    expect(e.code).toBe('POLICY_DENIED');
    expect(e.message).toMatch(/fetching it failed: sha256 mismatch/);
    expect(e.hint).toContain('APPDYNO_TRACE_PROCESSOR');
    expect(existsSync(tools)).toBe(false);
  });

  it('offline, refuses with why and what to do, and fetches on a later call', async () => {
    const zip = pinRelease();
    const offline = new TypeError('fetch failed', {
      cause: new Error('getaddrinfo ENOTFOUND github.com'),
    });
    serve(() => Promise.reject(offline));
    const e = await refusal(traceProcessor());
    assert(e instanceof DeviceError);
    expect(e.code).toBe('OFFLINE');
    expect(e.message).toContain('ENOTFOUND github.com');
    expect(e.hint).toMatch(/internet.*APPDYNO_TRACE_PROCESSOR.*appdyno tools install/);
    serve(() => Promise.resolve(new Response(zip)));
    await expect(traceProcessor()).resolves.toContain(BIN);
    expect(fetches).toBe(2);
  });

  it('a release that is not there is a refusal too', async () => {
    serve(() => Promise.resolve(new Response('', { status: 404 })));
    await expect(traceProcessor()).rejects.toMatchObject({ code: 'OFFLINE' });
  });

  it('uses the one fetched before, the app’s own before it, and APPDYNO_TRACE_PROCESSOR before both, with no fetch', async () => {
    serve(() => Promise.reject(new Error('no fetch')));
    const before = join(tools, `perfetto-${PERFETTO.version}`, folder, BIN);
    mkdirSync(join(before, '..'), { recursive: true });
    writeFileSync(before, '');
    expect(await noting(traceProcessor)).toEqual({ value: before, notes: [] });
    const helpers = mkdtempSync(join(tmpdir(), 'appdyno-app-'));
    writeFileSync(join(helpers, BIN), '');
    vi.stubEnv('APPDYNO_HELPERS', helpers);
    await expect(traceProcessor()).resolves.toBe(join(helpers, BIN));
    vi.stubEnv('APPDYNO_TRACE_PROCESSOR', '/opt/tp');
    await expect(traceProcessor()).resolves.toBe('/opt/tp');
    expect(fetches).toBe(0);
  });

  it('doctor says where it is, or that it comes on first need, and fetches nothing', () => {
    serve(() => Promise.reject(new Error('no fetch')));
    expect(traceProcessorCheck()).toMatchObject({
      ok: true,
      detail: expect.stringContaining('first need') as unknown,
    });
    vi.stubEnv('APPDYNO_TRACE_PROCESSOR', '/opt/tp');
    expect(traceProcessorCheck()).toEqual({ name: 'trace processor', ok: true, detail: '/opt/tp' });
    expect(fetches).toBe(0);
  });

  it('tools install never unpacks a download whose sha256 is not the pinned one', async () => {
    serve(() => Promise.resolve(new Response(Buffer.from('not the release'))));
    await expect(installTools()).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(existsSync(tools)).toBe(false);
  });
});

describe('adb, from Google', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('is pinned to terms that let a person take it, and a digest', () => {
    expect(PLATFORM_TOOLS.url).toContain('platform-tools_r37.0.1-darwin.zip');
    expect(PLATFORM_TOOLS.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(PLATFORM_TOOLS.terms).toMatch(/^https:/);
  });

  it('is never unpacked when its digest differs', async () => {
    const tools = join(mkdtempSync(join(tmpdir(), 'appdyno-adb-')), 'tools');
    vi.stubEnv('APPDYNO_TOOLS_DIR', tools);
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(Buffer.from('not the zip'))));
    await expect(installAdb()).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(existsSync(tools)).toBe(false);
  });
});
