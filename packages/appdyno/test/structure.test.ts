import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const packages = join(root, 'packages');

const sourcesIn = (dir: string, name: RegExp): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourcesIn(p, name);
    return name.test(p) ? [p] : [];
  });

/** All the native code: what gradle and SwiftPM generate lies outside these folders. */
const NATIVE = [
  'android/agent/src',
  'android/fixture/src',
  'android/push-fixture/src',
  'ios/Fixture',
  'ios/Runner',
  'ios/RunnerCore/Sources',
  'ios/RunnerCore/Tests',
  'ios/SimHelper',
  'mac',
];

const sources = [
  ...readdirSync(packages)
    .filter((p) => statSync(join(packages, p)).isDirectory())
    .flatMap((p) => sourcesIn(join(packages, p, 'src'), /\.ts$/)),
  ...NATIVE.flatMap((dir) => sourcesIn(join(root, dir), /\.(kt|swift|m|h)$/)),
].map((file) => ({ name: relative(root, file), text: readFileSync(file, 'utf8') }));

const lineCount = (text: string) => text.trimEnd().split('\n').length;

const MAX_LINES = 450;
/** Each stays until it is cut: one under the limit fails below. */
const LARGER: Record<string, string> = {};

/** A test file's cap: its cases and fixtures run longer than code does, and it stays one file to read. */
const MAX_TEST_LINES = 800;
/** Each stays until it is cut, as `LARGER` does. */
const LARGER_TESTS: Record<string, string> = {
  'device-tests/android.test.ts':
    'a device suite: no run here checks one split, so it waits for a run on its device',
  'device-tests/evidence.test.ts': 'a device suite, as above',
  'device-tests/driving.test.ts': 'a device suite, as above',
};

const tests = [
  ...readdirSync(packages).map((p) => join(packages, p, 'test')),
  join(root, 'device-tests'),
]
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => sourcesIn(dir, /\.(ts|mjs)$/))
  .map((file) => ({ name: relative(root, file), text: readFileSync(file, 'utf8') }));

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
      // a Kotlin import is whole on its line, and has no `from`
      inImport = !/\bfrom '|^import '|^import\s+[\w.*]+(\s+as\s+\w+)?$/.test(line);
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

describe('the size of a test file', () => {
  it(`stays under ${MAX_TEST_LINES} lines, but for the ones named`, () => {
    expect(tests.length).toBeGreaterThan(300);
    const over = tests
      .filter((f) => lineCount(f.text) > MAX_TEST_LINES && !LARGER_TESTS[f.name])
      .map((f) => `${f.name}: ${lineCount(f.text)}`);
    expect(over).toEqual([]);
  });

  it('names only files that exist and are over the limit', () => {
    const lines = new Map(tests.map((f) => [f.name, lineCount(f.text)]));
    const stale = Object.keys(LARGER_TESTS).filter(
      (name) => (lines.get(name) ?? 0) <= MAX_TEST_LINES,
    );
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

  it('reads on past a Kotlin import', () => {
    expect(logicLines('import a.b.c\nimport a.b.d as e\nimport a.f.*\nval x = 1')).toEqual([
      'val x = 1',
    ]);
    expect(logicLines("import {\n  a,\n} from 'b';\nconst x = 1;")).toEqual(['const x = 1;']);
  });

  it('takes in the native code', () => {
    for (const file of [
      'mac/Viewer/main.m',
      'android/agent/src/main/kotlin/dev/appdyno/agent/Handlers.kt',
      'android/fixture/src/main/kotlin/dev/appdyno/fixture/MainActivity.kt',
      'android/push-fixture/src/main/kotlin/dev/appdyno/pushfixture/PushService.kt',
      'ios/Runner/Device.swift',
      'ios/Fixture/FixtureApp.swift',
      'ios/SimHelper/SimAX.m',
    ])
      expect(sources.some((f) => f.name === file)).toBe(true);
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
