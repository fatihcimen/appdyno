// A file from the network by curl, tried again where the network failed it on the way.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * curl's exits a later try can get past: a host or a connection not reached, a transfer cut short or timed out, a
 * handshake or a read that failed. Its own --retry takes none of them but a timeout, and a Perfetto release failed on
 * 56, a read cut short, twice. A 404 or a full disk is no such thing.
 */
const TRANSIENT = new Set([6, 7, 18, 28, 35, 52, 55, 56, 92]);

/** @param {string[]} args */
const curlQuietly = (args) => {
  execFileSync('curl', args, { stdio: ['ignore', 'ignore', 'inherit'] });
};

/**
 * `url` to `file`, tried up to `tries` times, 2, 4 then 8 s apart, while it fails as the network does. What a failed try
 * wrote is removed, so no part of a file is left where a later build would take it for the whole.
 * @param {string} url
 * @param {string} file
 * @param {{ tries?: number; curl?: (args: string[]) => void; wait?: (ms: number) => Promise<unknown> }} [how]
 */
export async function download(url, file, { tries = 4, curl = curlQuietly, wait = sleep } = {}) {
  for (let tried = 1; ; tried++) {
    try {
      curl(['-sSfL', '--retry', '3', '-o', file, url]);
      return;
    } catch (e) {
      rmSync(file, { force: true });
      const status = /** @type {{ status?: unknown }} */ (e).status;
      if (tried >= tries || typeof status !== 'number' || !TRANSIENT.has(status)) throw e;
      const ms = 2_000 * 2 ** (tried - 1);
      console.error(`curl exited ${status} on ${url}: trying again in ${ms / 1000} s`);
      await wait(ms);
    }
  }
}
