import { describe, expect, it } from 'vitest';
import {
  junitXml,
  MergeError,
  mergeRecords,
  RunRecord,
  suitesOf,
  verdictOf,
} from '../src/index.js';
import { aCase, aRecord, failed } from './record-fixture.js';

describe("a run's verdict", () => {
  it('passes when every case passed, a flaky one too', () => {
    expect(verdictOf([aCase('a.flow'), aCase('b.flow', { outcome: 'flaky' })])).toEqual({
      verdict: 'PASS',
      why: [],
    });
  });

  it('fails for a case that failed or did not run, and says how many', () => {
    const v = verdictOf([
      aCase('a.flow'),
      failed('b.flow'),
      aCase('c.flow', { outcome: 'not_run' }),
    ]);
    expect(v).toEqual({ verdict: 'FAIL', why: ['1 failed', '1 not run'] });
  });

  it('fails for a flaky case only where asked', () => {
    const flaky = [aCase('a.flow', { outcome: 'flaky' })];
    expect(verdictOf(flaky, { failOnFlaky: true })).toEqual({
      verdict: 'FAIL',
      why: ['failed by --fail-on-flaky: 1 flaky'],
    });
  });

  it('fails for a teardown that failed under a case that passed', () => {
    const left = aCase('a.flow', {
      teardown: { ok: false, failed: ['teardown line 2, step 1: x'] },
    });
    expect(verdictOf([left])).toEqual({ verdict: 'FAIL', why: ['1 teardown failed'] });
  });
});

describe('records merged', () => {
  const shard = (i: number, n: number, labels: string[]) =>
    aRecord(
      labels.map((l) => aCase(l)),
      { shard: { i, n } },
    );

  it('are one record of every case: shards on the same serial with different files', () => {
    const whole = mergeRecords([shard(1, 2, ['a.flow', 'c.flow']), shard(2, 2, ['b.flow'])]);
    expect(whole.cases.map((c) => c.label)).toEqual(['a.flow', 'c.flow', 'b.flow']);
    expect(whole.verdict).toBe('PASS');
    expect(whole.shard).toBeUndefined();
    expect(whole.devices).toHaveLength(1);
    expect(whole.contents.shots).toBe(2);
    expect(RunRecord.parse(whole)).toEqual(whole);
  });

  it('fail when a part failed, and when a shard of the split is not among them', () => {
    const bad = aRecord([failed('b.flow')], { shard: { i: 2, n: 2 } });
    expect(mergeRecords([shard(1, 2, ['a.flow']), bad]).why).toEqual(['1 failed']);
    const short = mergeRecords([shard(1, 3, ['a.flow']), shard(3, 3, ['c.flow'])]);
    expect(short).toMatchObject({ verdict: 'FAIL', why: ['shard 2/3 did not run'] });
  });

  it('keep a part that failed by --fail-on-flaky failed', () => {
    const flaky = aRecord([aCase('a.flow', { outcome: 'flaky' })], {
      verdict: 'FAIL',
      why: ['failed by --fail-on-flaky: 1 flaky'],
    });
    expect(mergeRecords([flaky, aRecord([aCase('b.flow')])]).verdict).toBe('FAIL');
  });

  it('refuse the same file on the same device twice, a shard twice, and two splits', () => {
    const twice = () => mergeRecords([aRecord([aCase('a.flow')]), aRecord([aCase('a.flow')])]);
    expect(twice).toThrow(MergeError);
    expect(twice).toThrow('a.flow on emulator-5554');
    expect(() => mergeRecords([shard(1, 2, ['a.flow']), shard(1, 2, ['b.flow'])])).toThrow(
      'shard 1/2',
    );
    expect(() => mergeRecords([shard(1, 2, ['a.flow']), shard(2, 3, ['b.flow'])])).toThrow(
      'different splits',
    );
    expect(() => mergeRecords([])).toThrow(MergeError);
  });

  it('refuse two commits unless told they may be mixed', () => {
    const other = aRecord([aCase('b.flow')], {
      repo: { commit: 'b'.repeat(40), dirty: false },
    });
    const parts = [aRecord([aCase('a.flow')]), other];
    expect(() => mergeRecords(parts)).toThrow('different commits');
    expect(mergeRecords(parts, { allowMixed: true }).cases).toHaveLength(2);
  });
});

describe('a record as JUnit', () => {
  const r = aRecord(
    [
      aCase('a.flow', { out: '1. launch: 5 ms' }),
      failed('b.flow'),
      aCase('c.flow', { teardown: { ok: false, failed: ['teardown line 2, step 1: left'] } }),
    ],
    { shard: { i: 2, n: 4 } },
  );
  const xml = junitXml(
    suitesOf(r, (under) => `out/${under}`),
    'shard 2/4',
  );

  it('names the shard, the device, the commit and the command that runs a case again', () => {
    expect(xml).toContain('<testsuites name="shard 2/4" tests="4" failures="2"');
    expect(xml).toContain('<property name="appdyno.device" value="emulator-5554"/>');
    expect(xml).toContain(`<property name="appdyno.commit" value="${'a'.repeat(40)}"/>`);
    expect(xml).toContain('<property name="appdyno.shard" value="2/4"/>');
    expect(xml).toContain(
      '<property name="appdyno.rerun" value="appdyno test flows/b.flow --device emulator-5554"/>',
    );
  });

  it("attaches a failure's files in both forms, the picture first, each line its own", () => {
    expect(xml).toContain(
      '<property name="attachment" value="out/emulator-5554/b.flow/screen.png"/>',
    );
    expect(xml).toContain(
      '<system-out>[[ATTACHMENT|out/emulator-5554/b.flow/screen.png]]\n[[ATTACHMENT|out/emulator-5554/b.flow/tree.json]]</system-out>',
    );
    expect(xml.indexOf('<properties>')).toBeLessThan(xml.indexOf('<failure '));
  });

  it('keeps a teardown that failed a case of its own, and a passed case as it was', () => {
    expect(xml).toContain('<testcase name="c.flow (teardown)"');
    expect(xml).toContain('<system-out>1. launch: 5 ms</system-out>');
  });
});
