import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exits } from '../src/perf/app.js';
import { parseGfxSummary } from '../src/perf/parse.js';

/** As a Xiaomi with Android 16 wrote it, with a broadcast's ANR beside the one of a touch. */
const EXIT_INFO = `ACTIVITY MANAGER PROCESS EXIT INFO (dumpsys activity exit-info)
  package: dev.appdyno.fixture
    Historical Process Exit for uid=10469
        ApplicationExitInfo #0:
          timestamp=2026-11-04 10:13:19.079 pid=28637 realUid=10469 packageUid=10469 definingUid=10469 user=0
          process=dev.appdyno.fixture reason=6 (ANR) subreason=0 (UNKNOWN) status=0
          importance=100 pss=0,00 rss=0,00 description=user request after error: Input dispatching timed out (7447e0a dev.appdyno.fixture/dev.appdyno.fixture.MainActivity is not responding. Waited 5000ms for MotionEvent(action=DOWN)). state=empty trace=null
        ApplicationExitInfo #1:
          timestamp=2026-11-04 10:12:19.841 pid=28519 realUid=10469 packageUid=10469 definingUid=10469 user=0
          process=dev.appdyno.fixture reason=6 (ANR) subreason=0 (UNKNOWN) status=0
          importance=400 pss=0,00 rss=0,00 description=bg anr: Broadcast of Intent { act=android.intent.action.TIME_SET } state=empty trace=null
        ApplicationExitInfo #2:
          timestamp=2026-11-04 10:12:06.997 pid=28086 realUid=10469 packageUid=10469 definingUid=10469 user=0
          process=dev.appdyno.fixture reason=4 (APP CRASH(EXCEPTION)) subreason=0 (UNKNOWN) status=0
          importance=100 pss=92MB rss=232MB description=crash state=empty trace=null
`;

const SUMMARY = (hist: string) =>
  `Total frames rendered: 100\nJanky frames: 5 (5.00%)\nHISTOGRAM: ${hist}\nGPU HISTOGRAM: 1ms=99\n`;

