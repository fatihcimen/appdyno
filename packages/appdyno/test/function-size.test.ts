import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const packages = join(root, 'packages');

const MAX_LINES = 200;
/**
 * Each stays until it is cut: one under the limit fails below. What the rule is for is a closure that holds a class's
 * worth of state, as a file's limit never sees one. These hold little: most are small functions over one context, and
 * each reason says what is long about it.
 */
const LONGER: Record<string, string> = {
  'packages/ops/src/steps.ts stepsFor':
    'finding an element, judging it and one case per kind of step, with no state',
  'packages/ops/src/scroll.ts scrollingFor':
    'three scrolling tools over one context, with no state',
  'packages/ops/src/perf/trace.ts perfTraceOp': 'one op, nearly all of it `run` below',
  'packages/ops/src/perf/trace.ts run':
    'one branch per kind of trace, and each says its own answer',
  'packages/ops/src/timeline/flight.ts startFlight':
    'a recorder, armed and disarmed around one state: its parts have no use apart',
};

type Fn = { name: string; lines: number };

/** What a function is called: by its own name, or what it was given to. */
function nameOf(n: ts.SignatureDeclaration): string {
  const own = n.name?.getText();
  if (own) return own;
  const p = n.parent;
  return ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) ? p.name.getText() : '(no name)';
}

/** Each function of a file with a body, nested ones too: a closure counts by itself and in what holds it. */
function functionsIn(text: string): Fn[] {
  const file = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true);
  const lineOf = (at: number) => file.getLineAndCharacterOfPosition(at).line;
  const found: Fn[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isFunctionLike(n) && 'body' in n && n.body)
      found.push({ name: nameOf(n), lines: lineOf(n.getEnd()) - lineOf(n.getStart()) + 1 });
    ts.forEachChild(n, visit);
  };
  visit(file);
  return found;
}

const sourcesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    // what `src` holds of its own tests is a test's
    if (statSync(p).isDirectory()) return f === 'test' ? [] : sourcesIn(p);
    return p.endsWith('.ts') ? [p] : [];
  });

const functions = readdirSync(packages)
  .filter((p) => statSync(join(packages, p)).isDirectory())
  .flatMap((p) => sourcesIn(join(packages, p, 'src')))
  .flatMap((file) =>
    functionsIn(readFileSync(file, 'utf8')).map((f) => ({
      key: `${relative(root, file)} ${f.name}`,
      lines: f.lines,
    })),
  );

describe('the size of a function', () => {
  it(`stays under ${MAX_LINES} lines, but for the ones named`, () => {
    expect(functions.length).toBeGreaterThan(1_000);
    const over = functions
      .filter((f) => f.lines > MAX_LINES && !LONGER[f.key])
      .map((f) => `${f.key}: ${f.lines}`);
    expect(over).toEqual([]);
  });

  it('names only functions that exist and are over the limit', () => {
    const longest = new Map<string, number>();
    for (const f of functions) longest.set(f.key, Math.max(f.lines, longest.get(f.key) ?? 0));
    const stale = Object.keys(LONGER).filter((key) => (longest.get(key) ?? 0) <= MAX_LINES);
    expect(stale).toEqual([]);
  });

  it('sees a function however it was written', () => {
    const body = Array.from({ length: 5 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    const text = [
      `function plain() {\n${body}\n}`,
      `const arrow = () => {\n${body}\n};`,
      `class Holder {\n  method() {\n${body}\n  }\n}`,
      `const table = { entry: async () => {\n${body}\n} };`,
    ].join('\n');
    const found = functionsIn(text);
    expect(found.map((f) => f.name)).toEqual(['plain', 'arrow', 'method', 'entry']);
    expect(found.every((f) => f.lines === 7)).toBe(true);
    expect(functionsIn('declare function bodiless(): void;')).toEqual([]);
  });

  it('counts a closure by itself and in what holds it', () => {
    const inner = `const inner = () => {\n  return 1;\n};`;
    expect(functionsIn(`function outer() {\n${inner}\n}`)).toEqual([
      { name: 'outer', lines: 5 },
      { name: 'inner', lines: 3 },
    ]);
  });
});
