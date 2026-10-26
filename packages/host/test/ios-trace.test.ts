import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hitchSummary, parseTraceTable } from '../src/ios/trace.js';

const fixture = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures', f), 'utf8');

describe('iOS trace export', () => {
  it('reads an exported table, references resolved', () => {
    const rows = parseTraceTable(fixture('ios-hitches.xml'));
    expect(rows).toHaveLength(5);
    expect(rows[0]!.duration).toEqual({ value: '62504375', fmt: '62.50 ms' });
    expect(rows[1]!.process!.fmt).toBe('Settings (1235)'); // a ref to the first row's process
    expect(rows[0]!['narrative-description']!.value).toBe('Potentially expensive app update(s)');
  });

  it('sums the app hitches over the recording', () => {
    const s = hitchSummary(fixture('ios-hitches.xml'), fixture('ios-surfaces.xml'), 6_000);
    expect(s.frames).toBe(40);
    expect(s.hitches).toBeGreaterThan(0);
    expect(s.worstMs).toBe(62.5);
    expect(s.hitchRatio).toBeCloseTo(s.hitchMs / 6, 0);
  });
});
