import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import {
  renderTimeline,
  VIDEO_INSIDE_BYTES,
  writeTimeline,
  type Timeline,
} from '../src/timeline/index.js';
import type {
  FrameSpan,
  LogLine,
  MemorySample,
  RequestSpan,
  StallSpan,
  StepSpan,
  TrafficSample,
} from '../src/timeline/model.js';
import { inert } from '../src/timeline/page.js';
import { MOMENT, SCRIPT } from '../src/timeline/script.js';

const FROM = 1_793_841_338_000;

const timeline = (over: Partial<Timeline> = {}): Timeline => ({
  title: 'dev.app on Pixel 7',
  written: '2026-11-05T01:00:00.000Z',
  from: FROM,
  to: FROM + 10_000,
  clock: {
    offsetMs: 31,
    boundMs: 1.4,
    driftMs: 0.2,
    sources: [
      { row: 'Frames', readOn: 'the device', by: "the trace's own clock", withinMs: 1 },
      { row: 'Steps', readOn: 'this Mac', by: 'the offset', withinMs: 1.4 },
    ],
  },
  video: { bytes: 1234, codec: 'avc1', width: 1080, height: 2400, firstAt: FROM + 100 },
  frames: {
    marks: [
      { at: FROM + 1_000, ms: 16 },
      { at: FROM + 2_000, ms: 807.4, late: true },
      { at: FROM + 3_000, ms: 17 },
    ],
  },
  stalls: { marks: [{ at: FROM + 5_000, ms: 1_500, how: 'Skipped frames' }] },
  touches: { marks: [{ at: FROM + 1_900, ms: 40 }] },
  steps: { marks: [{ at: FROM + 1_850, ms: 200, name: 'tap', ok: true }] },
  network: {
    marks: [{ at: FROM + 1_950, ms: 500, name: 'GET api.example.com/items', status: 200 }],
    note: 'method, host and path',
  },
  traffic: { marks: [{ at: FROM + 2_000, inKbps: 12, outKbps: 3 }] },
  logs: { marks: [{ at: FROM + 2_100, text: 'loading items', level: 'warn' }] },
  memory: { marks: [{ at: FROM + 1_000, mb: 120 }] },
  ...over,
});

const script = (html: string) => must(/<script>([\s\S]*?)<\/script>/.exec(html)?.[1], 'a script');

