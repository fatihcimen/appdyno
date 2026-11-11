import { KINDS } from '@appdyno/perf';
import { describe, expect, it, vi } from 'vitest';
import { keptBy } from '@appdyno/testing/calls.js';
import type { Asked } from './reading-cases.js';
import { FAMILIES, READINGS, type Reading } from './reading-table.js';

// whether this Mac is loaded right now is no part of these answers
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [0, 0, 0],
}));

const keptIn = async ({ tool, args = {}, measures }: Asked) =>
  (await keptBy(tool, args, measures)).kept;

describe('what a reading means', () => {
  it('is said of every kind there is', () => {
    const said = Object.keys(READINGS);
    expect(Object.keys(KINDS).filter((k) => !said.includes(k))).toEqual([]);
    expect(FAMILIES.filter((f) => !said.some((k) => k.startsWith(f)))).toEqual([]);
  });

  describe.each(Object.entries<Reading>(READINGS))('%s', (kind, r) => {
    it.each(r.reads.map((asked) => ({ asked, tool: asked.tool })))(
      `by $tool is ${r.means}`,
      async ({ asked }) => {
        expect((await keptIn(asked)).find((k) => k.kind === kind)?.value).toBe(r.value);
      },
    );

    it.each(Object.entries(r.notRead))('is none when %s', async (_, asked) => {
      if (asked.refused) await expect(keptIn(asked)).rejects.toMatchObject({ code: asked.refused });
      else expect((await keptIn(asked)).map((k) => k.kind)).not.toContain(kind);
    });
  });
});
