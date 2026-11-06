import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STEP_IDS, VIEWER_OPS } from '../src/index.js';

const root = join(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** The viewer's own sources: a self test speaks the wire as a parent does. */
const viewer = readdirSync(join(root, 'mirror/Viewer'))
  .filter((f) => f.endsWith('.m') && !/^(SelfTest|Fixtures)/.test(f))
  .map((f) => read(`mirror/Viewer/${f}`))
  .join('\n');

const found = (text: string, name: RegExp) =>
  [...new Set([...text.matchAll(name)].map((m) => m[1]!))].sort();

const sorted = (names: readonly string[]) => [...names].sort();

describe("the viewer's wire", () => {
  it('lists all that the viewer takes, and nothing it does not', () => {
    expect(found(viewer, /\[op isEqual:@"(\w+)"\]/g)).toEqual(sorted(VIEWER_OPS.takes));
  });

  it('lists all that the viewer says, and nothing it does not', () => {
    expect(found(viewer, /@"op"\]?\s*[:=]\s*@"(\w+)"/g)).toEqual(sorted(VIEWER_OPS.says));
  });

  it('is written down, each name once', () => {
    const doc = read('docs/mirror.md');
    const section = doc.slice(doc.indexOf('## The wire'), doc.indexOf('## Stated limits'));
    const [takes, says] = section.split('What it says').map((part) => found(part, /^\| `(\w+)`/gm));
    expect(takes).toEqual(sorted(VIEWER_OPS.takes));
    expect(says).toEqual(sorted(VIEWER_OPS.says));
  });
});

describe('a step of Connect a Phone', () => {
  it('has words in the hub, and the hub has none for what is no step', () => {
    const table = /wordsOf\([^]*?all = @\{([^]*?)\n\s*\};/.exec(read('mirror/Viewer/HubConnect.m'));
    expect(found(table?.[1] ?? '', /@"([\w-]+)": @\[/g)).toEqual(sorted(STEP_IDS));
  });
});
