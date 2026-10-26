import { describe, expect, it } from 'vitest';
import { parseCpuTime, parseFootprint, parseSampleTop } from '../src/ios/perf.js';

describe('iOS simulator perf parsing', () => {
  it('reads the physical footprint and its peak', () => {
    expect(
      parseFootprint('Physical footprint:         52.3M\nPhysical footprint (peak):  60M\n'),
    ).toEqual({
      footprintKb: 53555,
      peakKb: 61440,
    });
    expect(parseFootprint('Physical footprint:         1856K\n')).toEqual({ footprintKb: 1856 });
    expect(parseFootprint('nothing here')).toBeUndefined();
  });

  it('reads cumulative CPU time', () => {
    expect(parseCpuTime('0:01.50')).toBe(1500);
    expect(parseCpuTime(' 1:02:03.00 ')).toBe(3723000);
  });

  it('ranks the busiest functions and leaves idle waits out', () => {
    const report = `Total number in stack ...
Sort by top of stack, same collapsed (when >= 5):
        mach_msg2_trap  (in libsystem_kernel.dylib)        2900
        closure #1 in CpuScreen.body.getter  (in Fixture)        2600
        __workq_kernreturn  (in libsystem_kernel.dylib)        500
        swift_retain  (in libswiftCore.dylib)        400

Binary Images:
`;
    const r = parseSampleTop(report);
    expect(r.samples).toBe(3000);
    expect(r.top[0]).toEqual({
      symbol: 'closure #1 in CpuScreen.body.getter',
      samples: 2600,
      percent: 86.7,
    });
    expect(r.top.map((t) => t.symbol)).not.toContain('mach_msg2_trap');
  });
});
