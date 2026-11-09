import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const { download } = (await import(join(root, 'scripts/download.mjs'))) as {
  download: (
    url: string,
    file: string,
    how?: {
      tries?: number;
      curl?: (args: string[]) => void;
      wait?: (ms: number) => Promise<unknown>;
    },
  ) => Promise<void>;
};

/** A curl that writes part of the file and exits with each status in turn, then writes it whole. */
const flaky = (statuses: number[]) => {
  const tried: string[][] = [];
  const curl = (args: string[]) => {
    tried.push(args);
    const file = args[args.indexOf('-o') + 1] ?? '';
    const status = statuses[tried.length - 1];
    writeFileSync(file, status === undefined ? 'whole' : 'part');
    if (status === undefined) return;
    throw Object.assign(new Error(`curl exited ${status}`), { status });
  };
  const waits: number[] = [];
  const wait = (ms: number) => Promise.resolve(waits.push(ms));
  return { tried, curl, waits, wait };
};

describe("the app build's downloads", () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'appdyno-download-')), 'perfetto.zip');

  it('try again after a read cut short, waiting longer each time, and keep only the whole file', async () => {
    const to = file();
    const { tried, curl, waits, wait } = flaky([56, 56]);
    await download('https://example.test/mac-arm64.zip', to, { curl, wait });
    expect(tried).toHaveLength(3);
    expect(waits).toEqual([2_000, 4_000]);
    expect(readFileSync(to, 'utf8')).toBe('whole');
  });

  it('give up after their last try, leaving no part where the next build would take it whole', async () => {
    const to = file();
    const { tried, curl, waits, wait } = flaky([56, 7, 28, 56]);
    await expect(download('https://example.test/a.zip', to, { curl, wait })).rejects.toThrow(
      'curl exited 56',
    );
    expect(tried).toHaveLength(4);
    expect(waits).toEqual([2_000, 4_000, 8_000]);
    expect(existsSync(to)).toBe(false);
  });

  it('try no more what no later try changes, a release not there', async () => {
    const to = file();
    const { tried, curl, waits, wait } = flaky([22]);
    await expect(download('https://example.test/gone.zip', to, { curl, wait })).rejects.toThrow(
      'curl exited 22',
    );
    expect([tried.length, waits]).toEqual([1, []]);
    expect(existsSync(to)).toBe(false);
  });
});
