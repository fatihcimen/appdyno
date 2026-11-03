# Performance measurement

Every measurement is read from the platform's own tools and stored with the raw output it came from
(`<measurements dir>/pm-<id>.json` and `.txt`; the MCP server's `--measurements`, default
`~/Library/Caches/appdyno/measurements`). Commands run in the C locale. Nothing leaves the machine.

## What works where

Each cell was run on this machine against a known cost on the fixture, except where it says otherwise. The Android phone is a Xiaomi on Android 16 (HyperOS), Turkish; the numbers are from its run of `test-device/perf.test.ts` on 2026-11-03. "no" says why; a measure a platform
lacks answers `UNSUPPORTED` with that reason, never zero.

| Measure             | Android emulator (API 34)                                                                                                                                                                                                        | Android phone                                                                                                                                      | iOS simulator (26.5)                                                                                                                                                                                                     | iPhone 13 Pro Max (iOS 27)                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch              | **works**: cold 413, warm 180, hot 70 ms by the system's own report (`am start -W`); TTFD from "Fully drawn", a 400 ms delay read as 474                                                                                         | **works**: cold 934, warm 307-363, hot 113-126 ms by `am start -W`; a 400 ms slow start read as 352-382 ms                                         | **works**: until the first read; with the probe, process start to first frame, a 500 ms slow start read as 482; `XCTApplicationLaunchMetric` 0.75-1.5 s. **no**: xctrace App Launch records, its launch tables are empty | **works**: until the first read, a 500 ms slow start read as 517; `XCTApplicationLaunchMetric` 0.19-0.20 s. App Launch gave 212 ms by hand, not wired in |
| Compile state       | **works**: asked, recorded and reset. A debuggable app stays at `verify` whatever is asked: only the reset is proven on the fixture                                                                                              | **works**: asked and recorded; a debuggable app stays at `verify`                                                                                  | does not apply                                                                                                                                                                                                           | does not apply                                                                                                                                           |
| Why launch was slow | **works**: Perfetto `android_startups`, `android_startup_opinionated_breakdown`, `slow_start_reason`, with the finding limits; a 1,500 ms start read as bindApplication 1,537 ms. Perfetto v58.2 has no `dur_without_trampoline` | **works**: Perfetto on a 1,500 ms start read 2,358 ms, cold, with its reasons                                                                      | not tried: Time Profiler attaches to a running process, so it misses a launch's start                                                                                                                                    | not tried                                                                                                                                                |
| Frames, hitches     | **works**: gfxinfo; frame timeline with "App Resynced Jitter" as the app's; `android_frame_stats` overrun p95 72 ms on a 40 ms draw against 6 ms on a light one                                                                  | **works**: gfxinfo and frame timeline against the known 40 ms draw                                                                                 | **works, opt-in**: the probe: light 0 % missed, 40 ms a frame 68 % missed, p50 50 ms. Main-thread pacing, not GPU, on the Mac's speed. **no**: Animation Hitches refuses; `XCTHitchMetric` records no value              | **works**: Animation Hitches on a real scroll of the fixture: 258 frames, 4 hitches, ratio 25. **unproven**: `XCTHitchMetric` runs and reads all zeros   |
| Main-thread stalls  | **works**: frame timeline; ANR exits (parser on recorded output, no ANR provoked)                                                                                                                                                | **works**: frame timeline                                                                                                                          | **works, opt-in**: the probe found a 500 ms stall as 522 ms (within the 10 % its test asks)                                                                                                                              | **works**: Time Profiler's `potential-hangs`: a 500 ms stall read as 513.8 ms                                                                            |
| Memory              | **works**: meminfo; `Activities` 1, 1, 4 with 3 leaks; `java_hprof` found 52.9 MB of `byte[]` against 50; heapprofd on a profileable build, once by hand                                                                         | **works**: meminfo within 15 % of 50 MB; `Activities` 1, 1, 4 with 3 leaks; heap dump, `java_hprof`, heapprofd                                     | **works**: `footprint`; `leaks` 0 to 10 on 10 retain cycles; memory graph                                                                                                                                                | **works**: Activity Monitor: +50.7 MB against 50                                                                                                         |
| CPU                 | **works**: `/proc`; each thread, the busy one about 2.5 s above 90 % of its 3 s; simpleperf                                                                                                                                      | **works**: `/proc` against one busy core; each thread; simpleperf                                                                                  | **works**: `ps`, Time Profiler                                                                                                                                                                                           | **works**: Activity Monitor; Time Profiler: the busy loop 98.9 % of samples, as addresses in a Release build                                             |
| Network bytes       | **works**: `dumpsys netstats --poll --uid`: 5.39 MB read for a 5.24 MB download                                                                                                                                                  | **works**: `dumpsys netstats` on 5 MB over Wi-Fi from this Mac                                                                                     | **works**: `nettop`: 5,000,100 bytes for 5 MB. **no**: the Network template says "not supported in the Simulator"                                                                                                        | **no**: the Network template crashes xctrace at stop (`NetworkConnectionStatsModeling`)                                                                  |
| Energy              | **no**: batterystats is all zero                                                                                                                                                                                                 | **works, modelled**: 0.10 mAh for 5 s of a busy screen (screen 0.10, cpu 0.0001). The count since the last charge grows; its history is left alone | **no**: Power Profiler refuses the simulator                                                                                                                                                                             | **no**: the template crashes the same way; the instrument alone leaves its per-process table empty over USB                                              |
| Crashes, ANRs       | **works**: exit-info: Crash raises the count 0 to 1                                                                                                                                                                              | **works**: exit-info: Crash raises the count 0 to 1                                                                                                | **works**: crash reports (`crashes`)                                                                                                                                                                                     | **works**: crash logs (`crashes`)                                                                                                                        |
| Other traces        | **works**: Perfetto, read with `perf_query`                                                                                                                                                                                      | **works**: Perfetto, read with `perf_query`                                                                                                        | **works**: xctrace templates, digested by `perf_query`                                                                                                                                                                   | **works**: the same                                                                                                                                      |
| App size            | **works**: exact against the APK                                                                                                                                                                                                 | **works**: exact against the APK                                                                                                                   | **works**: bundle bytes on disk                                                                                                                                                                                          | **no**: no tool gives it                                                                                                                                 |
| Build type          | **works**: debuggable from `dumpsys package`; profileable from a short Perfetto package list (API 34 prints no flag)                                                                                                             | **works**: debuggable from `dumpsys package`                                                                                                       | **works**: `.debug.dylib` or `get-task-allow`                                                                                                                                                                            | **unknown** for a development-signed app; Settings reads as release                                                                                      |

