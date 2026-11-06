import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { PLATFORMS } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const packages = join(root, 'packages');

/**
 * Outside the drivers, the files that name a platform, and so all a new one can have to touch: a table keyed by
 * `Platform` fails to compile until it has the new one, and the driver's ports are each held whole by the compiler.
 */
const NAMES_A_PLATFORM = [
  'packages/appdyno/src/main.ts',
  'packages/core/src/device.ts',
  'packages/core/src/native.ts',
  'packages/perf/src/dashboard/format.ts',
  'packages/perf/src/dashboard/measures.ts',
  'packages/perf/src/vitals.ts',
  'packages/protocol/src/messages.ts',
];

const sourcesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sourcesIn(p);
    return p.endsWith('.ts') ? [p] : [];
  });

const inPackages = (keep: (name: string) => boolean) =>
  readdirSync(packages)
    .filter((p) => keep(p))
    .flatMap((p) => sourcesIn(join(packages, p, 'src')))
    .map((file) => ({ name: relative(root, file), text: readFileSync(file, 'utf8') }));

const words = PLATFORMS.join('|');
/** A platform as a value, as a key of a table, or leading a kind of device. */
const NAME = new RegExp(`'(${words})['-]|\\b(${words}): '`);
const named = (text: string) => NAME.test(text);

describe('a new platform', () => {
  const shared = inPackages((p) => !p.startsWith('driver-'));

  it('is named only by the files listed', () => {
    expect(shared.length).toBeGreaterThan(100);
    const naming = shared.filter((f) => named(f.text)).map((f) => f.name);
    expect(naming.sort()).toEqual(NAMES_A_PLATFORM);
  });

  it('is never told by what it is not', () => {
    const negated = shared.filter((f) => /platform\s*!==/.test(f.text)).map((f) => f.name);
    expect(negated).toEqual([]);
  });

  it('sees a name however it is written', () => {
    expect(named("x === 'ios'")).toBe(true);
    expect(named("'android-virtual': 'x'")).toBe(true);
    expect(named("{ android: 'Android' }")).toBe(true);
    expect(named('android.widget.Button')).toBe(false);
  });
});

describe('a driver', () => {
  it('words no tool by its name: that is for the operations to say', () => {
    const ops = Object.keys(opsFor(new ServerContext(DEFAULT_POLICY, [])));
    const tools = ops.filter((o) => o.includes('_'));
    expect(tools.length).toBeGreaterThan(10);
    const said = inPackages((p) => p.startsWith('driver-')).flatMap((f) =>
      tools.filter((t) => new RegExp(`\\b${t}\\b`).test(f.text)).map((t) => `${f.name}: ${t}`),
    );
    expect(said).toEqual([]);
  });
});
