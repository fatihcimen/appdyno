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

// joined here so that this file passes itself
const FORBIDDEN = [
  ['get', 'ir'],
  ['mobile', '-mcp'],
  ['mobile', 'cli'],
  ['mobile', 'next'],
  ['agent', '-device'],
  ['agent', 'device'],
  ['call', 'stack'],
  ['device', 'kit'],
  ['anth', 'ropic'],
  ['co', '-authored'],
  ['super', 'powers'],
  ['sub', 'agent'],
  ['worktree', '-agent'],
  ['clau', 'de'],
].map((parts) => parts.join(''));

/** What the clients on a Mac are called has to be written somewhere, and only there. */
const CLIENT_DATA = 'packages/cli/src/clients.ts';
const IN_CLIENT_DATA = FORBIDDEN.at(-1);

const forbiddenIn = (text: string) => {
  const lower = text.toLowerCase();
  return FORBIDDEN.filter((name) => lower.includes(name));
};

const hitsIn = (file: string, text: string) =>
  forbiddenIn(`${file}\n${text}`)
    .filter((name) => !(file === CLIENT_DATA && name === IN_CLIENT_DATA))
    .map((name) => `${file}: ${name}`);

const trackedFiles = () =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((f) => existsSync(join(root, f)) && statSync(join(root, f)).isFile());

describe('the name', () => {
  it('has no trace of the old one, or of any other', () => {
    const tracked = trackedFiles();
    expect(tracked.length).toBeGreaterThan(100);
    expect(tracked).toContain('pnpm-lock.yaml');
    expect(tracked).toContain(CLIENT_DATA);
    const hits = tracked.flatMap((f) => hitsIn(f, readFileSync(join(root, f), 'latin1')));
    expect(hits).toEqual([]);
  });

  it('catches a name in any case', () => {
    expect(forbiddenIn('uses ' + FORBIDDEN[1]!.toUpperCase() + ' here')).toEqual([FORBIDDEN[1]]);
    expect(forbiddenIn('npx -y appdyno mcp')).toEqual([]);
  });

  it('lets the clients’ data file alone name a client, and nothing else in it', () => {
    const client = `uses ${IN_CLIENT_DATA}`;
    expect(hitsIn(CLIENT_DATA, client)).toEqual([]);
    expect(hitsIn('README.md', client)).toEqual([`README.md: ${IN_CLIENT_DATA}`]);
    expect(hitsIn('packages/cli/src/install.ts', client)).not.toEqual([]);
    expect(hitsIn(CLIENT_DATA, `uses ${FORBIDDEN[1]}`)).toEqual([
      `${CLIENT_DATA}: ${FORBIDDEN[1]}`,
    ]);
  });

  it('keeps a client’s name and folders in that one file', () => {
    const marks = CLIENTS.flatMap((c) => [
      new RegExp(`\\b${c.name}\\b`),
      ...c.files.map((f) => new RegExp(f.replaceAll('.', '\\.'))),
    ]);
    expect(marks.length).toBeGreaterThan(CLIENTS.length);
    const hits = trackedFiles()
      .filter((f) => f !== CLIENT_DATA && !f.endsWith('.apk') && !/\.(png|jpg|jar)$/.test(f))
      .flatMap((f) => {
        const text = readFileSync(join(root, f), 'latin1');
        return marks.filter((m) => m.test(text)).map((m) => `${f}: ${m.source}`);
      });
    expect(hits).toEqual([]);
  });
});