## The gate

Every measure's numbers are kept as records (`packages/perf`): kind, median, samples and spread, source command, raw output
file, device and OS, virtual or physical, build type, compile state, host and device load, thermal state, tool version and
time. A run goes to `<measurements dir>/runs/<app>/<scenario>/<device class>/`. A baseline goes to
`.appdyno/perf/baselines/<app>/<scenario>/<device class>.json` (`APPDYNO_PERF_DIR` moves it), which can be committed. Limits
go in `.appdyno/perf/budgets.json`: a list of `{ "kind": "launch.ttid_ms", "max": 2000 }`, with `app`, `scenario`, `deviceClass`
and `min` optional.

```text
appdyno perf-launch --app A --mode cold --repeats 6      a measured run, kept
appdyno perf baseline --app A                            adds the newest run to the baseline; at least 3 runs are needed
appdyno perf compare --app A [--format text|json|junit]  exit 1 on a regression or a broken budget
appdyno perf budget --app A                              budgets only
```

The same comes through `perf_compare`. A journey keeps its numbers with `keepRun` from `packages/ops`: a scenario and
metrics, and the comparison reads them like any other.

**How a change is called.** All of: at least 5 samples each side and 3 baseline runs, else `few-samples`, which is no alarm; a rank
test on all baseline samples against the run, p under 0.01 (by permutation, because whole milliseconds tie; 4 against 4 cannot reach
it); a shift past a floor by unit (15 % and 10 ms for times); and past 4 standard deviations of the baseline's run medians. A run under
high load or on a hot device says `noisy` and exit 0, and is refused as a baseline. Unlike builds or compile states say `refused`.

**Why that method.** Samples of one run share its load and heat, so two runs of an unchanged app differ "significantly". Across 72
ordered pairs of unchanged runs, a rank test alone and a 10 % difference of medians alone would have alarmed:

| device, clean runs                           | pairs | rank test alone | 10 % of medians alone | the gate's calls, 6 runs |
| -------------------------------------------- | ----- | --------------- | --------------------- | ------------------------ |
| Android emulator, 6 runs at load 9-16        | 30    | 10              | 24                    | 0                        |
| iOS simulator, 5 runs at load 9-13           | 20    | 2               | 0                     | 0                        |
| iPhone, 9 runs at any host load              | 72    | 10              | 9                     | 0                        |
| iOS simulator, an earlier 9 runs, load 10-15 | 72    | 28              | 25                    | 0                        |

