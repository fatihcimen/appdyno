import { describe, expect, it } from 'vitest';
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

  it('counts only the ANRs of a touch as user-perceived', async () => {
    const device = { shell: async () => EXIT_INFO };
    const { value } = await exits(device as never, 'dev.appdyno.fixture');
    expect(value).toMatchObject({ crashes: 1, anrs: 2, userAnrs: 1, total: 3 });
  });
});
