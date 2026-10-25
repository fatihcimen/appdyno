import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { arch, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DeviceError } from '@appdyno/protocol';
import { stateDir } from './android/agent.js';

const run = promisify(execFile);

/**
 * Host tools some measurements need, pinned by version and sha256 (the digests the release publishes);
 * a download whose hash differs is never unpacked.
 */
export const PERFETTO = {
  version: 'v58.2',
  assets: {
    'darwin-arm64': {
      name: 'mac-arm64.zip',
      sha256: '9dbd484a32c9833c95cf58ca5ef86d2c9ad4767149054ad4eaa52bdf027d1507',
    },
    'darwin-x64': {
      name: 'mac-amd64.zip',
      sha256: '1ec01f5de30fbf3b4e91c2b96508e3f537f0f57d1d1ce4bdf0892c98c4de039c',
    },
    'linux-arm64': {
      name: 'linux-arm64.zip',
      sha256: 'a82bf4111a340a7ea8577bcfd62e014e8e81b9e6a35a3190f5415fb800051ab0',
    },
    'linux-x64': {
      name: 'linux-amd64.zip',
      sha256: '32c739f71b2d39721afd294c0b038f2499a44a71b5b6bcdd85b83faca0b240b9',
    },
  } as Record<string, { name: string; sha256: string }>,
} as const;

const toolDir = () => join(stateDir(), 'tools', `perfetto-${PERFETTO.version}`);
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

/** Downloads, verifies and unpacks the pinned Perfetto release; returns the trace processor's path. */
export async function installTools(log: (s: string) => void = () => undefined): Promise<string> {
  const a = asset();
  if (!a) throw new DeviceError('UNSUPPORTED', `no Perfetto build for ${platform()}-${arch()}`);
  const dir = toolDir();
  const bin = join(dir, a.name.replace(/\.zip$/, ''), 'trace_processor_shell');
  if (existsSync(bin)) return bin;
  const url = `https://github.com/google/perfetto/releases/download/${PERFETTO.version}/${a.name}`;
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new DeviceError('INTERNAL', `download failed: ${res.status} ${url}`);
  const data = Buffer.from(await res.arrayBuffer());
  const sha = createHash('sha256').update(data).digest('hex');
  if (sha !== a.sha256)
    throw new DeviceError('POLICY_DENIED', `sha256 mismatch for ${a.name}: ${sha}`);
  const tmp = await mkdtemp(join(tmpdir(), 'appdyno-tools-'));
  try {
    const zip = join(tmp, a.name);
    await writeFile(zip, data);
    await mkdir(dir, { recursive: true });
    await run('unzip', ['-o', '-q', zip, '-d', dir], { timeout: 120_000 });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  await chmod(bin, 0o755);
  log(`installed ${bin}`);
  return bin;
}
