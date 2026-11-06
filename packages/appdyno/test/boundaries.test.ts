import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { CLIENTS } from '@appdyno/cli';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const packages = join(root, 'packages');

const PROTOCOL = '@appdyno/protocol';
const CORE = '@appdyno/core';
const ANDROID = '@appdyno/driver-android';
const APPLE = '@appdyno/driver-apple';
const FLOWS = '@appdyno/flows';
const PERF = '@appdyno/perf';
const OPS = '@appdyno/ops';
const MCP = '@appdyno/mcp';
const CLI = '@appdyno/cli';

/** The workspace packages each package may import. */
const RULES: Record<string, string[]> = {
  protocol: [],
  core: [PROTOCOL],
  'driver-android': [CORE, PROTOCOL],
  'driver-apple': [CORE, PROTOCOL],
  flows: [CORE, PROTOCOL],
  perf: [CORE, PROTOCOL],
  ops: [CORE, PROTOCOL, FLOWS, PERF],
  mcp: [OPS, CORE, PROTOCOL],
  cli: [OPS, CORE, PROTOCOL],
  appdyno: [PROTOCOL, CORE, ANDROID, APPLE, PERF, OPS, MCP, CLI],
};

/** What a package's tests may import on top of its rule: a driver's rules for a fake device, the server to call it through. */
const IN_TESTS: Record<string, string[]> = {
  ops: [ANDROID, APPLE, MCP],
  cli: [MCP],
};

const IMPORT = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

/** The imports of a package's file that its rule forbids, as `file: import`. */
function violations(pkg: string, file: string, source: string): string[] {
  const home = join(packages, pkg);
  const inTest = relative(home, file).startsWith('test');
  const allowed = [...(RULES[pkg] ?? []), ...(inTest ? (IN_TESTS[pkg] ?? []) : [])];
  const bad = [...source.matchAll(IMPORT)]
    .map((m) => m[1]!)
    .filter((spec) => {
      if (spec.startsWith('.')) {
        const to = relative(home, resolve(dirname(file), spec));
        // tests may share another package's fake, and reach nothing else of it but through its package
        return to.startsWith('..') && !(inTest && /^\.\.\/[^/]+\/test\//.test(to));
      }
      const workspace = spec === 'appdyno' || /^(@appdyno\/|appdyno\/)/.test(spec);
      return workspace && !allowed.includes(spec);
    });
  return bad.map((spec) => `${relative(root, file)}: ${spec}`);
}

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.ts') ? [p] : [];
  });

