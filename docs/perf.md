# Performance measurement

Every measurement is read from the platform's own tools and stored with the raw output it came from
(`<measurements dir>/pm-<id>.json` and `.txt`; the MCP server's `--measurements`, default
`~/Library/Caches/appdyno/measurements`). Commands run in the C locale. Nothing leaves the machine.

## What is measured and how

| measure        | source                                                                                                | notes                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| frames         | `dumpsys gfxinfo <pkg> framestats`, then `reset` in the same shell                                    | summary (total, janky %, p50–p99, frozen = frames ≥ 700 ms from the histogram) and the last ~120 frames of every window: a frame taking over two vsync intervals from its vsync to completion is slow (a smooth frame takes about one, the render pipeline). Some releases print `FrameInterval` and `FrameStartTime` swapped against their header: the interval is the column with a plausible period.                                                     |
| frame timeline | Perfetto `android.surfaceflinger.frametimeline` (Android 12+), analysed by the pinned trace processor | every frame of the app's process with its jank type: app deadline missed, buffer stuffing, compositor (SurfaceFlinger, display HAL, prediction error). The app's own share (app deadline missed) is reported apart: an emulator marks nearly every frame with a prediction error of its emulated display (measured: 122 of 122 frames of a smooth animation), which is not the app's. `appdyno tools install` fetches Perfetto v58.2 and checks its sha256. |
| memory         | `dumpsys meminfo <pkg>`                                                                               | TOTAL PSS (what the system charges the app), Java and native heap, graphics, private dirty                                                                                                                                                                                                                                                                                                                                                                  |
| CPU            | `/proc/<pid>/stat` utime + stime before and after a window, `getconf CLK_TCK`                         | % of one core (over 100 on several cores)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| launch         | `am start -W`                                                                                         | cold: the app is stopped first; warm: it goes home and comes back. One warm-up launch is left out, then the median TotalTime of the launches the system reports in that state. WaitTime includes `am`'s own cost and is not used.                                                                                                                                                                                                                           |
| device state   | `/proc/loadavg`, `/proc/pressure/cpu`, `/proc/meminfo`, `dumpsys thermalservice`, `dumpsys battery`   | recorded with measurements: a loaded device explains slow frames that are not the app's                                                                                                                                                                                                                                                                                                                                                                     |

## Thresholds the tools name

| issue                   | threshold                                                                                     | source                       |
| ----------------------- | --------------------------------------------------------------------------------------------- | ---------------------------- |
| slow cold / warm launch | ≥ 5 s / ≥ 2 s                                                                                 | Android vitals (launch time) |
| frozen frame            | ≥ 700 ms                                                                                      | Android vitals (rendering)   |
| jank                    | median janky share of the scroll rounds (rounds under 60 frames left out) above 10 %          | this project's default       |
| memory growth           | over 30 % from the second round's end to the last's (the first round loads images and caches) | this project's default       |

An emulator's numbers depend on the host's load and GPU mode: they are relative and only compared with
the same kind of device (the tools say "sanal cihaz: göreli").

## Accuracy

`test-device/perf.test.ts` checks every measure against a fixture screen of known cost: a 2 s animation
whose draw takes about 1 ms or 40 ms (frames and the frame timeline), 50 MB of Java heap held (memory,
within 15 %), one busy core (CPU, 80–125 %), and cold launches against the system's own "Displayed" log
line (within 50 ms).

## iOS

A simulator app is a Mac process: its measures come from the Mac's own tools. A phone's come from Xcode's trace
tool (`xctrace`), which says when a recording has started (`--notify-tracing-started`, so a scroll runs inside it,
not after a guessed sleep) and is stopped at most 60 s past its limit. A start took 14-19 s and a stop 4-14 s on
a phone connected by USB, whatever the recording's length.

| measure     | simulator                                                                                                                                 | iPhone                                                                                  | notes                                                                                                                                                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| memory      | `footprint <pid>` (physical footprint)                                                                                                    | Activity Monitor, every process, `memory-physical-footprint`                            | the phone's footprint at the end of the recording; no attach, so a system app can be read                                                                                                                                                                                                                                        |
| CPU         | `ps -o time=` before and after a window                                                                                                   | Activity Monitor, `cpu-total` first and last reading                                    | % of one core                                                                                                                                                                                                                                                                                                                    |
| launch      | `simctl launch` until the first screen reads                                                                                              | `devicectl` until the runner reads the first screen                                     | cold: terminated first; warm: another app in between. One warm-up left out, the median of the rest; includes a read. xctrace's App Launch needs `get-task-allow`: denied for Settings                                                                                                                                            |
| CPU profile | Time Profiler, attached (`sample` sees no busy samples of a simulator app under macOS 27, and stays only for a Mac where attaching fails) | Time Profiler, every process, one read (attaching stops working at times on iOS 27.0.1) | the busiest functions by the weight of the samples on top of their stacks, and the app's own functions (of a binary inside an .app) by inclusive weight; the trace stays for Instruments                                                                                                                                         |
| heap        | `leaks --outputGraph` (a memory graph for Xcode), the leaks found                                                                         | –                                                                                       | the summary is read from the saved graph                                                                                                                                                                                                                                                                                         |
| hangs       | –                                                                                                                                         | Time Profiler's `potential-hangs`                                                       | library only (`measure.hangs`): there is no Hangs template in Xcode 27.1, the Time Profiler has the table                                                                                                                                                                                                                        |
| hitches     | –                                                                                                                                         | `xctrace record --template 'Animation Hitches'`, exported                               | frames shown, the app's hitches, their total and worst time, the hitch ratio and the likely causes. **Xcode 27.1 on iOS 27.0.1 records few displayed surfaces of a scroll (none in 3 of 5 recordings, 26 at best): none is UNSUPPORTED, never "no hitches", and a count is a floor.** On a simulator the tool's recording fails. |

