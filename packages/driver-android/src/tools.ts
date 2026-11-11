import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { arch, homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { DeviceError } from '@appdyno/protocol';
import { type Check, noteInAnswer, reportProgress, run } from '@appdyno/core';

/**
 * Host tools some measurements need, pinned by version and sha256 (the digests the release publishes);
 * a download whose hash differs is never unpacked. A new Perfetto is pinned once every query the driver sends reads
 * the same columns from it, and the launch, frames and trace suites pass with it on an emulator.
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

/** A download that has not finished by then is given up, as a proxy may hold one open with nothing coming. */
const DOWNLOAD_MS = 300_000;
const TRACE_PROCESSOR = 'trace_processor_shell';

/** Downloaded tools: a cache of this Mac, the same whatever state folder a server keeps. */
const toolsDir = () =>
  process.env.APPDYNO_TOOLS_DIR ?? join(homedir(), 'Library/Caches/appdyno/tools');
const toolDir = () => join(toolsDir(), `perfetto-${PERFETTO.version}`);
const adbDir = () => join(toolsDir(), `platform-tools-${PLATFORM_TOOLS.version}`);
/** Where a person's download of adb is. */
export const downloadedAdb = () => join(adbDir(), 'platform-tools/adb');
const asset = () => PERFETTO.assets[`${platform()}-${arch()}`];
/** The folder of a release's zip, which holds its programs. */
const folderOf = (a: { name: string }) => a.name.replace(/\.zip$/, '');

/** The trace processor already on this Mac: APPDYNO_TRACE_PROCESSOR, else the app's own, else the pinned one fetched. */
function foundTraceProcessor(): string | undefined {
  const env = process.env.APPDYNO_TRACE_PROCESSOR;
  if (env) return env;
  const helpers = process.env.APPDYNO_HELPERS;
  const a = asset();
  for (const path of [
    helpers && join(helpers, TRACE_PROCESSOR),
    a && join(toolDir(), folderOf(a), TRACE_PROCESSOR),
  ])
    if (path && existsSync(path)) return path;
  return undefined;
}

/** What `doctor` says of it: where it is, or that it comes on first need. */
export function traceProcessorCheck(): Check {
  const found = foundTraceProcessor();
  if (found) return { name: 'trace processor', ok: true, detail: found };
  if (!asset())
    return {
      name: 'trace processor',
      ok: false,
      warn: true,
      detail: `Perfetto has no build for ${platform()}-${arch()}: Android's traces are not read`,
      fix: `set APPDYNO_TRACE_PROCESSOR to a ${TRACE_PROCESSOR} ${PERFETTO.version}`,
    };
  return {
    name: 'trace processor',
    ok: true,
    detail: `fetched on first need: Perfetto ${PERFETTO.version} from its GitHub release, by its sha256 (appdyno tools install fetches it ahead)`,
  };
}

const UNFETCHED = `connect this Mac to the internet (github.com), or set APPDYNO_TRACE_PROCESSOR to Perfetto's ${TRACE_PROCESSOR} ${PERFETTO.version}, or run appdyno tools install once this Mac has a network`;

/** The one download under way, which every call that needs it waits on. */
let fetching: Promise<string> | undefined;

/**
 * The trace processor. With none on this Mac, the pinned release is fetched once, whoever else needs it meanwhile
 * waits on the same download, and the answer of each call that waited says so.
 */
export async function traceProcessor(): Promise<string> {
  const found = foundTraceProcessor();
  if (found) return found;
  const started = Date.now();
  fetching ??= fetchTraceProcessor().finally(() => {
    fetching = undefined;
  });
  const bin = await fetching;
  const { size } = await stat(bin);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  noteInAnswer(
    `fetched Perfetto's trace processor ${PERFETTO.version} (${(size / 1e6).toFixed(1)} MB) in ${seconds} s, once: later calls find it`,
  );
  return bin;
}

async function fetchTraceProcessor() {
  reportProgress(`fetching Perfetto's trace processor ${PERFETTO.version}, once`);
  try {
    return await installTools();
  } catch (e) {
    if (!(e instanceof DeviceError)) throw e;
    throw new DeviceError(
      e.code,
      `the trace processor is not on this Mac, and fetching it failed: ${e.message}`,
      UNFETCHED,
      { cause: e },
    );
  }
}

/** A file from the network, whole, or a refusal that says why none came. */
async function download(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_MS) });
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    // offline, a proxy that refuses or holds it, a release that is gone: fetch says which in its cause
    const why = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    const said = why instanceof Error ? why.message : String(why);
    throw new DeviceError('OFFLINE', `download failed (${said}): ${url}`);
  }
}

/**
 * A pinned zip's `program` and `notices` into `dir`: one whose hash differs is never unpacked. Each file appears whole,
 * by a rename, the program last, so a process stopped midway leaves nothing that looks installed.
 */
async function fetchPinned(
  url: string,
  sha256: string,
  dir: string,
  program: string,
  notices: string[],
  log: (s: string) => void,
) {
  log(`downloading ${url}`);
  const data = await download(url);
  const sha = createHash('sha256').update(data).digest('hex');
  if (sha !== sha256) throw new DeviceError('POLICY_DENIED', `sha256 mismatch for ${url}: ${sha}`);
  await mkdir(dirname(dir), { recursive: true });
  // beside where it goes, so that a rename never crosses a volume
  const tmp = await mkdtemp(`${dir}.`);
  try {
    const zip = join(tmp, 'download.zip');
    await writeFile(zip, data);
    await run('unzip', ['-q', zip, program, ...notices, '-d', tmp], { timeout: 120_000 });
    await chmod(join(tmp, program), 0o755);
    for (const f of [...notices, program]) {
      await mkdir(dirname(join(dir, f)), { recursive: true });
      await rename(join(tmp, f), join(dir, f));
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * The trace processor this Mac has, the app's own among them, or the pinned Perfetto release's, downloaded, verified
 * and unpacked with its license; returns its path.
 */
export async function installTools(log: (s: string) => void = () => undefined): Promise<string> {
  const found = foundTraceProcessor();
  if (found) return found;
  const a = asset();
  if (!a) throw new DeviceError('UNSUPPORTED', `no Perfetto build for ${platform()}-${arch()}`);
  const dir = toolDir();
  const folder = folderOf(a);
  const bin = join(dir, folder, TRACE_PROCESSOR);
  const url = `https://github.com/google/perfetto/releases/download/${PERFETTO.version}/${a.name}`;
  await fetchPinned(url, a.sha256, dir, `${folder}/${TRACE_PROCESSOR}`, [`${folder}/LICENSE`], log);
  log(`installed ${bin}`);
  return bin;
}

/** Downloads, verifies and unpacks Google's platform-tools, only adb and its notices; returns adb's path. */
export async function installAdb(log: (s: string) => void = () => undefined): Promise<string> {
  const bin = downloadedAdb();
  if (existsSync(bin)) return bin;
  const notices = ['platform-tools/NOTICE.txt'];
  await fetchPinned(
    PLATFORM_TOOLS.url,
    PLATFORM_TOOLS.sha256,
    adbDir(),
    'platform-tools/adb',
    notices,
    log,
  );
  log(`installed ${bin}`);
  return bin;
}
