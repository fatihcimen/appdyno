import { describe, expect, it } from 'vitest';
import {
  assemble,
  NO_REQUESTS,
  requestName,
  stallsIn,
  type Gathered,
} from '../src/timeline/gather.js';

const FROM = 1_793_841_338_000;
const same = (s: string) => s;

const gathered = (over: Partial<Gathered> = {}): Gathered => ({
  title: 'dev.app on Pixel 7',
  written: '2026-11-05T01:00:00.000Z',
  from: FROM,
  to: FROM + 10_000,
  clocks: { first: { offsetMs: 31, boundMs: 1.4 }, last: { offsetMs: 31.5, boundMs: 2 } },
  frames: {
    frames: [
      { at: FROM + 1_000, ms: 16 },
      { at: FROM + 1_016.7, ms: 16 },
      { at: FROM + 1_033.3, ms: 807, late: true },
    ],
    input: [{ at: FROM + 900, ms: 40 }],
  },
  samples: [],
  logs: { lines: [], source: 'fake' },
  requests: { entries: [], why: NO_REQUESTS },
  steps: [],
  clean: same,
  ...over,
});

const line = (at: number, text: string, level?: 'warn' | 'error') => ({
  text,
  mark: { at, ...(level && { level }) },
});
const logs = (...l: ReturnType<typeof line>[]) => ({
  lines: l.map((x) => x.text),
  marks: l.map((x) => x.mark),
  source: 'fake',
});

describe('a request by its name', () => {
  const url = 'https://user:pw@api.example.com/v1/items?token=abc123&q=1#frag';

  it('keeps method, host and path, and nothing a query carries', () => {
    const name = requestName({ method: 'POST', url }, same);
    expect(name).toBe('POST api.example.com/v1/items');
    expect(name).not.toMatch(/abc123|user|pw|frag/);
  });

  it('gives the whole URL only when a person asked', () => {
    expect(requestName({ url }, same, true)).toContain('token=abc123');
  });

  it('hides a listed secret, in a path too', () => {
    const hide = (s: string) => s.replace('s3cret', '•••');
    expect(requestName({ url: 'https://a.example/u/s3cret/x' }, hide)).toBe(
      'GET a.example/u/•••/x',
    );
  });

  it('cuts what is no URL at its query as well', () => {
    expect(requestName({ url: 'not a url?token=abc' }, same)).toBe('GET not a url');
  });

  it('names a count by what it was counted against', () => {
    expect(requestName({ direction: 'Received', host: 'TCP port 443' }, same)).toBe(
      'Received TCP port 443',
    );
  });
});

describe('a stall no frame shows', () => {
  const frames = [
    { at: FROM, ms: 16 },
    { at: FROM + 16, ms: 16 },
    { at: FROM + 32, ms: 16 },
  ];

  it('stands from the refreshes skipped to the line that says so', () => {
    const [s] = stallsIn(
      logs(line(FROM + 2_000, 'I Choreographer: Skipped 90 frames!  The application may…')),
      frames,
    );
    expect(s).toEqual({
      at: FROM + 2_000 - 90 * 16,
      ms: 90 * 16,
      how: 'Skipped frames in its log',
    });
  });

  it('goes by the refresh of this device, not a phone of another', () => {
    const fast = Array.from({ length: 9 }, (_, i) => ({ at: FROM + i * 8.3, ms: 8 }));
    const [s] = stallsIn(logs(line(FROM + 2_000, 'Skipped 120 frames!')), fast);
    expect(s!.ms).toBeCloseTo(996, 0);
  });

  it('takes 60 Hz where there are too few frames to tell', () => {
    const [s] = stallsIn(logs(line(FROM + 2_000, 'Skipped 60 frames!')), []);
    expect(s!.ms).toBeCloseTo(1_000, 0);
  });

  it('leaves out one a long frame already shows: one stop is one row', () => {
    const drawn = [...frames, { at: FROM + 1_000, ms: 807, late: true }];
    const said = logs(line(FROM + 1_810, 'Skipped 47 frames!'));
    expect(stallsIn(said, drawn)).toEqual([]);
  });

  it('keeps one that only a short frame touches', () => {
    const drawn = [...frames, { at: FROM + 1_400, ms: 18 }];
    expect(stallsIn(logs(line(FROM + 2_000, 'Skipped 90 frames!')), drawn)).toHaveLength(1);
  });

  it('reads nothing into a line with no place on the clock', () => {
    expect(stallsIn({ lines: ['Skipped 90 frames!'], source: 'fake' }, frames)).toEqual([]);
  });
});