A simulator's numbers are relative: `Device.virtual` is true there, false on a phone, and the tools say so.

`test-device/ios-perf.test.ts` checks the simulator measures on the fixture: 50 MB held (memory, within
15 %), one busy thread (CPU, 80–125 %, and the profile's top app function, from a trace), a memory graph with
its leaks summary, cold launches slower than warm. `test-device/iphone.test.ts` reads memory, CPU, a profile, the
hangs and a launch of Settings; a cost-known check of them needs an app signed for the phone.

## iPhone speed

iPhone 13 Pro Max, iOS 27.0.1, the Settings scenario through the library: read 240, tap and see 1,523, back 1,682,
screenshot 140, app in front 240, cold launch 279 ms until in front (819 until its first screen reads), a runner's start
3-5 s. No stale answer, nothing moved in 4 checks. No other tool was run on the phone. A measure costs 8-13 s, nearly
all the trace tool's start and stop.

## iOS simulator speed

Measured with the Settings scenario on an iPhone 17 Pro simulator, iOS 26.5, on a Mac with other builds running
(load in the table). Median of 10-15 rounds, in ms, alternating tools.

| tool         | read    | tap and see | back and see | screenshot | app in front, with its screen | app behind, no screen |
| ------------ | ------- | ----------- | ------------ | ---------- | ----------------------------- | --------------------- |
| appdyno      | 53-59   | 899-911     | 737-777      | 82-88      | 273-292                       | 186-207               |
| another-server   | 246-276 | 918-925     | 899-937      | 386-480    | no screen: 109-112            | 134-139               |
| another-tool | 60-67   | 1,137-1,214 | 1,132-1,148  | 574-591    | no screen: 206-247            | 1,063-1,188           |

Host load 5-13 (one run of each at 13-68). appdyno's read follows its own back here, with the app still busy: at rest
it took 31-32 ms, 25 ms of it in the helper for 167 elements. No stale answer in any run. appdyno's answers
against a read 1.5 s later: nothing moved, missing or extra in 20 answers (`test-device/ios.test.ts` keeps this
check). `another-server`'s tap and see answers during the push: 11 lines of its answer in 7 of 8 checks were not in a read
1.5 s later, the old page's rows at their sliding places. The same check on `another-tool` was not valid (its
answer is a diff). `another-server` opens an app in less time because it returns when `simctl launch` does, with no screen;
appdyno also waits for the app to be in front. Its 273 ms is two reads and the 200 ms `launch_app` waits for
stillness in `packages/ops`.

What each change did, the rest of the scenario held still:

| change                                                             | before                | after                  | conditions                                                        |
| ------------------------------------------------------------------ | --------------------- | ---------------------- | ----------------------------------------------------------------- |
| direct input with the settle on the host                           | tap 1,206; back 1,340 | tap 905; back 760      | load 5-12; the touch itself 52-58 ms                              |
| direct read                                                        | 74-75                 | 31-32 at rest          | load 7-11, 167 elements                                           |
| the settle compares what can be named, in any order                | back 1,220            | back 500-750           | load 18-36; a floating search bar moves levels                    |
| 150 ms once something has reacted, against 200 ms                  | tap 984-1,357         | tap 944-959            | load 8-21; nothing moved in 16 answers at either                  |
| `launch` without a restart, running app                            | 2,592-5,735           | 273-292                | load 7-320                                                        |
| first start: erased simulator, booted (19 s), runner not installed |                       | 2.7 s; installed 1.9 s | load 7; 37 s seen at load 319. Says where it has got to on stderr |

Tried and dropped:

- XCTest's `XCTDisableAttributeKeyPathAnalysis`, `DisableScreenshots`, `DisableDiagnosticScreenRecordings`, all set in
  the runner: read 74 against 75, tap 1,206-1,211 against 1,222-1,255, back 1,338-1,349 against 1,352-1,355 (load 9-11);
  on the phone read 231 against 233, tap 1,583 against 1,644.
- A 120 ms window once something has reacted: answers carried a search bar a push leaves for a moment.
- The app's accessibility reports as a settle signal: `RunLoopIsIdle` and `AnimationsNonActive` answer within 3 ms
  during a push, 700 ms before its old page goes. As proof of a touch, `TouchEventsCompleted` works.
- `LSApplicationWorkspace` from inside the simulator: the app is in front after 800 ms against about 180 with
  `simctl launch`.
- A depth limit in the runner's request was not tried: the direct read asks for 60 levels, and the runner now answers
  only what the helper refuses.
