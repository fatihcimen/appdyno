import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { must } from '@appdyno/core';
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
const HUB = '@appdyno/hub';
const MCP = '@appdyno/mcp';
const CLI = '@appdyno/cli';
const TESTING = '@appdyno/testing';

/** The workspace packages each package may import. */
const RULES: Record<string, string[]> = {
  protocol: [],
  core: [PROTOCOL],
  'driver-android': [CORE, PROTOCOL],
  'driver-apple': [CORE, PROTOCOL],
  flows: [CORE, PROTOCOL],
  perf: [CORE, PROTOCOL],
  ops: [CORE, PROTOCOL, FLOWS, PERF],
  hub: [OPS, CORE, PROTOCOL, FLOWS, PERF],
  mcp: [OPS, CORE, PROTOCOL],
  cli: [OPS, CORE, PROTOCOL],
  appdyno: [PROTOCOL, CORE, ANDROID, APPLE, PERF, OPS, HUB, MCP, CLI],
  // the fakes every package's tests share, which no source imports
  testing: [PROTOCOL, CORE, ANDROID, APPLE, PERF, OPS, MCP],
};

/** What a package's tests may import on top of its rule: a driver's rules for a fake device, the server to call it through. */
const IN_TESTS: Record<string, string[]> = {
  ops: [ANDROID, APPLE, MCP],
  hub: [ANDROID, APPLE, MCP],
  cli: [MCP],
};

const IMPORT = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

/** The imports of a package's file that its rule forbids, as `file: import`. */
function violations(pkg: string, file: string, source: string): string[] {
  const home = join(packages, pkg);
  const inTest = relative(home, file).startsWith('test');
  const allowed = [...(RULES[pkg] ?? []), ...(inTest ? [TESTING, ...(IN_TESTS[pkg] ?? [])] : [])];
  const bad = [...source.matchAll(IMPORT)]
    .map((m) => must(m[1], 'what it imports'))
    .filter((spec) => {
      if (spec.startsWith('.'))
        return relative(home, resolve(dirname(file), spec)).startsWith('..');
      const workspace = spec === 'appdyno' || /^(@appdyno\/|appdyno\/)/.test(spec);
      // a fake is taken by its own file
      return workspace && !allowed.includes(spec.startsWith(`${TESTING}/`) ? TESTING : spec);
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
    expect(flagged('ops', `import { x } from '${HUB}';`)).toBe(true);
    expect(flagged('hub', `import { x } from '${ANDROID}';`)).toBe(true);
    expect(flagged('hub', `import { x } from '${OPS}';`)).toBe(false);
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
    expect(flagged('cli', `import { x } from '${TESTING}/fake-device.js';`)).toBe(false);
    expect(flagged('cli', `import { x } from '../../../ops/test/power-device.js';`)).toBe(true);
    expect(flagged('ops', `import { x } from '../../src/index.js';`)).toBe(false);
    expect(flagged('ops', `import { x } from '../../../driver-android/src/adb.js';`)).toBe(true);
    expect(flagged('core', `import { x } from '${OPS}';`)).toBe(true);
    expect(flagged('driver-apple', `import { x } from '${ANDROID}';`)).toBe(true);
    // a package's sources are not its tests
    expect(violations('ops', join(packages, 'ops/src/x.ts'), `from '${MCP}';`)).not.toEqual([]);
    expect(
      violations('ops', join(packages, 'ops/src/x.ts'), `from '${TESTING}/fake-device.js';`),
    ).not.toEqual([]);
  });

  it('lets a device suite take a build only by a path the type checker does not follow', () => {
    // a clean clone checks types before anything is built
    const literalDist = (source: string) =>
      [...source.matchAll(IMPORT)].some((m) => must(m[1], 'what it imports').includes('/dist/'));
    const suites = sources(join(root, 'device-tests')).filter((f) =>
      literalDist(readFileSync(f, 'utf8')),
    );
    expect(suites.map((f) => relative(root, f))).toEqual([]);
    expect(literalDist(`await import('../packages/core/dist/index.js')`)).toBe(true);
    expect(literalDist(`await import(join(packages, 'core/dist/index.js'))`)).toBe(false);
  });
});

describe('the picture of the packages', () => {
  // the fakes ship in nothing, and the picture is of what does
  const drawn = Object.entries(RULES).filter(([pkg]) => pkg !== 'testing');
  const picture = readFileSync(join(root, 'docs/images/package-map.svg'), 'utf8');
  const rows = new Map(
    [...picture.matchAll(/data-package="([\w-]+)" data-row="(\d+)"/g)].map((m) => [
      must(m[1], 'a package'),
      Number(m[2]),
    ]),
  );
  const nameOf = (spec: string) => spec.replace('@appdyno/', '');

  it('draws every package, and no other', () => {
    expect([...rows.keys()].sort()).toEqual(drawn.map(([pkg]) => pkg).sort());
  });

  it('draws each package above all it may import', () => {
    const upward = drawn.flatMap(([pkg, imports]) =>
      imports
        .filter((spec) => must(rows.get(nameOf(spec)), spec) <= must(rows.get(pkg), pkg))
        .map((spec) => `${pkg} imports ${spec}`),
    );
    expect(upward).toEqual([]);
  });

  it('shows that only the top package names a driver', () => {
    const naming = drawn.filter(([, imports]) =>
      imports.some((spec) => spec === ANDROID || spec === APPLE),
    );
    expect(naming.map(([pkg]) => pkg)).toEqual(['appdyno']);
  });
});
