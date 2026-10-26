# Performance measurement

Every measurement is read from the platform's own tools and stored with the raw output it came from
(`<measurements dir>/pm-<id>.json` and `.txt`; the MCP server's `--measurements`, default
`~/Library/Caches/appdyno/measurements`). Commands run in the C locale. Nothing leaves the machine.

## What is measured and how

| measure        | source                                                                                                | notes                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| frames         | `dumpsys gfxinfo <pkg> framestats`, then `reset` in the same shell                                    | summary (total, janky %, p50–p99, frozen = frames ≥ 700 ms from the histogram) and the last ~120 frames of every window: a frame taking over two vsync intervals from its vsync to completion is slow (a smooth frame takes about one, the render pipeline). Some releases print `FrameInterval` and `FrameStartTime` swapped against their header: the interval is the column with a plausible period.                                                          |
| frame timeline | Perfetto `android.surfaceflinger.frametimeline` (Android 12+), analysed by the pinned trace processor | every frame of the app's process with its jank type: app deadline missed, buffer stuffing, compositor (SurfaceFlinger, display HAL, prediction error). The app's own share (app deadline missed) is reported apart: an emulator marks nearly every frame with a prediction error of its emulated display (measured: 122 of 122 frames of a smooth animation), which is not the app's. `appdyno tools install` fetches Perfetto v58.2 and checks its sha256. |
| memory         | `dumpsys meminfo <pkg>`                                                                               | TOTAL PSS (what the system charges the app), Java and native heap, graphics, private dirty                                                                                                                                                                                                                                                                                                                                                                       |
| CPU            | `/proc/<pid>/stat` utime + stime before and after a window, `getconf CLK_TCK`                         | % of one core (over 100 on several cores)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| launch         | `am start -W`                                                                                         | cold: the app is stopped first; warm: it goes home and comes back. One warm-up launch is left out, then the median TotalTime of the launches the system reports in that state. WaitTime includes `am`'s own cost and is not used.                                                                                                                                                                                                                                |
| device state   | `/proc/loadavg`, `/proc/pressure/cpu`, `/proc/meminfo`, `dumpsys thermalservice`, `dumpsys battery`   | recorded with measurements: a loaded device explains slow frames that are not the app's                                                                                                                                                                                                                                                                                                                                                                          |

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

A simulator app is a Mac process: its measures come from the Mac's own tools. A phone's frames come
from Xcode's trace tool.

| measure     | simulator                                                         | iPhone                                                    | notes                                                                                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| memory      | `footprint <pid>` (physical footprint)                            | –                                                         | the pid from the simulator's `launchctl list`                                                                                                                                                                          |
| CPU         | `ps -o time=` before and after a window                           | –                                                         | % of one core                                                                                                                                                                                                          |
| launch      | `simctl launch` until the runner reads the app's first screen     | –                                                         | cold: terminated first; warm: another app in between. One warm-up left out, the median of the rest; includes the runner's read (about 60 ms)                                                                           |
| CPU profile | `sample <pid>`                                                    | –                                                         | the busiest functions by self time, idle waits left out, and the app's own functions by busy inclusive time (a debug build spends a loop's time in runtime helpers; waiting threads do not count)                      |
| heap        | `leaks --outputGraph` (a memory graph for Xcode), the leaks found | –                                                         | the summary is read from the saved graph                                                                                                                                                                               |
| hitches     | –                                                                 | `xctrace record --template 'Animation Hitches'`, exported | frames shown, the app's hitches (system ones left out), their total and worst time, the hitch ratio (ms per second) and the likely causes; the trace stays for Instruments. On a simulator the tool's recording fails. |

`test-device/ios-perf.test.ts` checks the simulator measures on the fixture: 50 MB held (memory, within
15 %), one busy thread (CPU, 80–125 %, and the profile's top app function), a memory graph with its leaks
summary, cold launches slower than warm. `test-device/iphone.test.ts` records hitches while Settings
scrolls (frames counted, the trace written); a cost-known frames check needs an app signed for the phone.
