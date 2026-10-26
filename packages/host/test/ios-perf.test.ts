import { describe, expect, it } from 'vitest';
import {
  parseCpuTime,
  parseFootprint,
  parseLeaks,
  parseSampleApp,
  parseSampleTop,
} from '../src/ios/perf.js';

describe('iOS simulator perf parsing', () => {
  it('reads the physical footprint and its peak', () => {
    expect(
      parseFootprint('Physical footprint:         52.3M\nPhysical footprint (peak):  60M\n'),
    ).toEqual({
      footprintKb: 53555,
      peakKb: 61440,
    });
    expect(parseFootprint('Physical footprint:         1856K\n')).toEqual({ footprintKb: 1856 });
    expect(
      parseFootprint('Fixture [4242]: 64-bit    Footprint: 61 MB (16384 bytes per page)\n'),
    ).toEqual({
      footprintKb: 62464,
    });
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

  it("ranks the app's own functions by inclusive samples", () => {
    const report = `Process:         Fixture [4242]
Path:            /Users/USER/Library/Developer/CoreSimulator/Devices/X/data/Containers/Bundle/Application/Y/Fixture.app/Fixture

Call graph:
    1000 Thread_1: Main Thread
    + 1000 start  (in dyld) + 7136  [0x1]
    +   1000 main  (in Fixture.debug.dylib) + 20  [0x2]
    +     990 mach_msg2_trap  (in libsystem_kernel.dylib) + 8  [0x6]
    900 Thread_2
    + 900 _dispatch_worker_thread2  (in libdispatch.dylib) + 10  [0x7]
    +   900 closure #1 in CpuScreen.body.getter  (in Fixture.debug.dylib) + 80  [0x3]
    +     850 IndexingIterator.next()  (in libswiftCore.dylib) + 12  [0x4]
    1000 Thread_3
    + 1000 __workq_kernreturn  (in libsystem_kernel.dylib) + 8  [0x5]

Total number in stack (recursive counted multiple, when >=5):
`;
    const top = parseSampleApp(report);
    // the main thread waited: its 10 busy samples rank below the busy loop's 900
    expect(top.map((t) => t.symbol)).toEqual(['closure #1 in CpuScreen.body.getter', 'main']);
    expect(top[0]).toEqual({
      symbol: 'closure #1 in CpuScreen.body.getter',
      samples: 900,
      percent: 98.9,
    });
  });

  it('reads the leaks summary', () => {
    expect(parseLeaks('Process 4242: 3 leaks for 192 total leaked bytes.')).toEqual({
      leaks: 3,
      leakedBytes: 192,
    });
    expect(parseLeaks('Process 4242: 0 leaks for 0 total leaked bytes.')).toEqual({
      leaks: 0,
      leakedBytes: 0,
    });
    expect(parseLeaks('nothing')).toEqual({});
  });
});
