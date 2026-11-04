import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const packages = join(root, 'packages');

const sourcesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourcesIn(p);
    return p.endsWith('.ts') ? [p] : [];
  });

/** Native code that is ours and grows: the viewer, and what the agent streams with. */
const AGENT = join(root, 'android/agent/src/main/kotlin/dev/appdyno/agent');
const nativeIn = (dir: string, name: RegExp) =>
  readdirSync(dir)
    .filter((f) => name.test(f))
    .map((f) => join(dir, f));

const native = [
  ...nativeIn(join(root, 'mirror/Viewer'), /\.(m|h)$/),
  ...nativeIn(AGENT, /^(Stream|DisplayMirror)/),
];

const sources = [
  ...readdirSync(packages)
    .filter((p) => statSync(join(packages, p)).isDirectory())
    .flatMap((p) => sourcesIn(join(packages, p, 'src'))),
  ...native,
].map((file) => ({ name: relative(root, file), text: readFileSync(file, 'utf8') }));

const lineCount = (text: string) => text.trimEnd().split('\n').length;

const MAX_LINES = 450;
/** Each stays until it is cut: one under the limit fails below. */
const LARGER: Record<string, string> = {
  'packages/ops/src/steps.ts':
    'one closure: the steps share its context, answers and recorder, and are read together',
};

const RUN_LINES = 8;

/** A file's lines as they read: no indentation, no blank lines, no comments, no imports. */
function logicLines(text: string): string[] {
  const out: string[] = [];
  let inImport = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (inImport) {
      if (/\bfrom '/.test(line)) inImport = false;
      continue;
    }
    // a native file opens with the framework imports every other one has
    if (/^#(import|include|pragma)\b/.test(line)) continue;
    if (/^import\b/.test(line)) {
      inImport = !/\bfrom '|^import '/.test(line);
      continue;
    }
    if (line && !/^(\/\/|\/\*|\*)/.test(line)) out.push(line);
  }
  return out;
}

/** Each run of `size` lines that appears twice, with where it was first seen and seen again. */
function repeatedRuns(files: { name: string; text: string }[], size: number): string[] {
  const first = new Map<string, string>();
  const repeats: string[] = [];
  for (const { name, text } of files) {
    const lines = logicLines(text);
    for (let i = 0; i + size <= lines.length; i++) {
      const run = lines.slice(i, i + size).join('\n');
      const seen = first.get(run);
      if (seen) repeats.push(`${seen} and ${name}:\n${run}`);
      else first.set(run, name);
    }
  }
  return repeats;
}

describe('the size of a file', () => {
  it(`stays under ${MAX_LINES} lines, but for the ones named`, () => {
    expect(sources.length).toBeGreaterThan(100);
    const over = sources
      .filter((f) => lineCount(f.text) > MAX_LINES && !LARGER[f.name])
      .map((f) => `${f.name}: ${lineCount(f.text)}`);
    expect(over).toEqual([]);
  });

  it('names only files that exist and are over the limit', () => {
    const lines = new Map(sources.map((f) => [f.name, lineCount(f.text)]));
    const stale = Object.keys(LARGER).filter((name) => (lines.get(name) ?? 0) <= MAX_LINES);
    expect(stale).toEqual([]);
  });
});

describe('repeated code', () => {
  it(`has no run of ${RUN_LINES} lines twice in the sources`, () => {
    expect(repeatedRuns(sources, RUN_LINES)).toEqual([]);
  });

  it('sees a run whatever its indentation, comments or imports', () => {
    const body = (pad: string) =>
      Array.from({ length: RUN_LINES }, (_, i) => `${pad}const v${i} = ${i};`).join('\n');
    const a = { name: 'a.ts', text: `import { x } from 'y';\n${body('')}` };
    const b = { name: 'b.ts', text: `// a comment\n\n${body('    ')}\n` };
    expect(repeatedRuns([a, b], RUN_LINES)).toHaveLength(1);
    expect(repeatedRuns([a, { name: 'c.ts', text: 'const other = 1;' }], RUN_LINES)).toEqual([]);
  });

  it('counts the imports of a native file as nothing, and its code as code', () => {
    const imports = Array.from({ length: RUN_LINES + 1 }, (_, i) => `#import <F${i}.h>`).join('\n');
    expect(logicLines(imports)).toEqual([]);
    const body = Array.from({ length: RUN_LINES }, (_, i) => `  int v${i} = ${i};`).join('\n');
    const twice = [
      { name: 'a.m', text: `${imports}\n${body}` },
      { name: 'b.m', text: `${imports}\n${body}` },
    ];
    expect(repeatedRuns(twice, RUN_LINES)).toHaveLength(1);
  });

  it('takes in the viewer', () => {
    expect(sources.some((f) => f.name.endsWith('mirror/Viewer/main.m'))).toBe(true);
  });

  it('counts neither a long import nor a comment as code', () => {
    const list = Array.from({ length: RUN_LINES + 2 }, (_, i) => `  name${i},`).join('\n');
    const longImport = `import {\n${list}\n} from 'somewhere';\n`;
    const a = { name: 'a.ts', text: longImport };
    const b = { name: 'b.ts', text: longImport };
    expect(repeatedRuns([a, b], RUN_LINES)).toEqual([]);
    expect(logicLines('// one\n/** two */\n * three\nconst four = 4;')).toEqual([
      'const four = 4;',
    ]);
  });
});
