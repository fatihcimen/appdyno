import { run, type Measured } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { stat } from 'node:fs/promises';
import { type IosHeap, parseLeaks } from './perf-parse.js';

/** The Mac's leaks tool on a simulator app's process: a graph saved at `path`, and the leaks it found. */
export async function memoryGraph(
  pid: number,
  bundle: string,
  path: string,
): Promise<Measured<IosHeap>> {
  // leaks exits 1 when it found leaks: its answer, not a failure
  const r = await run('leaks', [`--outputGraph=${path}`, String(pid)], {
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  }).catch((e: { stdout?: string; code?: number }) => {
    if (e.code === 1 && e.stdout) return { stdout: e.stdout };
    throw new DeviceError('UNSUPPORTED', `no memory graph of ${bundle}`);
  });
  const { size } = await stat(path);
  // with a graph written the tool prints no summary: the saved graph is read again, offline
  const summary = await run('leaks', [path], {
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  }).then(
    (x) => x.stdout,
    (e: { stdout?: string }) => e.stdout ?? '',
  );
  return {
    value: { file: path, bytes: size, ...parseLeaks(summary) },
    raw: `${r.stdout}\n---\n${summary}`,
    at: new Date().toISOString(),
  };
}
