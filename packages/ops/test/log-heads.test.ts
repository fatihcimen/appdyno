import { describe, expect, it } from 'vitest';
import { sharedHead } from '../src/log-heads.js';

describe("what a log's lines repeat", () => {
  it("says logcat's day and process once, and keeps each line's time, thread, rank and words", () => {
    const lines = [
      '11-14 22:59:50.001  4242  4242 I App: started',
      '11-14 22:59:52.313  4242  4250 E RealImageLoader: Failed to load\njava.io.IOException: closed\n\tat Zygote.main',
      '11-14 22:59:53.000  4242  4242 I App: next 11-14 22:59:53.000',
    ];
    expect(sharedHead(lines)).toEqual({
      shared: ['11-14', 'pid 4242'],
      lines: [
        '22:59:50.001 4242 I App: started',
        '22:59:52.313 4250 E RealImageLoader: Failed to load\njava.io.IOException: closed\n\tat Zygote.main',
        '22:59:53.000 4242 I App: next 11-14 22:59:53.000',
      ],
    });
  });

  it("says a simulator's day and process once", () => {
    const lines = [
      '2026-11-05 04:46:59.959 F  App[1:2] it went wrong\n    timeEntry = 1;',
      '2026-11-05 04:46:59.960 Df App[1:1a] [com.apple] next',
      '2026-11-05 04:47:00.000 Df App[1:2] (libswiftCore.dylib) Fatal error: Index out of range',
    ];
    expect(sharedHead(lines)).toEqual({
      shared: ['2026-11-05', 'App[1]'],
      lines: [
        '04:46:59.959 F  2 it went wrong\n    timeEntry = 1;',
        '04:46:59.960 Df 1a [com.apple] next',
        '04:47:00.000 Df 2 (libswiftCore.dylib) Fatal error: Index out of range',
      ],
    });
  });

  it('leaves out only what every line has the same', () => {
    const two = [
      '11-14 22:59:50.001  4242  4242 I App: started',
      '11-14 22:59:50.002  4300  4300 I App: its new process',
      '11-14 22:59:50.003  4300  4300 I App: next',
    ];
    expect(sharedHead(two)).toEqual({
      shared: ['11-14'],
      lines: two.map((l) => l.slice(6)),
    });
    const pastMidnight = [...two.slice(0, 2), '11-15 00:00:00.003  4300  4300 I App: next'];
    expect(sharedHead(pastMidnight)).toEqual({ shared: [], lines: pastMidnight });
    const unknown = ['E AndroidRuntime: FATAL', ...two];
    expect(sharedHead(unknown)).toEqual({ shared: [], lines: unknown });
    expect(sharedHead(two.slice(0, 2))).toEqual({ shared: [], lines: two.slice(0, 2) });
  });
});
