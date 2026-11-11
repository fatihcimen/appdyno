import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { differences, filled, inputsOf, PAGES } from '../scripts/tools-table.mjs';

const root = join(import.meta.dirname, '../../..');
const ops = opsFor(new ServerContext(DEFAULT_POLICY, []));

describe('the tables of tools in the reference', () => {
  for (const page of PAGES)
    it(`lists in ${page.page} every tool, once, with the inputs its schema takes`, () => {
      expect(differences(readFileSync(join(root, page.page), 'utf8'), ops, page)).toEqual([]);
    });

  it('writes an input as a reader needs it: required in bold, then its values or its default', () => {
    const op = {
      input: z.object({
        kind: z.enum(['a', 'b']),
        read: z.enum(['diff', 'none']).default('diff'),
        timeoutMs: z.number().default(5000),
        also: z.array(z.enum(['x', 'y'])).optional(),
        text: z.string().optional(),
      }),
    };
    expect(inputsOf(op, 'default')).toBe(
      '**`kind`**: `a`, `b`; `read`: `diff` (default), `none`; `timeoutMs`: `5000` (default); `also`: `x`, `y`; `text`',
    );
    expect(inputsOf({ input: z.object({}) }, 'default')).toBe('–');
  });

  it('sees a tool missing, one too many, and inputs that differ, and writes them right', () => {
    const page = { heading: '## Every tool', word: 'default' };
    const some = { tap: { input: z.object({ x: z.number() }) }, swipe: { input: z.object({}) } };
    const text = [
      '## Every tool',
      '',
      '| tool | what it does | inputs |',
      '| --- | --- | --- |',
      '| `tap` | taps | `y` |',
      '| `gone` | was | – |',
      '',
      '## Next',
    ].join('\n');
    expect(differences(text, some, page)).toEqual([
      'swipe: no row',
      'tap: `y`, where its schema takes **`x`**',
      'gone: no such tool',
    ]);
    expect(filled(text, some, page)).toContain('| `tap` | taps | **`x`** |');
  });
});