describe('module boundaries', () => {
  const names = readdirSync(packages).filter((p) => existsSync(join(packages, p, 'package.json')));

  it('has a rule for every package', () => {
    expect(names.filter((p) => !RULES[p])).toEqual([]);
    expect(names.sort()).toEqual(Object.keys(RULES).sort());
  });

  it('holds across every source file, and every test', () => {
    const files = names.flatMap((pkg) =>
      ['src', 'test'].flatMap((dir) =>
        existsSync(join(packages, pkg, dir))
          ? sources(join(packages, pkg, dir)).map((file) => ({ pkg, file }))
          : [],
      ),
    );
    expect(files.length).toBeGreaterThan(40);
    expect(files.filter(({ file }) => file.includes('/test/')).length).toBeGreaterThan(40);
    const broken = files
      // this file writes down what is forbidden, to see it caught
      .filter(({ file }) => file !== import.meta.filename)
      .flatMap(({ pkg, file }) => violations(pkg, file, readFileSync(file, 'utf8')));
    expect(broken).toEqual([]);
  });

  it('catches what it is there to catch', () => {
    const file = (pkg: string) => join(packages, pkg, 'src/x.ts');
    const flagged = (pkg: string, line: string) => violations(pkg, file(pkg), line).length > 0;
    expect(flagged('ops', `import { AndroidDevice } from '${ANDROID}';`)).toBe(true);
    expect(flagged('driver-apple', `import type { Adb } from "${ANDROID}";`)).toBe(true);
    expect(flagged('driver-android', `export * from '${APPLE}';`)).toBe(true);
    expect(flagged('core', `const x = await import('${OPS}');`)).toBe(true);
    expect(flagged('protocol', `import '${CORE}';`)).toBe(true);
    expect(flagged('perf', `import { x } from '${OPS}';`)).toBe(true);
    expect(flagged('perf', `import { x } from '${ANDROID}';`)).toBe(true);
    expect(flagged('ops', `import { x } from '${PERF}';`)).toBe(false);
    expect(flagged('mcp', `import { x } from 'appdyno';`)).toBe(true);
    expect(flagged('cli', `import { x } from '../../driver-android/src/adb.js';`)).toBe(true);
    expect(flagged('core', `import { x } from './screen/index.js';`)).toBe(false);
    expect(flagged('driver-apple', `import { x } from '${CORE}';`)).toBe(false);
    expect(flagged('appdyno', `import { x } from '${ANDROID}';`)).toBe(false);
  });

  it('holds a test to it too, but for what a test needs', () => {
    const flagged = (pkg: string, line: string) =>
      violations(pkg, join(packages, pkg, 'test/a/x.test.ts'), line).length > 0;
    expect(flagged('ops', `import { x } from '${ANDROID}';`)).toBe(false);
    expect(flagged('ops', `import { x } from '${MCP}';`)).toBe(false);
    expect(flagged('cli', `import { x } from '../../../ops/test/fake-device.js';`)).toBe(false);
    expect(flagged('ops', `import { x } from '../../src/index.js';`)).toBe(false);
    expect(flagged('ops', `import { x } from '../../../driver-android/src/adb.js';`)).toBe(true);
    expect(flagged('core', `import { x } from '${OPS}';`)).toBe(true);
    expect(flagged('driver-apple', `import { x } from '${ANDROID}';`)).toBe(true);
    // a package's sources are not its tests
    expect(violations('ops', join(packages, 'ops/src/x.ts'), `from '${MCP}';`)).not.toEqual([]);
  });
});

/**
 * `ops` holds two things: operations, knotted together, and the hub's controller in `mirror/`, which reaches into them
 * and never the other way. What the rest of `ops` takes from that folder is this, by the file that takes it: what the
 * package lets out, and the two operations in it that a client calls. A second way in is a package split made harder.
 */
const MIRROR_WAY_IN: Record<string, string[]> = {
  'index.ts': ['hub.js', 'history.js', 'parent.js'],
  'registry.ts': ['handoff.js', 'op.js'],
};

/** What `file`, of `ops` and outside `mirror/`, takes from that folder and its rule does not name. */
function intoMirror(file: string, source: string): string[] {
  const allowed = MIRROR_WAY_IN[file] ?? [];
  return [...source.matchAll(IMPORT)]
    .map((m) => m[1]!)
    .filter((spec) => spec.startsWith('.'))
    .map((spec) => relative('/', resolve('/', dirname(file), spec)))
    .filter((to) => to.startsWith('mirror/') && !allowed.includes(to.slice('mirror/'.length)))
    .map((to) => `${file}: ${to}`);
}

