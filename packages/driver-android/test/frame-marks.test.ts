import { describe, expect, it } from 'vitest';
import { parseFrameMarks, parseInputMarks } from '../src/perf/frame-marks.js';

// the query's own output on a real trace of an 800 ms stall in a draw, on an Android 14 emulator
const FRAMES = `"at_us","dur","jank_type"
1793841338429716,807412209,"Prediction Error, App Deadline Missed"
1793841339232993,22830209,"Prediction Error, Buffer Stuffing"
1793841339279386,22362959,"None"
`;

describe('frames on the clock', () => {
  it('keeps a frame where it was, to the µs the query gives', () => {
    const [stall] = parseFrameMarks(FRAMES);
    expect(stall).toEqual({ at: 1793841338429.716, ms: 807.4, late: true });
  });

  it("calls late only what is the app's fault, as the frame reading does", () => {
    expect(parseFrameMarks(FRAMES).map((f) => f.late === true)).toEqual([true, false, false]);
  });

  it('leaves out a row with no time, rather than placing it at the start of 1970', () => {
    expect(parseFrameMarks(`"at_us","dur","jank_type"\n[NULL],16000000,"None"\n`)).toEqual([]);
  });

  it('has none in a trace with no frames', () => {
    expect(parseFrameMarks(`"at_us","dur","jank_type"\n`)).toEqual([]);
  });
});

describe('touches on the clock', () => {
  const rows = (...r: [number, number][]) =>
    `"at_us","dur"\n${r.map(([at, dur]) => `${at},${dur}`).join('\n')}\n`;

  it('makes one touch of the events of a tap', () => {
    // a real tap's two events
    expect(parseInputMarks(rows([1793841336403888, 3010000], [1793841336407446, 134000]))).toEqual([
      { at: 1793841336403.888, ms: expect.closeTo(3.66, 2) as unknown },
    ]);
  });

  it('makes one touch of a swipe, however many events it has', () => {
    const events = Array.from({ length: 30 }, (_, i): [number, number] => [
      1_000_000_000 + i * 16_000,
      1_000_000,
    ]);
    const touches = parseInputMarks(rows(...events));
    expect(touches).toHaveLength(1);
    expect(touches[0]?.ms).toBe(465);
  });

  it('keeps two touches apart', () => {
    const touches = parseInputMarks(rows([1_000_000_000, 1_000_000], [1_001_000_000, 1_000_000]));
    expect(touches.map((t) => t.at)).toEqual([1_000_000, 1_001_000]);
  });

  it('has none where nothing was touched', () => {
    expect(parseInputMarks(rows())).toEqual([]);
  });
});