describe("what Play's definitions are read from", () => {
  it('counts over 16 ms from the bucket above it, and 700 ms from its own', () => {
    expect(
      parseGfxSummary(SUMMARY('5ms=10 16ms=20 17ms=30 150ms=1 650ms=4 700ms=2 1150ms=1')).histogram,
    ).toEqual({ frames: 68, over16: 38, over700: 3 });
  });

  const device = (dropbox: string) => ({
    shell: async (cmd: string) => (cmd.includes('dropbox') ? dropbox : EXIT_INFO),
  });
  const filed = (...subjects: string[]) =>
    subjects
      .map(
        (s, i) =>
          `========================================\n2026-11-04 13:0${i}:25 data_app_anr (compressed text, 26120 bytes)\nProcess: dev.appdyno.fixture\nSubject: ${s}\n`,
      )
      .join('');
  const TOUCH = 'Input dispatching timed out (c6abf43 dev.appdyno.fixture is not responding)';

  it('counts only the ANRs of a touch as user-perceived', async () => {
    const { value } = await exits(device('') as never, 'dev.appdyno.fixture');
    expect(value.held).toMatchObject({ crashes: 1, anrs: 2, userAnrs: 1, total: 3 });
  });

  it('counts an ANR the app recovered from, which ends in no exit', async () => {
    const shell = async (cmd: string) =>
      cmd.includes('dropbox') ? filed(TOUCH, TOUCH, TOUCH) : 'no exits here';
    const { value } = await exits({ shell } as never, 'dev.appdyno.fixture');
    expect(value.held).toMatchObject({ crashes: 0, anrs: 3, userAnrs: 3, total: 0 });
  });

  it('counts one that was killed once, though both have it', async () => {
    const { value } = await exits(
      device(filed(TOUCH, 'Broadcast of Intent')) as never,
      'dev.appdyno.fixture',
    );
    expect(value.held).toMatchObject({ anrs: 2, userAnrs: 1 });
  });

  it('counts no other app’s, and stands where the dropbox cannot be read', async () => {
    const other = filed(TOUCH).replace('Process: dev.appdyno.fixture', 'Process: com.other');
    const { value } = await exits(device(other) as never, 'dev.appdyno.fixture');
    expect(value.held).toMatchObject({ anrs: 2, userAnrs: 1 });
    const failing = {
      shell: async (cmd: string) => {
        if (cmd.includes('dropbox')) throw new Error('no dropbox');
        return EXIT_INFO;
      },
    };
    expect((await exits(failing as never, 'dev.appdyno.fixture')).value.held.userAnrs).toBe(1);
  });

  it('reads no ANR as none where the dropbox was unread and the exits show none', async () => {
    const shell = async (cmd: string) => {
      if (cmd.includes('dropbox')) throw new Error('no dropbox');
      return 'no exits here';
    };
    const { value } = await exits({ shell } as never, 'dev.appdyno.fixture');
    expect(value.held.anrs).toBeUndefined();
    expect(value.held.userAnrs).toBeUndefined();
    expect(value.held.crashes).toBe(0);
  });

  /** A device whose local clock reads `now`, this Mac's being `macNow`. */
  const onClock = (now: string, dropbox = '') => ({
    shell: async (cmd: string) => {
      if (cmd.includes("date '+")) return `${now}\n`;
      return cmd.includes('dropbox') ? dropbox : EXIT_INFO;
    },
  });
  const macNow = new Date('2026-11-04T12:00:00').getTime();
  const local = (at: string) => new Date(at).getTime();

  describe('over a run', () => {
    beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(macNow));
    afterEach(() => vi.restoreAllMocks());

    it('counts what is newer than its start, and holds the rest apart as a stock', async () => {
      const { value } = await exits(
        onClock('2026-11-04 12:00:00') as never,
        'dev.appdyno.fixture',
        local('2026-11-04T10:12:30'),
      );
      expect(value.run).toEqual({ crashes: 0, anrs: 1, userAnrs: 1, total: 1 });
      expect(value.held).toMatchObject({ crashes: 1, anrs: 2, total: 3 });
    });

    it('counts nothing of last week, however much the system still holds', async () => {
      const { value } = await exits(
        onClock('2026-11-04 12:00:00') as never,
        'dev.appdyno.fixture',
        macNow - 1_000,
      );
      expect(value.run).toEqual({ crashes: 0, anrs: 0, userAnrs: 0, total: 0 });
      expect(value.held.total).toBe(3);
    });

    it('goes by the device’s own clock, in a zone three hours off this Mac’s', async () => {
      // the same run on a phone that reads 15:00 when this Mac reads 12:00: its 10:13 was this Mac's 07:13
      const { value } = await exits(
        onClock('2026-11-04 15:00:00') as never,
        'dev.appdyno.fixture',
        local('2026-11-04T07:12:30'),
      );
      expect(value.run).toMatchObject({ crashes: 0, total: 1 });
    });

    it('counts an ANR in the dropbox by its own time', async () => {
      const entries = filed(TOUCH, TOUCH);
      vi.spyOn(Date, 'now').mockReturnValue(local('2026-11-04T14:00:00'));
      const { value } = await exits(
        onClock('2026-11-04 14:00:00', entries) as never,
        'dev.appdyno.fixture',
        local('2026-11-04T13:00:30'),
      );
      expect(value.run).toMatchObject({ anrs: 1, userAnrs: 1 });
      expect(value.held.anrs).toBe(2);
    });

    it('has no reading of a run where the device’s clock cannot be read', async () => {
      const shell = async (cmd: string) => {
        if (cmd.includes("date '+")) throw new Error('no clock');
        return cmd.includes('dropbox') ? '' : EXIT_INFO;
      };
      const { value } = await exits({ shell } as never, 'dev.appdyno.fixture', macNow - 1_000);
      expect(value.run).toBeUndefined();
      expect(value.held.total).toBe(3);
    });

    it('has none asked for with no time to count from', async () => {
      const { value } = await exits(onClock('2026-11-04 12:00:00') as never, 'dev.appdyno.fixture');
      expect(value.run).toBeUndefined();
    });
  });
});
