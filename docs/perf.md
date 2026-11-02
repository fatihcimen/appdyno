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

| measure     | simulator                                                                                                                                 | iPhone                                                       | notes                                                                                                                                                                                                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| memory      | `footprint <pid>` (physical footprint)                                                                                                    | Activity Monitor, every process, `memory-physical-footprint` | the phone's footprint at the end of the recording; no attach, so a system app can be read                                                                                                                                                                                       |
| CPU         | `ps -o time=` before and after a window                                                                                                   | Activity Monitor, `cpu-total` first and last reading         | % of one core                                                                                                                                                                                                                                                                   |
| launch      | `simctl launch` until the first screen reads                                                                                              | `devicectl` until the runner reads the first screen          | cold: terminated first; warm: another app in between. One warm-up left out, the median of the rest; includes a read. xctrace's App Launch needs `get-task-allow`: denied for Settings                                                                                           |
| CPU profile | Time Profiler, attached (`sample` sees no busy samples of a simulator app under macOS 27, and stays only for a Mac where attaching fails) | Time Profiler, every process, one read (attaching stops working at times on iOS 27.0.1)         | the busiest functions by the weight of the samples on top of their stacks, and the app's own functions (of a binary inside an .app) by inclusive weight; the trace stays for Instruments                                                                                        |
| heap        | `leaks --outputGraph` (a memory graph for Xcode), the leaks found                                                                         | –                                                            | the summary is read from the saved graph                                                                                                                                                                                                                                        |
| hangs       | –                                                                                                                                         | Time Profiler's `potential-hangs`                            | library only (`measure.hangs`): there is no Hangs template in Xcode 27.1, the Time Profiler has the table                                                                                                                                                                       |
| hitches     | –                                                                                                                                         | `xctrace record --template 'Animation Hitches'`, exported    | frames shown, the app's hitches, their total and worst time, the hitch ratio and the likely causes. **Xcode 27.1 on iOS 27.0.1 records no displayed surfaces while scrolling (0 of 3 recordings): UNSUPPORTED, never "no hitches".** On a simulator the tool's recording fails. |

A simulator's numbers are relative: `Device.virtual` is true there, false on a phone, and the tools say so.

`test-device/ios-perf.test.ts` checks the simulator measures on the fixture: 50 MB held (memory, within
15 %), one busy thread (CPU, 80–125 %, and the profile's top app function, from a trace), a memory graph with
its leaks summary, cold launches slower than warm. `test-device/iphone.test.ts` reads memory, CPU, a profile, the
hangs and a launch of Settings; a cost-known check of them needs an app signed for the phone.

## iOS simulator speed

Measured with the Settings scenario on an iPhone 17 Pro simulator, iOS 26.5, on a Mac with other builds running
(load in the table). Median of 10-15 rounds, in ms, alternating tools.

SPEED_TABLE

What each change did, the rest of the scenario held still:

LEVER_TABLE

Tried and dropped:

DROPPED_LIST