describe('the page', () => {
  it('loads nothing, and asks nothing of a network', () => {
    const html = renderTimeline(timeline());
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link|@import|url\(/);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/connect-src|'unsafe-eval'/);
  });

  it('allows its one script by hash, so nothing else on it can run', () => {
    const html = renderTimeline(timeline());
    const hash = createHash('sha256').update(script(html)).digest('base64');
    expect(html).toContain(`script-src 'sha256-${hash}'`);
    expect(html).not.toContain(`script-src 'unsafe-inline'`);
  });

  it('keeps a log line that tries to end its script as data', () => {
    const hostile = '</script><script>window.owned=1</script><img src=x onerror=alert(1)>';
    const html = renderTimeline(
      timeline({
        title: `<b>${hostile}`,
        logs: { marks: [{ at: FROM, text: hostile }] },
        network: { marks: [{ at: FROM, name: hostile }] },
      }),
    );
    expect(html).not.toContain('<script>window.owned');
    expect(html).not.toContain('<img src=x');
    // read back from the page, the line is whole
    const data = must(/id="timeline">([\s\S]*?)<\/script>/.exec(html)?.[1], 'the data');
    expect((JSON.parse(data) as Timeline).logs.marks[0]?.text).toBe(hostile);
  });

  it('says what stands in for each row a device could not give, with its reason', () => {
    const html = renderTimeline(
      timeline({
        logs: { marks: [], absent: "devicectl cannot read a running app's log on an iPhone" },
        network: { marks: [], absent: 'no capture ran' },
      }),
    );
    expect(html).toContain('devicectl cannot read');
    expect(html).toContain('no capture ran');
  });

  it('says what its frames cannot see where a person reads it, not only on a hover', () => {
    const limits = 'A main thread held up draws no long frame';
    const html = renderTimeline(timeline({ frames: { marks: [], note: limits } }));
    expect(html).toContain(`<p class="note">${limits}</p>`);
  });

  it('tells nothing in the row from a row it cannot read', () => {
    expect(renderTimeline(timeline({ stalls: { marks: [] } }))).toContain(
      'nothing in this stretch',
    );
  });

  it('says how far off two rows can be, and on which clock', () => {
    const html = renderTimeline(timeline());
    expect(html).toContain('read 31 ms ahead of this Mac');
    expect(html).toContain('±1.4 ms');
    expect(html).toContain('at most the sum of their figures');
  });

  it('says a clock that is behind as behind', () => {
    const c = { ...timeline().clock, offsetMs: -120 };
    expect(renderTimeline(timeline({ clock: c }))).toContain('read 120 ms behind this Mac');
  });

  it('says what the file holds, before anything else', () => {
    const html = renderTimeline(timeline());
    expect(html.indexOf('What this file holds')).toBeLessThan(html.indexOf('id="plots"'));
    expect(html).toContain('not painted over');
    expect(html).toContain('1 of the app');
  });

  it('lists the slowest first, a stall no frame shows among them, each one a click away', () => {
    const html = renderTimeline(timeline());
    const rows = html.slice(html.indexOf('Slowest moments'));
    expect(rows.indexOf('main thread stopped')).toBeLessThan(rows.indexOf('late frame'));
    expect(rows).toContain(`data-t="${FROM + 2_000}"`);
    // it opens at the worst of them
    expect(html).toContain(`data-first="${FROM + 5_000}"`);
  });

  it('opens at the start of a stretch with nothing slow in it', () => {
    const html = renderTimeline(timeline({ frames: { marks: [] }, stalls: { marks: [] } }));
    expect(html).toContain(`data-first="${FROM}"`);
    expect(html).toContain('No slow frame in this stretch');
  });

  it('says why there is no video, and offers no player', () => {
    const { video: _video, ...t } = timeline();
    const html = renderTimeline({ ...t, noVideo: 'screenrecord did not start' });
    expect(html).toContain('screenrecord did not start');
    expect(html).not.toContain('<video');
  });

  it('draws thousands of frames small', () => {
    const marks = Array.from({ length: 10_800 }, (_, i) => ({ at: FROM + i * 16, ms: 16 }));
    const html = renderTimeline(timeline({ to: FROM + 172_800, frames: { marks } }));
    expect(must(html.match(/<rect/g), 'a rect').length).toBeLessThan(10);
  });
});

describe('inert', () => {
  it('leaves no `<` for a parser to find, and reads back the same', () => {
    const text = inert({ a: '</script><!-- <' });
    expect(text).not.toContain('<');
    expect(JSON.parse(text)).toEqual({ a: '</script><!-- <' });
  });
});

/** What `moment` answers, as the page's script builds it. */
type Moment = {
  frame?: FrameSpan;
  stall?: StallSpan;
  step?: StepSpan;
  requests: RequestSpan[];
  logs: LogLine[];
  logsMore: number;
  memory?: MemorySample;
  traffic?: TrafficSample;
};