describe('one clock', () => {
  it("moves what was read on the Mac by the offset, and leaves the device's where it was", () => {
    const t = assemble(
      gathered({
        steps: [{ began: FROM + 1_000, at: FROM + 1_200, op: 'tap', ok: true }],
        logs: logs(line(FROM + 3_000, 'hello')),
      }),
    );
    expect(t.steps.marks[0]).toEqual({ at: FROM + 1_031, ms: 200, name: 'tap', ok: true });
    expect(t.logs.marks[0]!.at).toBe(FROM + 3_000);
    expect(t.frames.marks[0]!.at).toBe(FROM + 1_000);
  });

  it('says the bound of what crossed from the Mac, drift and all, in the report', () => {
    const t = assemble(gathered({ steps: [{ began: FROM, at: FROM + 1, op: 'tap', ok: true }] }));
    expect(t.clock.driftMs).toBe(0.5);
    expect(t.clock.sources.find((s) => s.row === 'Steps')!.withinMs).toBeCloseTo(1.9, 5);
    expect(t.clock.sources.find((s) => s.row === 'Frames')!.withinMs).toBe(1);
  });

  it('says how a video was placed in the words it came with: a guess calls itself one', () => {
    const by = 'when its recording began, which no one has measured here: a guess';
    const facts = { bytes: 1, codec: 'avc1', width: 1, height: 1, firstAt: FROM };
    const t = assemble(gathered({ video: { facts, withinMs: 1_000, by } }));
    expect(t.clock.sources.find((s) => s.row === 'Video')).toMatchObject({ by, withinMs: 1_000 });
  });

  it("says what a source found of its own frames, and lends none of another's exactness", () => {
    const placed = { by: 'the date their trace began', withinMs: 215 };
    const frames = { frames: [{ at: FROM + 1, ms: 500, late: true }], placed };
    const t = assemble(gathered({ frames }));
    expect(t.clock.sources.find((s) => s.row === 'Frames')).toMatchObject(placed);
  });

  it('keeps out what fell before or after the stretch', () => {
    const t = assemble(
      gathered({
        logs: logs(line(FROM - 5, 'before'), line(FROM + 5, 'in'), line(FROM + 10_005, 'after')),
      }),
    );
    expect(t.logs.marks.map((l) => l.text)).toEqual(['in']);
  });
});

describe('what cannot be given', () => {
  it('gives the reason of a frame source that refused, and no frames', () => {
    const t = assemble(gathered({ frames: { why: 'cannot measure frames on a clock' } }));
    expect(t.frames).toEqual({ marks: [], absent: 'cannot measure frames on a clock' });
    expect(t.touches.absent).toContain('Steps are what this tool sent');
  });

  it("gives a log's own note where it has no lines: a phone's is why", () => {
    const t = assemble(gathered({ logs: { lines: [], source: 'devicectl', note: 'cannot read' } }));
    expect(t.logs).toEqual({ marks: [], absent: 'cannot read' });
  });

  it('says why a request cannot be listed, and that none means none when a capture ran', () => {
    expect(assemble(gathered()).network.absent).toBe(NO_REQUESTS);
    const ran = assemble(gathered({ requests: { entries: [] } }));
    expect(ran.network.absent).toBeUndefined();
    expect(ran.network.marks).toEqual([]);
  });

  it("takes a device's own reason for a reading, and shows 0 as a reading of 0", () => {
    const t = assemble(
      gathered({
        samples: [
          { at: FROM, memoryMb: 0, networkInKbps: 0, networkOutKbps: 0 },
          { at: FROM + 1_000, absent: { memoryMb: 'too slow to read each second here' } },
        ],
      }),
    );
    expect(t.memory.marks).toEqual([{ at: FROM + 31, mb: 0 }]);
    expect(t.traffic.marks).toEqual([{ at: FROM + 31, inKbps: 0, outKbps: 0 }]);
    const none = assemble(
      gathered({
        samples: [{ at: FROM, absent: { memoryMb: 'too slow to read each second here' } }],
      }),
    );
    expect(none.memory).toEqual({ marks: [], absent: 'too slow to read each second here' });
  });
});

describe('what may be private', () => {
  it('cleans every log line and every request', () => {
    const hide = (s: string) => s.replaceAll('s3cret', '•••');
    const t = assemble(
      gathered({
        clean: hide,
        logs: logs(line(FROM + 1, 'token s3cret')),
        requests: {
          entries: [{ at: new Date(FROM).toISOString(), url: 'https://a.example/s3cret' }],
        },
      }),
    );
    expect(JSON.stringify(t)).not.toContain('s3cret');
  });

  it('leaves the query out by default, and says so', () => {
    const t = assemble(
      gathered({
        requests: {
          entries: [{ at: new Date(FROM).toISOString(), url: 'https://a.example/x?t=1' }],
        },
      }),
    );
    expect(t.network.marks[0]!.name).toBe('GET a.example/x');
    expect(t.network.note).toBe('method, host and path, no query');
  });
});