Run medians of the unchanged app: emulator 371-667 ms, simulator 1,661-1,705 ms, iPhone 554-626 ms. On an emulator the same launch read
350 ms and 700 ms minutes apart between load 11 and 16 on 15 cores, and one baseline run at load 41 read 1,661 ms; so a run with host load over
0.8 per core is marked noisy and is refused as a baseline.

Why 4 standard deviations of run medians rather than their range, from `scripts/perf-floor-sim.mjs` (a run moving 6 % by itself, 5 % noise per
launch, 6 launches, 400 trials): false alarms 3.0 % with 3 baseline runs and 2.3 % with 5 for the range, 0.8 % and 0.5 % for 4 sd; +40 % caught
100 % and 99 % against 89 % and 91 %. At 10 % movement no floor is safe with 3 runs (4 sd still 5.8 %), so use more runs on a loaded host, or
a quieter one. These are simulated rates, and what the device runs below show is no false alarm in 6 runs each, not a rate.

**The acceptance tests** (`test-device/perf-compare.test.ts`; the numbers are kept in `.ci/perf-gate.txt`), 6 launches per run, a baseline
of 3 runs, 6 unchanged runs, then the fixture's start made slower by a known amount:

| device            | baseline median | unchanged runs               | false alarms | injected at start | called                      |
| ----------------- | --------------- | ---------------------------- | ------------ | ----------------- | --------------------------- |
| Android emulator  | 491 ms          | 366-764 ms, floor 509 ms     | 0 of 6       | 800 ms            | regression, +553 ms, exit 1 |
| iOS simulator     | 1,673 ms        | 1,659-1,787 ms, floor 251 ms | 0 of 6       | 1,000 ms          | regression, +983 ms, exit 1 |
| iPhone 13 Pro Max | 563 ms          | 553-620 ms, floor 84 ms      | 0 of 6       | 400 ms            | regression, +471 ms, exit 1 |

On 2026-11-03 the iPhone's gate passed once and, at host load 10-38 with other work on the Mac, called one unchanged run in another: 623 ms against 540.5, a shift of 83.5 over a floor of 81. A third run had 5 of 5 unchanged runs ok, then reached its hour's limit at host load over 100. So 0 of 6 is what those runs show, not a rate. The floor was left as it is.

On a Xiaomi the gate gave no verdict: its device load read 14-16 each time, over the limit of 8 (`DEVICE_LOAD` in `packages/perf/src/record.ts`), and its run answered `new`, with no baseline. That limit does not suit such a phone, and is open.

An injected change has to clear what that device's runs do by themselves, so a smaller one on a loaded simulator is not called: it is
reported as `ok`, with the floor beside it. On an emulator a sleep at the start of a very fast launch shows only partly: 400 ms added
about 230 ms, because the system's own start work runs alongside it.

Kept traces and runs stay on this machine until removed; nothing prunes them.

## Asking a kept trace

`perf_query` answers from a kept trace with no new recording: read-only SQL on a `.pftrace` through the pinned trace processor (optional
`INCLUDE PERFETTO MODULE` lines, then one `SELECT` or `WITH`), and on an Instruments `.trace` a table digested to its top rows (`table`; none
lists the tables). Rows are bounded, cells cut at 200 characters, and only files under the traces or measurements folders are read.

## The simulator's frame probe

Opt-in with `probe: true` on `perf_scroll`, `perf_trace` and `perf_launch`: `ios/SimHelper/SimProbe.m`, compiled on first use with clang (no binary
ships), injected through `SIMCTL_CHILD_DYLD_INSERT_LIBRARIES`. The app relaunches once, unless it runs under the probe already; the app is not
rebuilt. It runs a `CADisplayLink` on the main run loop and writes every frame interval, stalls over 100 ms, and when the app last finished
handling a touch. Every result says what it is: main-thread pacing, not the render server or GPU, on the Mac's speed. It finds stalls and
regressions on one machine; it does not predict a phone's frame rate.

## What is measured and how

