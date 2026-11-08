import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VIEWER_TEST_FILES } from '../src/index.js';
import { compiled, run, VIEWER } from './viewer-helpers.js';

const built = compiled();

describe('the viewer, compiled by its first-use path', () => {
  it('has no test in what a person runs, and nothing of it in what is published', () => {
    expect(readFileSync(built.binary).includes('--selftest')).toBe(false);
    expect(readFileSync(built.binary).includes('--encode')).toBe(false);
    expect(readFileSync(built.testBinary).includes('--selftest')).toBe(true);
    expect(readdirSync(VIEWER).filter((f) => VIEWER_TEST_FILES.test(f)).length).toBeGreaterThan(5);
  });

  it('passes its self test: real frames, bad input, the sums a window rests on', async ({
    annotate,
  }) => {
    // a failed check exits 1, and it is the lines that say which; one that ends them early is a crash, which says how
    const { stdout, ended } = await run(
      built.testBinary,
      ['--selftest', join(VIEWER, 'fixtures')],
      {
        timeout: 180_000,
      },
    ).then(
      ({ stdout }) => ({ stdout, ended: '' }),
      (failed: unknown) => {
        // what execFile rejects with: the error, with what the binary said
        const e = failed as { stdout: string; stderr: string; code?: number; signal?: string };
        return {
          stdout: e.stdout,
          ended: `it ended by ${e.signal ?? `exit ${String(e.code)}`}: ${e.stderr.slice(-1_000)}`,
        };
      },
    );
    const lines = stdout
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(
      lines.filter((l) => l.ok === false),
      ended,
    ).toEqual([]);
    expect(lines.at(-1), ended).toMatchObject({ selftest: 'done', failed: 0 });
    // what this Mac cannot run is said by name, with why: a check not run never reads as one passed
    for (const l of lines.filter((l) => l.skipped))
      await annotate(`not run here: ${String(l.check)}: ${String(l.skipped)}`, 'notice');
    const named = lines.map((l) => String(l.check));
    expect(named).toContain('nal: random bytes stay in bounds');
    expect(named).toContain('pixels: a size past the file is refused, unread');
    expect(named).toContain('stream: a frame over the limit ends it');
    expect(named).toContain('pasteboard: a viewer kept behind copies to a board of its own');
  }, 200_000);
});