describe('a moment', () => {
  const moment =
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the page's own script, run here as the page runs it
    (new Function(`${MOMENT}; return moment;`) as () => (t: Timeline, at: number) => Moment)();

  it('finds the slow frame, and what happened during it', () => {
    const now = moment(timeline(), FROM + 2_300);
    expect(now.frame?.ms).toBe(807.4);
    expect(now.requests.map((r) => r.name)).toEqual(['GET api.example.com/items']);
    expect(now.logs.map((l) => l.text)).toEqual(['loading items']);
  });

  it('takes a moment on a slow frame as all of that frame: what explains it comes as it ends', () => {
    const logs = { marks: [{ at: FROM + 2_810, text: 'Skipped 47 frames!' }] };
    expect(moment(timeline({ logs }), FROM + 2_000).logs).toEqual(logs.marks);
    const asked = { marks: [{ at: FROM + 2_700, ms: 50, name: 'late to finish' }] };
    expect(moment(timeline({ network: asked }), FROM + 2_000).requests).toEqual(asked.marks);
  });

  it('keeps a short frame a moment, not a window', () => {
    const logs = { marks: [{ at: FROM + 1_700, text: 'far' }] };
    expect(moment(timeline({ logs }), FROM + 1_005).logs).toEqual([]);
  });

  it('takes the last frame and reading before a moment that has none of its own', () => {
    const now = moment(timeline(), FROM + 2_900);
    expect(now.frame?.at).toBe(FROM + 2_000);
    expect(now.memory?.mb).toBe(120);
  });

  it('finds a stall that no frame shows', () => {
    expect(moment(timeline(), FROM + 5_600).stall?.how).toBe('Skipped frames');
  });

  it('leaves out a request over before the moment', () => {
    expect(moment(timeline(), FROM + 5_000).requests).toEqual([]);
  });

  it('keeps a request with no length near its moment only', () => {
    const t = timeline({ network: { marks: [{ at: FROM + 1_000, name: 'a' }] } });
    expect(moment(t, FROM + 1_400).requests).toHaveLength(1);
    expect(moment(t, FROM + 2_000).requests).toHaveLength(0);
  });

  it('shows the nearest lines of a noisy moment, and says how many more', () => {
    const marks = Array.from({ length: 20 }, (_, i) => ({ at: FROM + 1_000 + i, text: `l${i}` }));
    const now = moment(timeline({ logs: { marks } }), FROM + 1_000);
    expect(now.logs).toHaveLength(8);
    expect(now.logs[0]?.text).toBe('l0');
    expect(now.logsMore).toBe(12);
  });

  it('asks nothing of a row with no marks', () => {
    const empty = { marks: [] };
    const now = moment(
      timeline({
        frames: empty,
        stalls: empty,
        steps: empty,
        network: empty,
        logs: empty,
        memory: empty,
        traffic: empty,
      }),
      FROM,
    );
    expect(now.frame).toBeUndefined();
    expect(now.requests).toEqual([]);
  });

  it('is part of what the page runs', () => {
    expect(SCRIPT).toContain(MOMENT);
  });

  describe('its place in the video', () => {
    type Seconds = (
      v: { firstAt: number; parts?: { at: number; s: number }[] },
      t: number,
    ) => number;
    const videoSeconds =
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the page's own script, run here as the page runs it
      (new Function(`${MOMENT}; return videoSeconds;`) as () => Seconds)();

    it('is its distance from the first frame', () => {
      expect(videoSeconds({ firstAt: 1_000 }, 3_500)).toBe(2.5);
    });

    it('never comes before the video', () => {
      expect(videoSeconds({ firstAt: 1_000 }, 400)).toBe(0);
    });

    it('goes by the segment it fell in, for a video joined from several', () => {
      // 15 s of the first, with the clock moving on 16 s: the time between them is in neither
      const parts = [
        { at: 1_000, s: 0 },
        { at: 17_000, s: 15 },
      ];
      expect(videoSeconds({ firstAt: 1_000, parts }, 2_000)).toBe(1);
      expect(videoSeconds({ firstAt: 1_000, parts }, 18_000)).toBe(16);
    });
  });
});

describe('the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-timeline-'));
  const video = join(dir, 'screen.mp4');
  writeFileSync(video, Buffer.from('a video of its bytes'));

  it('carries a video small enough, and leaves no temporary file', async () => {
    const r = await writeTimeline(timeline(), dir, video);
    expect(r.videoInside).toBe(true);
    const html = readFileSync(r.file, 'utf8');
    expect(html).toContain(Buffer.from('a video of its bytes').toString('base64'));
    expect(r.bytes).toBe(statSync(r.file).size);
  });

  it('leaves one too large to send beside it, and points there', async () => {
    const t = timeline();
    const r = await writeTimeline(
      { ...t, video: { ...must(t.video, 'a video'), bytes: VIDEO_INSIDE_BYTES + 1 } },
      dir,
      video,
    );
    expect(r.videoInside).toBe(false);
    const html = readFileSync(r.file, 'utf8');
    expect(html).toContain('src="screen.mp4"');
    expect(html).not.toContain('id="video-bytes"');
  });

  it('is written for this user alone: it holds a screen and a log', async () => {
    const r = await writeTimeline(timeline(), dir, video);
    expect(statSync(r.file).mode & 0o077).toBe(0);
  });
});
