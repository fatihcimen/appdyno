import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

const IMPORT = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

/** The imports of a package's file that its rule forbids, as `file: import`. */
function violations(pkg: string, file: string, source: string): string[] {
  const allowed = RULES[pkg] ?? [];
  const home = join(packages, pkg);
  const bad = [...source.matchAll(IMPORT)]
    .map((m) => m[1]!)
    .filter((spec) => {
      if (spec.startsWith('.'))
        return relative(home, resolve(dirname(file), spec)).startsWith('..');
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

  it('holds across every source file', () => {
    const files = names.flatMap((pkg) =>
      sources(join(packages, pkg, 'src')).map((file) => ({ pkg, file })),
    );
    expect(files.length).toBeGreaterThan(40);
    const broken = files.flatMap(({ pkg, file }) =>
      violations(pkg, file, readFileSync(file, 'utf8')),
    );
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
].map((parts) => parts.join(''));

const forbiddenIn = (text: string) => {
  const lower = text.toLowerCase();
  return FORBIDDEN.filter((name) => lower.includes(name));
};

describe('the name', () => {
  it('has no trace of the old one, or of any other', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(100);
    expect(tracked).toContain('pnpm-lock.yaml');
    const hits = tracked.flatMap((f) => {
      const p = join(root, f);
      const content = existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'latin1') : '';
      return forbiddenIn(`${f}\n${content}`).map((name) => `${f}: ${name}`);
    });
    expect(hits).toEqual([]);
  });

  it('catches a name in any case', () => {
    expect(forbiddenIn('uses ' + FORBIDDEN[1]!.toUpperCase() + ' here')).toEqual([FORBIDDEN[1]]);
    expect(forbiddenIn('claude mcp add appdyno')).toEqual([]);
  });
});