describe('the hub in ops', () => {
  const src = join(packages, 'ops/src');

  it('is reached from the rest of the package by the ways its rule names, and no other', () => {
    const outside = sources(src)
      .map((file) => relative(src, file))
      .filter((file) => !file.startsWith('mirror/'));
    expect(outside.length).toBeGreaterThan(40);
    expect(
      outside.flatMap((file) => intoMirror(file, readFileSync(join(src, file), 'utf8'))),
    ).toEqual([]);
  });

  it('names only ways in that are there', () => {
    const named = Object.entries(MIRROR_WAY_IN).flatMap(([file, ways]) =>
      ways.map((way) => [file, way] as const),
    );
    expect(
      named.filter(
        ([file, way]) => !readFileSync(join(src, file), 'utf8').includes(`./mirror/${way}`),
      ),
    ).toEqual([]);
  });

  it('catches a measure reaching in, and a way in from a file of no rule', () => {
    expect(intoMirror('perf/shared.ts', `import { x } from '../mirror/session.js';`)).toEqual([
      'perf/shared.ts: mirror/session.js',
    ]);
    expect(intoMirror('watch.ts', `import { x } from './mirror/hub.js';`)).toEqual([
      'watch.ts: mirror/hub.js',
    ]);
    expect(intoMirror('index.ts', `export { runHub } from './mirror/hub.js';`)).toEqual([]);
    expect(intoMirror('index.ts', `export { x } from './mirror/pair.js';`)).toEqual([
      'index.ts: mirror/pair.js',
    ]);
    expect(intoMirror('watch.ts', `import { x } from './mirror-state.js';`)).toEqual([]);
  });
});

// joined here so that this file passes itself
describe('the phone stream', () => {
  const driver = join(packages, 'driver-apple/src');
  const outside = readdirSync(driver).filter((f) => f.endsWith('.ts'));

  it('is named by one file, by one reckoned path, and its folder can go', () => {
    const naming = outside.filter((f) =>
      readFileSync(join(driver, f), 'utf8').includes('phone-stream/'),
    );
    // `record.ts` only asks if it is there
    expect(naming.sort()).toEqual(['mirror-phone.ts', 'phone-stream-port.ts', 'record.ts']);
    const text = readFileSync(join(driver, 'mirror-phone.ts'), 'utf8');
    // a literal import would stop a build with the folder gone
    expect(text).not.toMatch(/from '\.\/phone-stream\//);
    expect(text).not.toMatch(/import\('\.\/phone-stream/);
    expect(readFileSync(join(driver, 'phone-stream-port.ts'), 'utf8')).not.toMatch(
      /from '\.\/phone-stream\//,
    );
  });

  it('nothing else in the workspace reaches into it', () => {
    const tracked = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );
    const offenders = tracked
      .split('\n')
      .map((f) => join(root, f))
      .filter(
        (f) =>
          /\.(ts|mjs)$/.test(f) &&
          !f.includes('/phone-stream/') &&
          existsSync(f) &&
          !f.endsWith('mirror-phone.ts') &&
          !f.endsWith('phone-stream-port.ts') &&
          !f.endsWith('driver-apple/src/record.ts') &&
          !f.endsWith('bundle.mjs') &&
          !f.endsWith('vitest.config.ts') &&
          !f.endsWith('boundaries.test.ts') &&
          readFileSync(f, 'utf8').includes('phone-stream/'),
      );
    expect(offenders).toEqual([]);
  });
});

/** What the clients are called has to be written somewhere, and only here: the list, and how to set each up. */
const CLIENT_DATA = ['packages/cli/src/clients.ts', 'docs/clients.md', 'docs/clients.tr.md'];

const trackedFiles = () =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((f) => existsSync(join(root, f)) && statSync(join(root, f)).isFile());

describe('a client', () => {
  it('has its name and folders in those files, and in no other', () => {
    const tracked = trackedFiles();
    expect(tracked.length).toBeGreaterThan(100);
    expect(tracked).toEqual(expect.arrayContaining(CLIENT_DATA));
    const marks = CLIENTS.flatMap((c) => [
      ...c.name.split(' and ').map((name) => new RegExp(`\\b${name}\\b`)),
      ...c.files.map((f) => new RegExp(f.replaceAll('.', '\\.'))),
    ]);
    expect(marks.length).toBeGreaterThan(CLIENTS.length);
    const hits = tracked
      .filter((f) => !CLIENT_DATA.includes(f) && !f.endsWith('.apk') && !/\.(png|jpg|jar)$/.test(f))
      .flatMap((f) => {
        const text = readFileSync(join(root, f), 'latin1');
        return marks.filter((m) => m.test(text)).map((m) => `${f}: ${m.source}`);
      });
    expect(hits).toEqual([]);
  });
});
