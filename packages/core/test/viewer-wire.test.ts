import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { must } from '../src/must.js';
import { STEP_IDS, VIEWER_OPS, VIEWER_TEST_FILES } from '../src/index.js';

const root = join(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** The viewer's own sources: a self test speaks the wire as a parent does. */
const viewer = readdirSync(join(root, 'mac/Viewer'))
  .filter((f) => f.endsWith('.m') && !VIEWER_TEST_FILES.test(f))
  .map((f) => read(`mac/Viewer/${f}`))
  .join('\n');

const found = (text: string, name: RegExp) =>
  [...new Set([...text.matchAll(name)].map((m) => must(m[1], name.source)))].sort();

const sorted = (names: readonly string[]) => [...names].sort();

describe("the viewer's wire", () => {
  it('lists all that the viewer takes, and nothing it does not', () => {
    expect(found(viewer, /\[op isEqual:@"(\w+)"\]/g)).toEqual(sorted(VIEWER_OPS.takes));
  });

  it('lists all that the viewer says, and nothing it does not', () => {
    expect(found(viewer, /@"op"\]?\s*[:=]\s*@"(\w+)"/g)).toEqual(sorted(VIEWER_OPS.says));
  });

  it('is written down, each name once', () => {
    const doc = read('docs/reference/mirror-internals.md');
    const section = doc.slice(doc.indexOf('## The wire'), doc.indexOf('## Limits'));
    const [takes, says] = section.split('What it says').map((part) => found(part, /^\| `(\w+)`/gm));
    expect(takes).toEqual(sorted(VIEWER_OPS.takes));
    expect(says).toEqual(sorted(VIEWER_OPS.says));
  });
});

/** Each member of one of the wire's types by its name, with its fields; an open one, of an index signature, has none. */
function fieldsOf(alias: 'ViewerMessage' | 'ViewerOrder') {
  const file = join(root, 'packages/core/src/mirror/viewer-wire.ts');
  const program = ts.createProgram([file], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const declared = must(program.getSourceFile(file), 'the wire').statements.find(
    (s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === alias,
  );
  const type = checker.getTypeAtLocation(must(declared, alias).name);
  const fields = new Map<string, Set<string> | 'open'>();
  for (const member of type.isUnion() ? type.types : [type]) {
    const op = checker.getTypeOfSymbol(must(member.getProperty('op'), 'its op'));
    const name = (op as ts.StringLiteralType).value;
    const own = checker
      .getPropertiesOfType(member)
      .map((p) => p.name)
      .filter((p) => p !== 'op' && p !== 'stage');
    const was = fields.get(name);
    if (was === 'open' || checker.getIndexInfosOfType(member).length > 0) fields.set(name, 'open');
    else fields.set(name, new Set([...(was ?? []), ...own]));
  }
  return fields;
}

/** Each dictionary the viewer writes with an `op` of its own, with the keys written in it. */
function literalsIn(text: string): { op: string; keys: string[] }[] {
  const found: { op: string; keys: string[] }[] = [];
  for (const start of text.matchAll(/@\{\s*@"op":\s*@"(\w+)"/g)) {
    const keys: string[] = [];
    let depth = 0;
    for (let i = must(start.index, 'where'); i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        const end = text.indexOf('"', i + 1);
        // a key opens the dictionary or follows a comma in it; a string before a colon elsewhere is a ternary's
        const key =
          depth === 1 && /[{,]\s*@$/.test(text.slice(0, i)) && /^\s*:/.test(text.slice(end + 1));
        if (key) keys.push(text.slice(i + 1, end));
        i = end;
      } else if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    found.push({
      op: must(start[1], 'its op'),
      keys: keys.filter((k) => k !== 'op' && k !== 'stage'),
    });
  }
  return found;
}

/** What this side tells the viewer that no code of the viewer reads: each stays until the wire drops it. */
const UNREAD = ['element.selector', 'measured.kept', 'network.was', 'tick.seq'];

describe("the fields of the viewer's wire", () => {
  const says = fieldsOf('ViewerMessage');
  const takes = fieldsOf('ViewerOrder');
  const names = (pattern: RegExp) =>
    new Set([...viewer.matchAll(pattern)].map((m) => must(m[1] ?? m[2], 'a name')));
  // what it reads it reads by key; what it writes is a key of a dictionary, or one set in it
  const read = names(/\[@"(\w+)"\]/g);
  const written = names(/@"(\w+)":|\[@"(\w+)"\] =/g);

  it('has a member for every name', () => {
    expect([...says.keys()].sort()).toEqual(sorted(VIEWER_OPS.says));
    expect([...takes.keys()].sort()).toEqual(sorted(VIEWER_OPS.takes));
  });

  it('gives what the viewer says each field it writes', () => {
    const literals = literalsIn(viewer);
    expect(literals.length).toBeGreaterThan(50);
    const unknown = literals.flatMap(({ op, keys }) => {
      const fields = says.get(op);
      return fields === 'open' ? [] : keys.filter((k) => !fields?.has(k)).map((k) => `${op}.${k}`);
    });
    expect(unknown).toEqual([]);
  });

  it('has no field the viewer does not write, nor one it is sent and does not read, but those named', () => {
    const missing = (fields: Map<string, Set<string> | 'open'>, has: Set<string>) =>
      [...fields].flatMap(([op, own]) =>
        own === 'open' ? [] : [...own].filter((f) => !has.has(f)).map((f) => `${op}.${f}`),
      );
    expect(missing(says, written)).toEqual([]);
    expect(missing(takes, read).sort()).toEqual(UNREAD);
  });
});

describe('a step of Connect a Phone', () => {
  it('has words in the hub, and the hub has none for what is no step', () => {
    const table = /wordsOf\([^]*?all = @\{([^]*?)\n\s*\};/.exec(read('mac/Viewer/HubConnect.m'));
    expect(found(table?.[1] ?? '', /@"([\w-]+)": @\[/g)).toEqual(sorted(STEP_IDS));
  });
});
