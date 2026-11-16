import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shardOf } from '../../src/index.js';
import { inShard } from '../../src/flow/shard.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { flowsFor, flowHelpers } from './harness.js';

const same = (name: string) => name;

describe('a split of files', () => {
  const names = ['b/x.flow', 'a.flow', 'Z.flow', 'ç.flow', 'a/x.flow', 'c.flow', 'b.flow'];
  const parts = (all: string[], n: number) =>
    Array.from({ length: n }, (_, k) => inShard(all, same, { i: k + 1, n }));

  it('puts every file in exactly one part', () => {
    for (const n of [1, 2, 3, 7]) expect(parts(names, n).flat().sort()).toEqual([...names].sort());
  });

  it('is the same whatever order the files came in, and keeps that order within a part', () => {
    const turned = names.toReversed();
    expect(parts(turned, 3).map((p) => [...p].sort())).toEqual(
      parts(names, 3).map((p) => [...p].sort()),
    );
    expect(inShard(names, same, { i: 1, n: 2 })).toEqual([
      'b/x.flow',
      'Z.flow',
      'ç.flow',
      'a/x.flow',
    ]);
  });

  it('leaves a part empty where there are more parts than files', () => {
    expect(parts(['a.flow', 'b.flow'], 4).map((p) => p.length)).toEqual([1, 1, 0, 0]);
  });

  it('reads i/n, from 1, and nothing else', () => {
    expect(shardOf('2/4')).toEqual({ i: 2, n: 4 });
    for (const words of ['0/4', '5/4', '2', '2/', 'a/b', '1/0', '-1/2', '1/2/3'])
      expect(shardOf(words), words).toBeUndefined();
  });
});

describe('a part of a test run', () => {
  let dir: string;
  let device: FakeDevice;
  const { context } = flowHelpers(
    () => device,
    () => dir,
  );
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-shard-'));
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
    device = new FakeDevice();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  /** Two folders with a file of one name in each, and one more: what a part runs of them. */
  const run = async (i: number, n: number) => {
    const files = ['a/smoke.flow', 'b/smoke.flow', 'c.flow'].map((f) => {
      mkdirSync(join(dir, 'flows', f, '..'), { recursive: true });
      writeFileSync(join(dir, 'flows', f), 'app dev.app\nopen_link "app://x"\n');
      return join(dir, 'flows', f);
    });
    const artifacts = join(dir, `part-${i}`);
    const lines: string[] = [];
    const r = await flowsFor(context()).test({
      files,
      devices: [],
      artifacts,
      shard: { i, n },
      log: (l) => lines.push(l),
    });
    return { ...r, lines, artifacts, xml: readFileSync(join(artifacts, 'junit.xml'), 'utf8') };
  };

  it('runs its files alone, each named as in the whole run, and says which part it is', async () => {
    const one = await run(1, 2);
    const two = await run(2, 2);
    expect(one.record.cases.map((c) => c.label)).toEqual(['a/smoke.flow', 'c.flow']);
    expect(two.record.cases.map((c) => c.label)).toEqual(['b/smoke.flow']);
    expect(one.record.shard).toEqual({ i: 1, n: 2 });
    expect(one.lines[0]).toBe('shard 1/2: 2 of 3 files');
    expect(one.xml).toContain('<testsuites name="shard 1/2" tests="2"');
    expect(one.xml).toContain('<property name="appdyno.shard" value="1/2"/>');
    expect(readFileSync(join(one.artifacts, 'verdict.txt'), 'utf8')).toMatch(
      /^PASS: 2 passed, 0 flaky, 0 failed on 1 device in \d+s, shard 1\/2\n/,
    );
    expect(readFileSync(join(one.artifacts, 'index.html'), 'utf8')).toContain('shard 1/2');
  });

  it('passes with nothing run where no file falls to it, and opens no device', async () => {
    const r = await run(4, 4);
    expect(r.passed).toBe(true);
    expect(r.record).toMatchObject({
      verdict: 'PASS',
      cases: [],
      devices: [],
      shard: { i: 4, n: 4 },
    });
    expect(r.lines[0]).toBe('shard 4/4: 0 of 3 files');
    expect(device.calls).toEqual([]);
    expect(existsSync(join(r.artifacts, 'run.json'))).toBe(true);
    expect(r.xml).toContain('<testsuites name="shard 4/4" tests="0"');
  });
});