| measure        | source                                                                                                | notes                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| frames         | `dumpsys gfxinfo <pkg> framestats`, then `reset` in the same shell                                    | summary (total, janky %, p50–p99, frozen = frames ≥ 700 ms from the histogram) and the last ~120 frames of every window: a frame taking over two vsync intervals from its vsync to completion is slow (a smooth frame takes about one, the render pipeline). Some releases print `FrameInterval` and `FrameStartTime` swapped against their header: the interval is the column with a plausible period.                                                     |
| frame timeline | Perfetto `android.surfaceflinger.frametimeline` (Android 12+), analysed by the pinned trace processor | every frame of the app's process with its jank type: app deadline missed, buffer stuffing, compositor (SurfaceFlinger, display HAL, prediction error). The app's own share (app deadline missed) is reported apart: an emulator marks nearly every frame with a prediction error of its emulated display (measured: 122 of 122 frames of a smooth animation), which is not the app's. `appdyno tools install` fetches Perfetto v58.2 and checks its sha256. |
| memory         | `dumpsys meminfo <pkg>`                                                                               | TOTAL PSS (what the system charges the app), Java and native heap, graphics, private dirty                                                                                                                                                                                                                                                                                                                                                                  |
| CPU            | `/proc/<pid>/stat` utime + stime before and after a window, `getconf CLK_TCK`                         | **works**: `/proc` against one busy core; each thread; simpleperf                                                                                                                                                                                                                                                                                                                                                                                           |
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

| measure     | simulator                                                                                                                                 | iPhone                                                            | notes                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| memory      | `footprint <pid>` (physical footprint)                                                                                                    | Activity Monitor, every process, `memory-physical-footprint`      | the phone's footprint at the end of the recording; no attach, so a system app can be read                                                                                                                                                                                                                                                                                |
| CPU         | `ps -o time=` before and after a window                                                                                                   | **works**: `/proc` against one busy core; each thread; simpleperf | % of one core                                                                                                                                                                                                                                                                                                                                                            |
| launch      | `simctl launch` until the first screen reads                                                                                              | `devicectl` until the runner reads the first screen               | cold: terminated first; warm: another app in between. One warm-up left out, the median of the rest; includes a read. xctrace's App Launch needs `get-task-allow`: denied for Settings                                                                                                                                                                                    |
| CPU profile | Time Profiler, attached (`sample` sees no busy samples of a simulator app under macOS 27, and stays only for a Mac where attaching fails) | **works**: `/proc` against one busy core; each thread; simpleperf | the busiest functions by the weight of the samples on top of their stacks, and the app's own functions (of a binary inside an .app) by inclusive weight; the trace stays for Instruments                                                                                                                                                                                 |
| heap        | `leaks --outputGraph` (a memory graph for Xcode), the leaks found                                                                         | –                                                                 | the summary is read from the saved graph                                                                                                                                                                                                                                                                                                                                 |
| hangs       | –                                                                                                                                         | Time Profiler's `potential-hangs`                                 | library only (`measure.hangs`): there is no Hangs template in Xcode 27.1, the Time Profiler has the table                                                                                                                                                                                                                                                                |
| hitches     | –                                                                                                                                         | `xctrace record --template 'Animation Hitches'`, exported         | frames shown, the app's hitches, their total and worst time, the hitch ratio and the likely causes. **A recording with no displayed surfaces is UNSUPPORTED, never "no hitches".** The few surfaces seen earlier came from our own bug: the start note was never noticed, so the scroll ran 30 s late, outside the recording. On a simulator the tool's recording fails. |

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
| appdyno      | 54-56   | 894-916     | 733-776      | 84-88      | 292-359                       | 179-183               |
| another-server   | 220-255 | 848-909     | 848-888      | 334-403    | no screen: 116-133            | 133-137               |
| another-tool | 55-74   | 1,210-1,335 | 1,128-1,189  | 545-548    | no screen: 167-219            | 1,328-1,362           |

Three runs of appdyno, two of each other, alternating, host load 4-14. appdyno's read follows its own back there, with the
app still busy: at rest it took 31-32 ms, 25 ms of it in the helper for 167 elements. No stale answer in any run.

Tap and see is not beaten: `another-server` is as fast or up to 50 ms faster, but it answers during the push. 11-15 lines of
its answer were not in a read 1.5 s later in all 8 checks, the old page's rows at their sliding places. appdyno's
answers against a read 1.5 s later: nothing moved, missing or extra in 20 answers (`test-device/ios.test.ts` keeps this
check). The same check on `another-tool` was not valid (its answer is a diff). Opening an app is not beaten either:
`another-server` returns when `simctl launch` does, with no screen; appdyno also waits for the app to be in front, and with
a screen it reads twice around the 200 ms `launch_app` waits for stillness in `packages/ops`.

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
