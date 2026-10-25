# Performance measurement (Android)

Every measurement is read from the platform's own tools and stored with the raw output it came from
(`<measurements dir>/pm-<id>.json` and `.txt`; the MCP server's `--measurements`, default
`~/Library/Caches/appdyno/measurements`). Commands run in the C locale. Nothing leaves the machine.

## What is measured and how

| measure        | source                                                                                                | notes                                                                                                                                                                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| frames         | `dumpsys gfxinfo <pkg> framestats`, then `reset` in the same shell                                    | summary (total, janky %, p50–p99, frozen = frames ≥ 700 ms from the histogram) and the last ~120 frames: a frame slower than its vsync interval is slow. Some releases print `FrameInterval` and `FrameStartTime` swapped against their header: the interval is the column with a plausible period. |
| frame timeline | Perfetto `android.surfaceflinger.frametimeline` (Android 12+), analysed by the pinned trace processor | every frame of the app's process with its jank type: app deadline missed, buffer stuffing, compositor (SurfaceFlinger, display HAL, prediction error). `appdyno tools install` fetches Perfetto v58.2 and checks its sha256.                                                                   |
| memory         | `dumpsys meminfo <pkg>`                                                                               | TOTAL PSS (what the system charges the app), Java and native heap, graphics, private dirty                                                                                                                                                                                                          |
| CPU            | `/proc/<pid>/stat` utime + stime before and after a window, `getconf CLK_TCK`                         | % of one core (over 100 on several cores)                                                                                                                                                                                                                                                           |
| launch         | `am start -W`                                                                                         | cold: the app is stopped first; warm: it goes home and comes back. One warm-up launch is left out, then the median TotalTime of the launches the system reports in that state. WaitTime includes `am`'s own cost and is not used.                                                                   |
| device state   | `/proc/loadavg`, `/proc/pressure/cpu`, `/proc/meminfo`, `dumpsys thermalservice`, `dumpsys battery`   | recorded with measurements: a loaded device explains slow frames that are not the app's                                                                                                                                                                                                             |

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
