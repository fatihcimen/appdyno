import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { arch, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceError } from '@appdyno/protocol';
import { run, stateDir } from '@appdyno/core';

/**
 * Host tools some measurements need, pinned by version and sha256 (the digests the release publishes);
 * a download whose hash differs is never unpacked.
 */
export const PERFETTO = {
  version: 'v59.1',
  assets: {
    'darwin-arm64': {
      name: 'mac-arm64.zip',
      sha256: '91b2cb63c706526a2c067c219115f9f044fa8467459868757bae15c97906037f',
    },
    'darwin-x64': {
      name: 'mac-amd64.zip',
      sha256: '392cb203372f8904a138d7f5e0d5c6163b1657cb772b6036807bbb8247bcdadd',
    },
    'linux-arm64': {
      name: 'linux-arm64.zip',
      sha256: '8f59e2cf7197c8de388ab4765a650eaf1774a405b1753c54a9741910b6f11350',
    },
    'linux-x64': {
      name: 'linux-amd64.zip',
      sha256: '7deb8c2572c6ae7ec80cd719d388041079827b0c44a1659694d5d88faa4f501e',
    },
  } as Record<string, { name: string; sha256: string }>,
} as const;

/**
 * Google's own zip. Its terms forbid passing it on, and its adb holds LGPL code, so the app does not ship it: a person
 * takes it from Google, agreeing to these terms. r37.0.1, as r37.0.2 came under the preview terms.
 */
export const PLATFORM_TOOLS = {
  version: '37.0.1',
  url: 'https://dl.google.com/android/repository/platform-tools_r37.0.1-darwin.zip',
  sha256: 'ee39ad5967e95c2a07f04dbcbde96b1a0c916ba376096db5d2f498b7727a5d1d',
  terms: 'https://developer.android.com/studio/terms',
} as const;

const toolDir = () => join(stateDir(), 'tools', `perfetto-${PERFETTO.version}`);
const adbDir = () => join(stateDir(), 'tools', `platform-tools-${PLATFORM_TOOLS.version}`);
/** Where a person's download of adb is. */
export const downloadedAdb = () => join(adbDir(), 'platform-tools/adb');
const asset = () => PERFETTO.assets[`${platform()}-${arch()}`];

/** The trace processor binary: APPDYNO_TRACE_PROCESSOR, else the installed pinned one. */
export async function traceProcessor(): Promise<string> {
  const env = process.env.APPDYNO_TRACE_PROCESSOR;
  if (env) return env;
  const a = asset();
  const path = a && join(toolDir(), a.name.replace(/\.zip$/, ''), 'trace_processor_shell');
  if (path && existsSync(path)) return path;
  throw new DeviceError(
    'UNSUPPORTED',
    'the trace processor is not installed',
    'run: appdyno tools install (downloads the pinned Perfetto release)',
  );
}

/** A pinned zip into `dir`: one whose hash differs is never unpacked. */
async function fetchPinned(
  url: string,
  sha256: string,
  dir: string,
  files: string[],
  log: (s: string) => void,
) {
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new DeviceError('INTERNAL', `download failed: ${res.status} ${url}`);
  const data = Buffer.from(await res.arrayBuffer());
  const sha = createHash('sha256').update(data).digest('hex');
  if (sha !== sha256) throw new DeviceError('POLICY_DENIED', `sha256 mismatch for ${url}: ${sha}`);
  const tmp = await mkdtemp(join(tmpdir(), 'appdyno-tools-'));
  try {
    const zip = join(tmp, 'download.zip');
    await writeFile(zip, data);
    await mkdir(dir, { recursive: true });
    await run('unzip', ['-o', '-q', zip, ...files, '-d', dir], { timeout: 120_000 });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Downloads, verifies and unpacks the pinned Perfetto release; returns the trace processor's path. */
export async function installTools(log: (s: string) => void = () => undefined): Promise<string> {
  const a = asset();
  if (!a) throw new DeviceError('UNSUPPORTED', `no Perfetto build for ${platform()}-${arch()}`);
  const dir = toolDir();
  const bin = join(dir, a.name.replace(/\.zip$/, ''), 'trace_processor_shell');
  if (existsSync(bin)) return bin;
  const url = `https://github.com/google/perfetto/releases/download/${PERFETTO.version}/${a.name}`;
  await fetchPinned(url, a.sha256, dir, [], log);
  await chmod(bin, 0o755);
  log(`installed ${bin}`);
  return bin;
}

/** Downloads, verifies and unpacks Google's platform-tools, only adb and its notices; returns adb's path. */
export async function installAdb(log: (s: string) => void = () => undefined): Promise<string> {
  const bin = downloadedAdb();
  if (existsSync(bin)) return bin;
  const files = ['platform-tools/adb', 'platform-tools/NOTICE.txt'];
  await fetchPinned(PLATFORM_TOOLS.url, PLATFORM_TOOLS.sha256, adbDir(), files, log);
  await chmod(bin, 0o755);
  log(`installed ${bin}`);
  return bin;
}
