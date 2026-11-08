import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, expect, it } from 'vitest';
import {
  KINDS,
  loadRefusals,
  measureOf,
  MEASURES,
  recordsOf,
  saveRefusal,
  type Metric,
} from '../src/index.js';

describe('the rows of the performance table', () => {
  it.each([
    ['launch.ttid_ms', 'launch'],
    ['launch.phase.dyld_ms', 'launch-why'],
    ['frames.jank_percent', 'frames'],
    ['hitches.ratio', 'frames'],
    ['hitches.worst_ms', 'frames'],
    ['frames.frozen', 'frozen'],
    ['probe.missed_percent', 'frames'],
    ['probe.p95_ms', 'frames'],
    ['stalls.worst_ms', 'stalls'],
    ['hangs.worst_ms', 'stalls'],
    ['probe.stall_worst_ms', 'stalls'],
    ['memory.kb', 'memory'],
    ['heap.bytes', 'memory'],
    ['heap.leaks', 'leaks'],
    ['cpu.percent', 'cpu'],
    ['network.rx_bytes', 'network'],
    ['energy.mah', 'energy'],
    ['exits.crashes', 'crashes'],
    ['size.bytes', 'size'],
    ['journey.total_ms', 'journey'],
    ['journey.03_tap_id_submit.ms', 'journey'],
  ])('%s answers %s', (kind, row) => {
    expect(measureOf(kind)).toBe(row);
    expect(MEASURES).toContain(row);
  });

  it('a kind it does not know answers no row', () => {
    expect(measureOf('xct.Duration')).toBeUndefined();
    // the name of a family is no kind of it, nor of what Object has
    expect(measureOf('frames.nothing')).toBeUndefined();
    expect(measureOf('toString')).toBeUndefined();
  });

  it('every kind answers a row of the table', () => {
    expect(Object.values(KINDS).filter((row) => !MEASURES.includes(row))).toEqual([]);
  });

  it('a number with no row does not compile', () => {
    // @ts-expect-error: not in KINDS, and of no family named at run time
    const m: Metric = { kind: 'frames.nothing', unit: 'ms', samples: [1] };
    expect(measureOf(m.kind)).toBeUndefined();
  });
});

describe('a model is said to be one', () => {
  const ctx = {
    run: 'r',
    app: 'a',
    scenario: 's',
    source: 'cpu time',
    raw: '',
    device: { serial: 'x', platform: 'ios' as const, model: 'm', os: '27', virtual: false },
    build: 'release' as const,
    load: { host: [1], hostCpus: 8 },
    tool: 't',
    at: '2026-11-03T00:00:00.000Z',
  };

  it('in the record of a modelled metric, and only there', () => {
    const [model, read] = recordsOf(ctx, [
      { kind: 'energy.mah', unit: 'mah', samples: [1], modelled: true },
      { kind: 'cpu.percent', unit: 'percent', samples: [1] },
    ]);
    assert(model && read);
    expect(model.modelled).toBe(true);
    expect(read).not.toHaveProperty('modelled');
  });
});

describe('a refusal is kept per device class and measure', () => {
  it('the newest stays', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'refusals-'));
    const r = { deviceClass: 'ios-physical-x-27', measure: 'energy' as const };
    await saveRefusal(dir, { ...r, reason: 'old', at: '2026-11-01T00:00:00.000Z' });
    await saveRefusal(dir, { ...r, reason: 'new', at: '2026-11-02T00:00:00.000Z' });
    await saveRefusal(dir, {
      ...r,
      measure: 'network',
      reason: 'n',
      at: '2026-11-02T00:00:00.000Z',
    });
    const all = await loadRefusals(dir);
    expect(all.map((x) => x.reason).sort()).toEqual(['n', 'new']);
  });

  it('no refusals is an empty list', async () => {
    expect(await loadRefusals(mkdtempSync(join(tmpdir(), 'refusals-')))).toEqual([]);
  });
});
