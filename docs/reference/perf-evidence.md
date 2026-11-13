# How the measures were validated

[Türkçe](perf-evidence.tr.md)

What each measure of [Performance measurement](perf.md) read against a known cost, on which device, on which day and at what load, and what was tried and dropped on the way. A number here is relative to the Mac it was read on, an M5 Pro with 15 cores unless said otherwise. The **fixture** is this project's own test app (`dev.appdyno.fixture`), which adds a known cost on request; **host load** is the Mac's 1-minute load average.

## What was tried, cell by cell

Xcode 27.1, iOS 27.0.1 on a cable, iOS 26.5 on the simulator, 2026-11-03. Host load beside what depends on it.

**Why launch was slow, simulator.** App Launch with `--launch` records (287 s at host load 30) and its `life-cycle-period` has 0 rows, so attaching was not what emptied it. What reads it is the probe, phase by phase, and a Time Profiler attached to a process that `simctl launch --wait-for-debugger` holds before its first instruction, let go with `SIGCONT` when the recording has started (16 s at load 14).

**Why launch was slow, iPhone.** App Launch with `--launch`. Settings answers "Permission to debug com.apple.Preferences was denied ... signed with 'get-task-allow'" within 4 s, and the measure asks first, so a refusal costs no launches.

**Frames, frozen frames, stalls, iPhone.** A 1 s stall of the main thread in a scroll shows as a hitch of 50 ms and as a hang of 1.02 s in one Animation Hitches recording: no frame was on its way, so nothing was late. A frozen frame there is a hitch or a hang of 700 ms or longer, the two of one moment counted once. A steady low rate is no hitch: a list doing 40 ms on each frame read 0 to 4 % janky against 0, at 150 frames a round to 400. So `frames.p95_ms` there is a frame's time on the screen, from the `displayed-surfaces-interval` table, leaving out what stayed 700 ms or longer, the screen at rest between swipes or a frozen frame.

**Leaks, iPhone.** The Leaks template attached. Its table is under `tracks/track/details/detail`, not `data/table`, and has one row per leaked object. Its first look at the heap comes 10 s in: a recording of 5 s reads 0 of 3 retain cycles made, one of 12 s reads all, so it records 15 s. Settings answers "Unable to acquire required task port". An earlier attempt never started at host load 400 and over; at load 7-24 it takes 18 s.

**Network, iPhone.**

| variant                                            | what it did                                                                                                                                                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network template, a stop or a time limit           | crashes `xctrace` at the end, `NetworkConnectionStatsModeling`, no trace                                                                                                                                                                           |
| `--instrument "Network Connections"`, a time limit | the same, exit 133                                                                                                                                                                                                                                 |
| `--instrument "HTTP Traffic"`, a time limit        | records; `response.content.size` in its HAR rows. Left out: it covers the URL Loading System only, and Apple says it stores encrypted traffic unencrypted in the trace                                                                             |
| Activity Monitor's tables                          | disk bytes, no network column                                                                                                                                                                                                                      |
| `--instrument "Power Profiler"`, attached          | **works**: `wifi-received` and `cellular-received` by process, in periods of 5 s: 5,322,769 bytes for a download of 5,000,000 (+6.5 %), and 10,432 sent, the fetch going straight to this Mac with no proxy on its path. Needs no `get-task-allow` |

`rvictl` and `tcpdump` were not tried: `/dev/bpf0` is root-only.

**Energy, iPhone.** The per-process table was empty because of `--all-processes`, not USB or charging: attached, the same instrument on a cable, charging (`DeviceChargingState` has its row, and `SystemPowerLevel` reads 0.0 %/hr as Apple says it does then), fills it. `cpu-impact` read 0 at rest and 19 on a busy core. The whole template fails with `--all-processes` ("The Location Energy Model instrument doesn't support profiling All Processes") and crashes at stop when attached, exit 133, so it is the instrument alone. Only an Instruments score, so no joules. On-device Performance Trace was not tried: it needs a person's hands, and iOS 27's release notes list that widget as failing to produce these traces (184729556).

**Energy, emulator.** `dumpsys battery unplug`, a core busy for 9 s: `Computed drain: 0`, no row for the app, and `UID 1000: cpu=0 (1s 906ms)`. Its power profile is all zeros, so this is the model.

**Energy, Android phone.** An unplug at a high level or after a charge resets the count since the last charge. On an emulator at level 100, `Time on battery` went 8 s back to 1 s at the next unplug; with `dumpsys batterystats enable no-auto-reset` first it went 13.3 s, 14.5 s, 18.7 s. So the guard comes first, and a build that does not answer "Enabled" is not unplugged and gets the model. On the Xiaomi, at level 100 and full, three energy reads through the tool left its count going on: 24.6 s, 31.4 s, 38.5 s, 45.9 s. `--usage` and `--charged <pkg>` read the same on the Xiaomi (2.84 and 2.83 mAh), `--usage` being the shorter.

**The trace tool and a running process.** On a phone `--attach` answers "Cannot find process for provided pid" at times, for a process that runs: the same pid not found for 100 s, then found, whichever way it is named. What needs an attach looks again every 5 s for 3 minutes.

**The trace tool and its own traces.** After a recording attached to a process, the tool says `Cannot find process` of it for about 3 minutes, 189 and 196 s here, while it runs under the same pid, in any template. A second measure that attaches waits that out, up to 240 s, and a TIMEOUT says so. Xcode 27.1's `xctrace export` dies now and then as it loads a trace: `NSInvalidArgumentException` from a sort on its own `TrackElaboratorQueue`, naming whatever then sits at a freed address (`XRAnalysisCoreQueryTicket`, `OS_dispatch_group`). No query avoids it: it died on a read of a trace's list of tables too. On one Activity Monitor trace 3 of 242 reads of `activity-monitor-process-live` died, the first with nothing else running, and the next read of the file worked each time. A read that dies by a signal is made again, up to 3 reads: through that, 200 of 200 came back over 2 such deaths.

## A Baseline Profile

The starts with and without the profile take turns. Measuring all of one and then all of the other mistakes the Mac's drift for the profile: 8 starts of each that way read 181 ms without and 249 ms with on a light screen, and a screen with 150 Compose controls, measured in turns, read every start with the profile below every start without. So a change is called on the rank test and the floor of [the gate](perf.md#the-gate), with no term for how runs move apart, which taking turns already deals with.

`cmd package compile --reset` clears a profile written by the broadcast: 34,371 rules went to 0, and a `speed-profile` compile after it answered Success and stayed at `verify`. So the profile goes in again before each turn, and an app with neither ProfileInstaller nor a `.dm` is refused rather than timed with nothing compiled. A profile from a `.dm` survives the reset. Android 17's reset keeps it and compiles nothing with it, so an app the `.dm` had compiled is compiled at `speed-profile` again after each measure, and reads `reason=cmdline` after. The app ends as an install leaves it, and a profile it gathered in use goes with that.

By `device-tests/baseline-profile.test.ts`, on an emulator with API 34, host load 6-9, the fixture's release build, whose first frame is 150 Compose controls and which holds the rules Compose's libraries ship:

| installed           | present | on the device                                       | without | with   | called          |
| ------------------- | ------- | --------------------------------------------------- | ------- | ------ | --------------- |
| the APK             | yes     | `status=verify reason=install`, not applied         | 254 ms  | 148 ms | 43 %, worth it  |
| with its `.dm`      | yes     | `status=speed-profile reason=install-dm`, applied   | 248 ms  | 170 ms | 33 %, worth it  |
| another's `.dm`     | yes     | `status=verify reason=install-dm`, nothing compiled |         |        |                 |
| `com.android.shell` | no      | `status=verify reason=prebuilt`                     |         |        | none in the APK |

On an emulator with API 37 on 2026-11-08 the same test passed, the `.dm` of another range refused at install. An emulator's times are relative to this Mac, and what a phone gains has not been measured: ProfileInstaller refused the only phone tried. The two numbers are kept as `launch.without_profile_ms` and `launch.with_profile_ms`, under the scenario `launch-baseline-profile`.

## The gate

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
0.8 per core is marked noisy and is left out of a baseline. So is a phone's number that is timed on the Mac (an iPhone's launch, to the first screen it reads), and not what a phone reports itself.

Why 4 standard deviations of run medians rather than their range, from `scripts/perf-floor-sim.mjs` (a run moving 6 % by itself, 5 % noise per
launch, 6 launches, 400 trials): false alarms 3.0 % with 3 baseline runs and 2.3 % with 5 for the range, 0.8 % and 0.5 % for 4 sd; +40 % caught
100 % and 99 % against 89 % and 91 %. At 10 % movement no floor is safe with 3 runs (4 sd still 5.8 %), so use more runs on a loaded host, or
a quieter one. These are simulated rates, and what the device runs below show is no false alarm in 6 runs each, not a rate.

Why `noisy` from p 0.01 to 0.05, from the same script, by the gate itself, 400 trials: launches with no slow ones read the same before and after, no run `noisy`. Where one launch in ten takes 1.5 to 3 times as long, as a simulator's do, an unchanged run read `regression` as before, 2.0 % with 3 baseline runs and 0.5 % with 5, and `noisy` 0.3 % and never; a run 40 % slower, which passed as `ok` 24.0 % and 16.5 % of the time, now stops on 9.0 % and 1.5 % more. On counts of 5 samples a run at a floor of 0.5, an unchanged count stops as `noisy` up to 1 % more, and never as a `regression` more. Stopping every unconfirmed shift past the floor, with no band, stopped up to 5 % of those counts.

Why a count's floor is 0.5, from the same script, by the gate itself on counts that follow a Poisson law, 3 baseline runs, 400 trials. At a floor of 1 a rise from none read `ok` every time, so a crash on every run passed. Under 1 it never reads `ok`: with one sample a run it is `few-samples`, exit 1, and with 5 it is `regression`. What that costs an unchanged count of one sample a run is more stops, and all of them `few-samples`: 0 % to 6 % at a rate of 0.1 a run, 4 % to 12 % at 0.5, 4 % to 7 % at 1, 5 % to 10 % at 2, and no change from 3 up. Floors of 0.25, 0.5 and 0.75 read the same within the trials: on whole counts a move is at least a half.

**The acceptance tests** (`device-tests/perf-compare.test.ts`, which writes its numbers to `.ci/perf-gate.txt` on the machine that runs it), 6 launches per run, a baseline
of 3 runs, 6 unchanged runs, then the fixture's start made slower by a known amount:

| device            | baseline median | unchanged runs               | false alarms | injected at start | called                      |
| ----------------- | --------------- | ---------------------------- | ------------ | ----------------- | --------------------------- |
| Android emulator  | 491 ms          | 366-764 ms, floor 509 ms     | 0 of 6       | 800 ms            | regression, +553 ms, exit 1 |
| iOS simulator     | 1,673 ms        | 1,659-1,787 ms, floor 251 ms | 0 of 6       | 1,000 ms          | regression, +983 ms, exit 1 |
| iPhone 13 Pro Max | 563 ms          | 553-620 ms, floor 84 ms      | 0 of 6       | 400 ms            | regression, +471 ms, exit 1 |

On 2026-11-03 the iPhone's gate passed once and, at host load 10-38 with other work on the Mac, called one unchanged run in another: 623 ms against 540.5, a shift of 83.5 over a floor of 81. A third run had 5 of 5 unchanged runs ok, then reached its hour's limit at host load over 100. So 0 of 6 is what those runs show, not a rate. The floor was left as it is.

On a Xiaomi the gate gave no verdict: its device load read 14-16 each time, over the limit of 8 (`DEVICE_LOAD` in `packages/perf/src/record.ts`), and its run answered `new`, with no baseline. At rest it read 14.31 with one task running and `procs_blocked` 0: the load was 14 kernel threads in uninterruptible sleep (`wdtk-0` to `wdtk-7`, `hang_detect`, `ccci_poll` and others), which Linux counts though they use no CPU, and `/proc/pressure/cpu` is closed to the shell there. Taking that count from the load was not enough: on 2026-11-05 the same phone read a load of 22.6 at the end of a run, 8.6 past 14 such threads, and an 800 ms stall was not called. Left alone it read 4-7 % of its CPU at work with its load at 24-26. So a record keeps the share of all cores at work over 2 s as a run ends, from `/proc/stat`: over 80 % is `high-device-load`, and the load only decides where that cannot be read. 80 % is a judgement between 6 % at rest and 99 % at work, and real runs read 4-50 %. With that the same stall was called, +645 ms, with the Mac at load 218. Run on 2026-11-04, at host load 250-370: a baseline of 900 ms, 6 unchanged runs of 837-928 ms against a floor of 135 ms and no false alarm, and an injected 800 ms called a regression, +723.5 ms, exit 1. An Android phone's launches do not wait for the Mac in this test, as what `am start -W` reports is the phone's. An iPhone's do: its time runs until the runner reads the first screen, and read 550 ms on a calm Mac and 1.3-3 s at host load 100-600. On 2026-11-04 its shortened gate at load 57-125 called one unchanged run in six a regression, 83 ms past a floor of 1,015 ms, and at load 50-370 missed an injected 400 ms under a floor of 370 ms: at that load it says nothing either way.

A Samsung SM-A525F with Android 14 hides the other number: `/proc/loadavg` reads `0.00 0.00 0.00` with tasks running, so its load shows as `?` rather than as a calm device, and the limit on CPU pressure does the work. `/proc/pressure/cpu`, closed on the Xiaomi, read 2.3 to 6.1 through these runs against a limit of 40. By `device-tests/journey.test.ts` on 2026-11-04, host load 46-293, 700 ms added to one step read `regression journey.04_tap_id_load.ms: 1695 ms against 1054, +676 ms, p 0.0002`, and an unchanged run `ok`, +83 ms under a floor of 158 ms. The thermal status read 0 throughout. It is on the tenth line of its dump on both phones, and only five were read until that day, so no phone had yet been called `hot-device`.

An injected change has to clear what that device's runs do by themselves, so a smaller one on a loaded simulator is not called: it is
reported as `ok`, with the floor beside it. On an emulator a sleep at the start of a very fast launch shows only partly: 400 ms added
about 230 ms, because the system's own start work runs alongside it.

## Kept traces

What `xctrace` leaves does not stay: each recording writes an `instruments*.ktrace` of up to 0.7 GB in the user's temp folder and leaves it there, and it takes no `TMPDIR`, as a recording given a folder of its own still wrote in the usual one. So a recording removes what it made, by when it was made and what its tool held, behind its result, once `DTServiceHub`, which outlives the tool, has let go: 4-12 s at load 60, and past 150 s once. That `DTServiceHub` is the tool's child, which launchd keeps after the tool, minutes after an end and 15 after a kill here, and 58 of them for days: the recording ends it once the tool has ended, by the pid it had as the tool's child. What any process has open stays. With another recording or Instruments running, only what this run held goes. What stays open, or a run killed with appdyno itself, leaves a line in the state folder, and the next recording finishes it. By `device-tests/trace-temp.test.ts`, on recordings of this Mac with Xcode 27.1, at load 10-100: a recording, one whose `xctrace` was killed with `SIGKILL`, and one with no appdyno left at all, each gone by the next recording, and the trace of the first still read.

An earlier version read a context's own runs and deleted from the state folder, so a context with no runs saw every trace as free, and unit tests ran it on this Mac's real folder. Only the limit stopped it. So a unit test now has a state folder of its own, and `packages/appdyno/test/no-real-state.setup.ts` watches every file call in every worker: one on `~/Library/Caches/appdyno` throws, and fails the run at its end even if the error is swallowed. Proven both ways: a clean run exits 0, and a swallowed read exits 1 naming the call.

## Why a slow frame was slow

Each frame given a known 100 ms on the fixture, by `device-tests/frame-cause.test.ts`, on the Xiaomi, Android 16, host load 19-22 (the phone's own trace):

| known cost in each frame                      | named                                     | read                   |
| --------------------------------------------- | ----------------------------------------- | ---------------------- |
| a monitor another thread holds for 100 ms     | a monitor lock, the holder and its method | 91.6 ms a frame, 96 %  |
| a synchronous call to a process taking 100 ms | binder calls, to that process             | 102.3 ms a frame, 97 % |
| allocating for 100 ms                         | the garbage collector                     | 93.9 ms a frame, 84 %  |
| a loop of 100 ms                              | at work on the main thread                | 101 ms a frame, 99 %   |
| a sleep of 40 ms                              | asleep, with nothing named holding it     | 40.4 ms a frame, 94 %  |
| none                                          | nothing: no frame missed                  |                        |

A first version of the binder case spent 100 ms in a framework call, and the answer named work on the main thread: 89 ms was the client's own, 14 ms the binder call. So a framework call that is slow in the app's process is named as work, which is what it is.

## Why a hang was a hang, and which function moved

By `device-tests/measures-iphone.test.ts`, on the iPhone, iOS 27.2: a 500 ms sleep read blocked, 513.6 ms, 2.3 % on the CPU; a 500 ms loop read busy, 505.2 ms, 100 %, in `busyMainThread()`.

`xctrace symbolicate --dsym` answered "No dSYMs were found or relevant" for that phone's trace and the dSYM of the very build in it, UUID for UUID, given the bundle, its folder or the DWARF file. On a simulator it has only run in a unit test.

By `device-tests/function-diff.test.ts`, on the Xiaomi, host load 13: two runs of the same work named nothing, and 300 ms a second put into one function read `+296 knownCost`, first of the diff.

## Why it got worse

Against what was put there on purpose, by `device-tests/gate-why.test.ts`, on 2026-11-04, each on a baseline of 3 runs of 5 iterations, 6 launches for a start, and a reference, on an emulator with API 34 and an iPhone 17 simulator with iOS 26.5, each made for the test, host load 6-10 on 15 cores. The cost is 800 ms in one step or at the start, read from a file or the environment by the same fixture build:

| device    | put there                                 | the gate                                           | the answer                                                    |
| --------- | ----------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| emulator  | nothing                                   | no regression, exit 0                              | nothing looked at                                             |
| emulator  | the main thread at work, in `knownCost`   | +616 ms, p 0.0002, exit 1                          | `CpuActivity.knownCost`, +710 ms of CPU in the step, 0 to 710 |
| emulator  | the main thread asleep, in a touch        | +616 ms, p 0.0002, exit 1                          | no function, no frame missed: no cause was found              |
| emulator  | a sleep in `Application.onCreate`         | +815.5 ms, p 0.00005, exit 1                       | the phase `bind_application`, +810.5 ms, 8.8 to 819.3         |
| simulator | nothing                                   | no regression, exit 0                              | nothing looked at                                             |
| simulator | the main thread at work, in `knownCost()` | +318 ms, p 0.0002, just past its floor, exit 1     | `knownCost()`, +800 ms of CPU in the step, 0 to 800           |
| simulator | the main thread asleep, in a touch        | +327 ms, p 0.0002, just past its floor, exit 1     | no function: no cause was found, and a probe sees no why      |
| simulator | a sleep in the app's `init`               | +792 ms, p 0.00005, exit 1, timed through the host | the phase `main`, +805.6 ms, 13.7 to 819.3                    |

A step's time rose by less than the 800 ms put in, on the simulator by 318 ms, while the profile read nearly all of it: why the two differ was not looked into.

On real phones, on 2026-11-05, by the same test, with the Release fixture on an iPhone with iOS 27.2 and the debug fixture on a Xiaomi 25078RA3EY with Android 16. Their baselines were 3 runs, and 5 of one traced start on the iPhone. The Mac was at load 13-60 for the iPhone and 13-355 for the Xiaomi, with other work on it:

| device | put there                                 | the gate                                      | the answer                                                                  |
| ------ | ----------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| iPhone | nothing                                   | no regression, exit 0                         | nothing looked at                                                           |
| iPhone | the main thread at work, in `knownCost()` | +578 ms, p 0.0002, exit 1                     | `knownCost()`, +791 ms of CPU, 0 to 791; a hang of 809.5 ms, busy, in that  |
| iPhone | the main thread asleep, in a touch        | +642 ms, p 0.0002, exit 1                     | no function; a hang of 835.6 ms, blocked, 3.9 % on the CPU, in `main`       |
| iPhone | a sleep in the app's `init`               | the phase `main`, +805.2 ms, p 0.0077, exit 1 | the phase `main`, +804 ms, 11.9 to 815.9                                    |
| Xiaomi | nothing                                   | no regression, exit 0, Mac at load 355        | nothing looked at                                                           |
| Xiaomi | the main thread at work, in `knownCost`   | +645 ms, p 0.0002, exit 1, Mac at load 218    | `CpuActivity.knownCost`, +521 ms of CPU, 0 to 521, 81 % of the change       |
| Xiaomi | the main thread asleep, in a touch        | +646 ms, p 0.0002, exit 1                     | no function: no cause was found                                             |
| Xiaomi | a sleep in `Application.onCreate`         | +884.5 ms, p 0.0003, exit 1                   | the phase `bind_application`, +762.1 ms, 130.3 to 892.4, 86 % of the change |

| device | put there                          | the gate                                                              | the answer                                                                                                                             |
| ------ | ---------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Xiaomi | each frame of a list 40 ms longer  | 28 % of frames janky against 0, p95 89 ms against 8, p 0.0002, exit 1 | `HeavyListActivity.heavyFrame`, +857.3 ms of CPU a second, 0 to 857.3; the 138 slow frames at work on the main thread, 42.3 ms a frame |
| Xiaomi | a core at work off the main thread | `cpu.percent` 48.1 against 0, p 0.0077, exit 1, Mac at load 180       | `CpuActivity.knownCost`, +490.3 ms of CPU a second, 0 to 490.3                                                                         |
| iPhone | each frame of a list 40 ms longer  | `frames.p95_ms` 75 ms against 37.5, p 0.0002, exit 1                  | `FramesScreen.Animator.tick(_:)`, +836.3 ms of CPU a second, 0 to 836.3                                                                |
| iPhone | a core at work off the main thread | `cpu.percent` 51 against 0, p 0.0077, exit 1                          | `knownCpuCost(_:)`, +354.3 ms of CPU a second, 0 to 354.3                                                                              |

On an iPhone the number is Activity Monitor's own `cpu-percent`. A core kept at 12.5, 25, 50 and 75 % of each second read 12-16, 24-28, 47-52 and 71-76. Its `cpu-total` comes at the end of a row and the first row is short, so reckoned over the rows' starts the same core read 20-27, 42-52 and 82-93. The profile's share of that core is low, 354 ms of a true 500, which is not explained. A CPU number takes five snapshots, one sample each. The app has to have settled before the first: a sample in its own start read 46.7 % against 0 after it, and one such run widens the gate's run-to-run limit past a change of 48, which is the gate being right about a baseline that is not one. A phone's screen also goes dark in the time five snapshots take, and an app behind a dark screen is not the same app, so the test wakes it each time with a key press.

A scroll on an iPhone takes about 10 minutes for 5 rounds. Each round goes on into new rows while the list moves, so a list of 60 rows ends in its first round and the rest run after it is brought back. A phone that reads hot (thermal 2) after hours of traces with a mirror open on it is refused, `hot-device`: in such a go the heavy list read 32.5 % janky against 0.5 %, and was rightly not called.

[`perf-gate.yml`](../examples/perf-gate.yml) was run by its own `run:` blocks, in order, on this Mac and an iPhone 17 simulator with iOS 27.2, at load 7 to 13, with `gh` stubbed and the `actions/*` steps skipped: three runs into the baseline, 800 ms put into the head's run only, the gate failed the job on +797 ms, and the comment was written and handed to `gh` all the same. As the cost was in the measured run and not in the look, the answer said it did not show again and named nothing, which is the honest answer to that. An earlier go on a simulator just booted stopped at the base, 8 of 8 runs refused for load, and still wrote its comment, "1 of 1 scenario not called". The wait for load that this added to the job ran by itself and not within the job. **Not run:** on a GitHub runner, and the Android job on an Intel runner.

## Why an app started

A run keeps the stamp of the newest start it read, on this phone and of this key, and a start is new when it is not that one, so none is kept twice and no clock has to agree with another: a Xiaomi stamps a start on the clock that stops in sleep and a service's launch on the boot's, 29 hours apart by then, so a gap across the two is no phase. The system kept 16 starts there. Index 2 of the dump is when `Application.onCreate` began: a known 500 ms inside `onCreate` took `oncreate_to_first_frame` from 386.9 to 874.8 ms on the Xiaomi, +488 ms, host load 5-108, by `device-tests/start-info.test.ts`. On an emulator with API 36, at host load 170-340, the same sleep showed in part, as a sleep does there. A launcher start read `LAUNCHER`, and a service in a process of its own `SERVICE`. A broadcast to a stopped app read `BROADCAST` on the emulator; HyperOS completes that broadcast and starts nothing, so a Xiaomi has no such record.

## A journey

Against a known cost, by `device-tests/journey.test.ts`, on the Xiaomi, Android 16, 2026-11-04, host load 27-33 on 15 cores: a baseline of 3 runs of 5 iterations, an unchanged run all `ok`, then 700 ms added to one step (`files/delayed_ms`): `regression journey.04_tap_id_load.ms: 1663 ms against 952, +709 ms, p 0.0002`, exit 1, and no other step called. What went through the Mac (`stop`, `launch`, `assert`, the whole) was left out of the baseline at that load and read `new`, and the step the phone timed itself was called all the same. 50 MB held in one step read as +50.1 MB in that step's memory; a step with 40 ms draws read frames p95 81 ms, worst 91 ms, against 10 and 11 for a light one. On the iPhone, iOS 27.2: an unchanged run read `ok`, 1,776 ms against 1,819, and 700 ms added to the step read `regression journey.03_tap_id_open_delayed.ms: 2498 ms against 1819, +713 ms, p 0.0002`, exit 1, on that step alone.

## One timeline

**What was run.** On an Android 14 emulator at host load 31 to 37 and again at 4, `device-tests/timeline.test.ts`: a journey of a list with a 1 s stall read a frame of 1005.7 to 1010.5 ms, and the video stood still 1016.4 to 1017.6 ms, from within 1.6 ms of that frame's start to 7.4 to 13.4 ms after its end. Three draw stalls of 800 ms read 807 to 815 ms, within 1.8 ms and 9 to 18 ms. The video's stamps matched what a player reads, frame by frame, to 0.1 ms over three recordings. A simulator's video has no time of its own: against an app killed at a known moment on a screen that changes every 100 ms, six runs at load 4 to 7 put its first frame 86 to 279 ms before `start` answered, so it stands 150 ms before that, within 150. A recorder no one has measured says so in the page.

On phones, with the same test: a Xiaomi on Android 16 read a 1 s stall as a frame of 1011.9 ms, its video still for 1018.1 ms, within 8.2 and 14.4 ms; a Samsung A52 on Android 14 read 1034.6 and 1023.9 ms, within 20.3 and 9.6 ms. An emulator at host load 40 to 50 read a frame of 1064.3 ms, within 18.2 and 36.1 ms, which is why the bound is 40. An iPhone 13 Pro Max's frames are placed less well: three stalls of 500 ms read 513 to 516 ms, each beginning inside its tap, a call of 331 to 427 ms. Its stream's video has no steady start at all: against a tap that crashed the app, four runs at host load 5 to 33 put its first frame from 398 ms before `start` answered to 840 ms after, so it stands 220 ms after, within 620. Its HEVC plays and seeks from inside the page in Chrome.

### The flight recorder

**What it costs.** On a Xiaomi on Android 16 at host load 13 to 29, on a screen changing ten times a second, over eight spells of 30 s on and off in turn, it took the phone's whole CPU from 10.4 to 19.9 %, left 158 MB less of its memory free, and on this Mac took 0.3 % of a core for this tool and 0.1 % more for adb. Looking each second, the same run read 11.2 to 28.5 %, which is why it looks this seldom. Each part alone, read at that 1 s look: the video about 5 points, `pidof` and the log about 3, `gfxinfo` 1.6, Perfetto's ring and `meminfo` about none. Those come to about 6 of the 9.5 points at 5 s, and what is left was not traced to a part. An Android 14 emulator encodes in software, so it says little of a phone, and its figure goes with its host: looking each second at host load 2 to 7 it read 3.3 to 10.6 %, and looking every 5 s at load 19 to 48, 14.2 to 49 %, with no page saved. An iPhone keeps no ring and no video here and has no reading of its whole CPU, so its cost was not measured. What it held on that ticking screen was 0.2 MB.

**What was run.** On an Android 14 emulator at host load 3 to 9, `device-tests/timeline.test.ts` with no word to the recorder of what happened: a tap on the fixture's crash button kept `a crash: APP CRASH(EXCEPTION)`, with the frames, the video and `FATAL EXCEPTION: main` in its 27 log lines; a 1 s stall in a list kept `a stall of 1010 ms`; a 1.5 s hold of a main thread kept `a stall of its main thread`. All three again at the 5 s look, at host load 9 to 17. On an iOS 27.2 simulator a crash kept `a crash: EXC_BREAKPOINT SIGTRAP`. A Xiaomi on Android 16, looking each second, kept a real crash, a real stall and such a hold. At the 5 s look, at host load 10 to 40, it kept `a crash: APP CRASH(EXCEPTION)` with its video, a real 1 s stall in 3 runs of 3, each as `a frozen frame` with a frame over 900 ms, and a 1.5 s hold as `a stall of its main thread`, 1499 ms by its log. A `record` there started in 667 ms on a still screen and 650 on a moving one, a median of six each, so the 2 s it may wait for a first frame was not spent. A Samsung A52 on Android 14 kept a real crash. At the 5 s look, at host load 5 to 6, it kept a real 1 s stall in 3 runs of 3, `a stall of 1058 ms` to `1278 ms`, and, with the stall put 12 s in so that the save came after a turn of the ring, `a frozen frame`, a stretch of 22 s with its video and 444 frames, the worst 1037.5 ms. Before that it kept nothing in 2 runs of 6, at host load 9 to 83: the look saw the stall, and the save was lost with its last segment, the one its single encoder had refused. An iPhone 13 Pro Max kept a real crash, and there it holds no video and no frames: its stream is one at a time, and a trace has no ring, so the page says why those rows are empty.

## The dashboard

What the dashboard costs each kept run, the median of 7 rewrites of 1,000 runs of 5 kinds each, at host load 44-47 on 15 cores (a measure takes seconds):

| runs by key           | rewrite | page     |
| --------------------- | ------- | -------- |
| 1,000 in 1 key        | 5 ms    | 84 KB    |
| 25 in each of 40 keys | 101 ms  | 2,365 KB |
| 5 in each of 200 keys | 207 ms  | 3,547 KB |

## Against Play's definitions

Against known costs, by `device-tests/vitals.test.ts`, on the Xiaomi, Android 16, 2026-11-04, host load 27-66 (these are the phone's own counts):

| known cost                                                                    | read                                                        | says                                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 600 frames with a 40 ms draw                                                  | 92.6 % over 16 ms, with the frames of the tap that began it | would count as slow frames                                                          |
| 300 frames with a light draw                                                  | 0 %                                                         | would not count                                                                     |
| one 800 ms frame in 300                                                       | 604 frames                                                  | too few frames to say of frozen frames                                              |
| one 800 ms frame in 4,000                                                     | 4 of 7,994, 0.05 %                                          | would not count as frozen                                                           |
| six 800 ms frames in 1,500                                                    | 24 of 3,004, 0.8 %                                          | would count as frozen                                                               |
| a slow start, 5.2 s in `Application.onCreate`                                 | 6,369 ms                                                    | would count as a slow cold start, and still does on the next fast start of that day |
| a hot start                                                                   | 110 ms                                                      | would not count, and says the two pages' limits                                     |
| a touch on a main thread kept stuck past the system's ANR, the app recovering | `Input dispatching timed out` in the dropbox, no exit       | `userAnrs` +1, would count                                                          |

This phone's summary counts each frame twice, 7,994 frames for 4,000 drawn, and a stall holds up the next frame too, so one stall reads as 4 frames of 700 ms or longer: the share of 0.05 % is of 0.025 % drawn. Doubled on both sides it holds, and whether Play's own count of a stall is 2 frames could not be checked from here. Its count of janky frames counts each frame once, so `perf_scroll` takes it as a share of the frame rows: 174 of 203, where the summary said 42.86 %.

Each was caused and read back, by `device-tests/exits.test.ts`, on an emulator with API 34, host load 8-13:

| caused by                                | read                                |
| ---------------------------------------- | ----------------------------------- |
| `exitProcess(3)`                         | `EXIT_SELF status 3`                |
| `kill -9`                                | `SIGNALED status 9`                 |
| `am kill` in the background              | `USER REQUESTED KILL BACKGROUND`    |
| `am force-stop`                          | `USER REQUESTED FORCE STOP`         |
| `pm revoke` of a permission while it ran | `PERMISSION CHANGE`                 |
| an exception on the main thread          | `APP CRASH(EXCEPTION)`              |
| a new install                            | `PACKAGE UPDATED`, from its own run |

On a Xiaomi with Android 16 the same read `SIGNALED status 9`, `APP CRASH(EXCEPTION)`, `EXIT_SELF status 3` and, for `am kill`, `USER REQUESTED` with no more. A link there opened nothing in an app that was stopped, so a run starts it first. The memory it died with is given where the system kept it: most exits read `pss=0.00`, and of these only a new install had a number. A low-memory kill and Android 17's memory limiter were not caused: nothing on this emulator makes one on demand.

A provoked ANR, by `device-tests/vitals.test.ts`: a touch on a main thread stuck past the system's limit. On an emulator with API 34, host load 8-13, no dialog was answered and the app came back, so no process ended and exit-info has nothing, and dropbox's `data_app_anr` held `Subject: Input dispatching timed out`. `crashes` reports it by that line and `exits.user_anrs` rose by one.

Against known costs, by `device-tests/surface.test.ts`, on an emulator with API 34 at 60 Hz, host load 10-12:

| drawn every | read                 | p50, p95         | 50 ms or more after the last | says            |
| ----------- | -------------------- | ---------------- | ---------------------------- | --------------- |
| 30 ms       | 33.5 frames a second | 33.3 ms, 33.3 ms | 0 %                          | would not count |
| 40 ms       | 25 frames a second   | 33.3 ms, 50 ms   | 39.7 %                       | would count     |
| 60 ms       | 16.7 frames a second | 66.7 ms, 66.7 ms | 99.2 %                       | would count     |

On a Xiaomi with Android 16 at 60 Hz, host load 24-59, the same three read 33.3, 25 and 16.8 frames a second, 0.8 %, 41.3 % and 98.2 % slow. There `--list` prints `RequestedLayerState{ad16944 SurfaceView[...](BLAST)#111504 parentId=...`, with the name inside, and `/proc/uptime` counts the time a phone slept and a present's clock does not, 12 hours apart on that one, so a second read says whether frames still come. A `TextureView` is drawn into the window and has no layer of its own, and a read of the app's windows is not done.

Over a round, read every 500 ms for 10 s, on the emulator at host load 18-23, the same three read 33.3, 25 and 16.7 frames a second, 392, 297 and 198 frames, and 1.8 %, 41.6 % and 92.9 % to 96.6 % slow, where a read of the last 127 frames read 96 % for 60 ms at that load. A first version counted a frame again where SurfaceFlinger had corrected the time it was shown, 208 frames for 192. A Flutter app's layer was seen, Wonderous's `SurfaceView[...](BLAST)`, built from its repository: its scroll's rounds read 46.8 and 48.9 frames a second on its own surface, where `gfxinfo` counted 1.

Known costs, by `device-tests/memory-play.test.ts`, on 2026-11-04. On the Xiaomi, host load 93-96: 50 MB of Java heap rose 50.5 MB, 50 MB of native memory 50.4 MB, and a 50 MB bitmap 50.1 MB in the bitmaps and 50.3 MB in anon memory; going home moved it from process state 2 to 15, 142.1 MB to 142.2 MB. On an emulator with API 34, host load 39-93: 50.3, 50.1 and 50.4 MB the same way. `dumpsys meminfo` lists no bitmaps there, so it has no such number and the answer says so rather than reading 0, and its 2,478 MB of RAM is under Play's table, which starts at 3,200 MB, so the answer says there is no limit to read it against. A process state of `service` or `cached` comes from the parser's tests: no device run has read one.

## Accuracy

`device-tests/perf.test.ts` checks every measure against a fixture screen of known cost: a 2 s animation
whose draw takes about 1 ms or 40 ms (frames and the frame timeline), 50 MB of Java heap held (memory,
within 15 %), one busy core (CPU, 80-125 %), and cold launches against the system's own "Displayed" log
line (within 50 ms).

## iOS

On an iPhone 17 Pro simulator with iOS 27.2, at host load 4 to 8 on 15 cores, 5 s took 13.1 to 13.8 s: the tool's start 1.6 to 2.0 s, its stop past the limit 3.4 to 4.2 s, and its export of the samples 1.8 to 2.0 s. It took 19.7 to 25.9 s while a recording began only once what earlier recordings left in the temp folder was cleared, as that lists the whole folder: 1.5 million names on that Mac, 4.5 s a listing, one for each run left, two in those runs and none where none was left. That clearing now goes on beside the recording, and takes nothing born after it began.

`device-tests/ios-perf.test.ts` checks the simulator measures on the fixture: 50 MB held (memory, within
15 %), one busy thread (CPU, 80-125 %, and the profile's top app function, from a trace), a memory graph with
its leaks summary, cold launches slower than warm. `device-tests/iphone.test.ts` reads memory, CPU, a profile, the
hangs and a launch of Settings; a cost-known check of them needs an app signed for the phone.

## Where the time goes

Each call split into its parts, on the same devices, from the server's log, and from a run of the same ops in one process with each device round trip, helper call and child process timed:

- Android: nearly all of a call is the agent's action, the touch and then the settle, which waits for the screen to be still. The server adds about 10 ms on the emulator. On a phone it adds one `adb shell pidof` after each action, which says whether the app died during it: 44 ms on the Samsung. A swipe's 300 ms stroke takes about 600 ms to send, as each move waits for the app to take it, and the list then coasts for the settle.
- iOS simulator: the helper reads the screen in 14-20 ms and sends the touches. Text goes by the runner, by XCTest. A new server started its helper, about 400 ms of its first read, and its first touch the input helper: both now start once the device is named, [below](#a-simulators-helpers-started-before-the-first-call). `logs` is `log show` (1.0-1.5 s) after `simctl get_app_container` (130-200 ms).
- iPhone: every read is the runner's, 170-300 ms. `screen` reads twice: the app, then the home screen app, for a Face ID or passcode sheet that no read of the app shows. A swipe's list coasts for 2.8 s of the settle.

The three costliest that are not the device's own:

1. A text entry looked for the focused field by a snapshot, and a snapshot of a field that has no focus yet waits for one to appear: before the tap, and again after it. Fixed: it asks whether the field exists first, which answers at once, and polls as before.
2. On an iPhone a `screenshot` read the home screen app's tree too, for a sheet over the app: 4.5 s of its 4.7 after typing in every run of the script, 250-380 ms in other sequences on the same phone, where what makes the difference was not found. Fixed for `screenshot`, as such a sheet is in its picture: it keeps the app's own check and takes no look past it. `screen`, `launch_app` and an action that changed nothing still look, about 200 ms of an iPhone's `screen`: a query for the sheets alone would be cheaper, and is not built, as no sheet could be raised on this phone to prove it against.
3. `list_devices` ran `simctl list`, then `devicectl list devices`, then `devicectl` for the lock of each connected iPhone, one after another: 460-600 ms on this Mac, whichever device is driven. Fixed: each driver's blocks are read once that driver has listed, and simulators and iPhones are two drivers, so an iPhone's reads start beside `simctl list`, and an Android phone's no longer wait for it. The lock asks the phone, so it is asked alongside the phone's list only on a plug-in where that list has passed before, kept on disk by usbmuxd's number for the plug-in, as a session's first list is a server of its own. On a new plug-in, or after any other answer or a read that failed, the lock waits for the list as it did. The answer is always the list read now, as Developer Mode is switched off on the phone with its cable in or out. `simctl` and `devicectl` also run by their own path in the developer folder, not through `xcrun`, which looked each up for 3.8-4.9 ms a call. What is left is the lock, `devicectl device info lockState`: 190-220 ms, with `simctl list` (85-115) and the phone's list (155-185) beside it.

The fix, before and after in turn, the rest of each run the same:

| `type_text` into a field by selector | before (`49e073c8`) | after (`ab96deed`) | host load, before; after |
| ------------------------------------ | ------------------- | ------------------ | ------------------------ |
| iOS simulator, median / worst        | 3,236 / 3,700       | 1,220 / 1,454      | 9.5-10.2; 8.4-9.9        |
| iPhone, median / worst               | 4,334 / 4,605       | 2,287 / 2,466      | 5.0-8.2; 5.1-6.5         |

The iPhone's `screenshot` in the same runs, before at `49e073c8` and after at `b9c2bbf0`: 4,766 / 4,817 against 183 / 227. On the simulator the runner's own `focusMs`, from the tap to the field's focus, went from 2,904-3,680 to 760-1,374, at load 30-150. The Android devices and the other calls, run before and after in turn, are the same within their spread: the fix is the iOS runner's alone.

Listing devices, before at `7d7e05d9` and after at `2f2ff0d8`, each in turn, on 2026-11-08, with an iPhone 13 Pro Max on USB, four simulators booted and two Android phones on USB, one of them listed twice more by Wi-Fi (9 rows). `list_devices` is the server's own time through an in-memory MCP client, medians of 15 on one server after a first call, which is a new server's and is given beside them, on a plug-in the iPhone had passed on before; on one not seen before, the kept plug-in was removed before each of 7 new servers. With no iPhone, the Apple driver's phones were left out, and before and after took turns, medians of 21. The hub's list is `hubDevices` in one process, and `appdyno devices` a new process each time, both medians of 15:

| ms, median (range)                        | before        | after         | host load, before; after |
| ----------------------------------------- | ------------- | ------------- | ------------------------ |
| `list_devices`                            | 456 (436-482) | 216 (200-223) | 6.7-7.3; 6.5-6.7         |
| `list_devices`, again                     | 453 (442-503) | 208 (194-221) | 6.1-6.4; 5.8-5.9         |
| `list_devices`, a new server's first call | 455, 458      | 213, 215      | 6.1-7.3; 5.8-6.7         |
| the same, on a plug-in not seen before    | 455, 458      | 355 (353-430) | 6.1-7.3; 5.8-6.3         |
| `list_devices`, the same with no iPhone   | 260           | 140           | 5.4-5.6                  |
| the hub's list                            | 104, 106      | 100, 103      | 6.1-6.7; 5.8-6.5         |
| `appdyno devices`                         | 185, 191      | 184, 189      | 5.9-6.7; 6.2-6.5         |

The answers are the same before and after, row for row. The hub's list and `appdyno devices` ask no device what blocks it, so `simctl list` is most of them; `xcrun`'s lookup gone took 5.6 and 2.5 ms off them, paired medians of 21. Of `appdyno devices`, about 90 ms is node starting the command at all, as `appdyno --version` takes.

Tried and dropped:

- Keeping an iPhone's `devicectl` list for as long as its plug-in lasts, and asking only its lock: 191 ms against 199 for the two at once, at load 6.3-6.7. Developer Mode is switched off on the phone with its cable in or out, and nothing here proved when the Mac's list says so, so the list is read each time.
- `devicectl list devices --filter` on the phone's UDID: 163 ms against 160. `simctl list devices booted`: 1.2 ms less than the whole list, a paired median of 21. Neither is worth it.
- The lock asked alongside the list of a phone never seen to trust this Mac: it would ask a phone that may not trust it, so on a new plug-in the lock still waits.
- The app's process asked of the Android agent, which answers at once, for the `adb shell pidof` after each action: 36.8 ms against 43.9 on the Samsung and 8.6 against 9.8 on the emulator, medians of 15 each in turn at load 56-64. Not worth a method of the protocol.
- A text entry's tap by the event synthesizer, as an `act` tap is, for XCTest's own: the field's focus in 915 ms against 760-1,374, at load 30-85. No gain shown.
  A touch after a touch alone: a touch with `read: none` that brings a screen leaves it sliding in, a pushed screen's tree reads where it ends from the start of its slide, and a touch during the slide is lost. On a simulator a `tap` on Back answered "no change seen" right after a `tap` with `read: none` on Form. On iOS a touch after one that skipped its settle now first looks at the screen, and if that touch changed it, waits until 650 ms after it, as a simulator's touch already did after a settled one that changed the screen. A touch after a settled one, or after one that changed nothing, pays nothing. On a simulator at load 28-75, 10 taps with `read: none` on empty space took 80-137 ms each before and 79-80 after; a tap on Form and one on Back right after it, both `read: none`, took 297-340 ms the pair before and 1,384 after, which is the wait. In those 16 pairs before it no touch was lost; in the script's runs one was, at load 77-144.

### A simulator's helpers, started before the first call

A server named its simulator (`--device`, `use_device`, or the first call that opens it) and started nothing until a call needed it: the read helper took about 400 ms of the first read, and the input helper about 200 of the first touch, as its first message to the simulator took 120 ms more than the next, even with the helper up. Both now start in the background once the device is named, and the input helper is sent a ping no app sees. Nothing waits on that and nothing is refused by it, and a device the server may not drive is left alone. On an iPhone 17 Pro simulator with iOS 27.2, before at `52726c2e` and after in turn, medians in ms:

| ms, median                                                 | before | after | host load, before; after |
| ---------------------------------------------------------- | ------ | ----- | ------------------------ |
| `screen`, first of a server, in the speed table (5 runs)   | 555    | 347   | 6.3-7.6; 5.9-8.4         |
| `screen`, first of a server, the client 1 s after its list | 505    | 98    | 6.5-6.6; 5.4-5.6         |
| `screen`, first of a server, the client at once (7 runs)   | 488    | 490   | 6.9-7.1; 5.6-6.1         |
| first touch, `read: none`, the client at once (7 runs)     | 263    | 65-71 | 6.9-7.1; 5.6-6.1         |
| first touch, `read: none`, the client 1 s after its list   | 261    | 70    | 6.5-6.6; 5.4-5.6         |

The speed table's first read comes after `list_devices`, which the start runs beside. A client that calls the moment it has the list still waits for the read helper. One first touch of 21 took 1,010 ms after, none before; it did not come again in 14 more. Every answer of the speed table was the same, proved by its words.

In the same runs, `tap` by coordinate, the touch alone, the table's last call, was 273 before and 268 after. At `553a94dd` it was 63 (worst 264), and no commit made the difference: built and run in turn on the same simulator, `553a94dd` gave 62 (worst 270) and `52726c2e` 66 (worst 282), at load 6.3-8.3. The touch waits out the rest of the 650 ms slide that the Back tap just before it started. The Back comes with the keyboard closing, which made its own settle 247-304 ms in 8 replays of 12, so the touch then waited 212-312 ms. In the other 4 the settle took 611-712 ms, nothing of the slide was left, and the touch took 61-64 ms. The app's own animation wait was 2-4 ms each time.

### A simulator's `logs`

`logs` asked the simulator for the app's folder each time, for its name in the predicate, and then ran `log show` in it. Its parts, medians of 7 at load 6.6-7.1: `get_app_container` 100 ms; `simctl spawn … log help`, the spawn and the `log` tool starting, 220; `log show` over 5 s matching nothing 773, the app's lines over 5 s 783 and over 5 minutes 809. Most of it is `log show` starting, whatever it is asked. The folder is now kept for each simulator and app while it stands, as a reinstall puts the app in a new folder and removes the old one. `log show` is asked the same as before, so the answer is the same. A session's later `logs`, 8 calls on each of 3 servers, before at `e5554ec5` and after in turn:

| ms, median (range)                | before         | after          | host load, before; after |
| --------------------------------- | -------------- | -------------- | ------------------------ |
| `logs`, the first of a session    | 901 (896-1089) | 917 (897-1046) | 7.6-8.2; 7.2-7.9         |
| `logs`, later in the same session | 892 (880-997)  | 785 (768-799)  | 7.6-8.2; 7.2-7.9         |

Tried and dropped:

- A narrower predicate, the process's name for the image path: 793-803 against 783-809. `log show`'s start is the cost, not the filter.
- A `log stream` kept for the session, answering from what it held: its answer is not `log show`'s. Over the same 8 s of the fixture's relaunch, links and a push, it held 1,545 lines against 296: debug lines, which the log store does not keep, so `log show` never had them. The same message was stamped 7 ms apart by each. Lines from the process's first moment were in `log show` alone.

### A runner's read, asking only for what it uses

A runner's read took XCTest's whole snapshot of the app, every attribute XCTest asks for by default. The tree the answer is made of reads 10 of them: identifier, frame, value, label, type, enabled, selected, placeholder, focus and the keyboard's focus. The runner now asks for those alone, by XCTest's own private snapshot request, which maps them to 12 accessibility attributes. Where this XCTest lacks a part, or the request fails, it takes the public snapshot as before, and its log says which it uses. On an iPhone 17 Pro simulator with iOS 27.2, `tree.get` 15 times each, medians in ms, the runner's own time in brackets, before and after in turn:

| ms, median (the runner's own)            | before        | after   | host load, before; after |
| ---------------------------------------- | ------------- | ------- | ------------------------ |
| the fixture's first screen, 32 elements  | 38-39 (26)    | 34 (22) | 6.2-8.1; 5.8-5.9         |
| Settings, 167 elements                   | 71-73 (59-60) | 56 (44) | 6.2-8.1; 5.8-5.9         |
| the home screen app, the fixture over it | 54-55 (41-42) | 43 (31) | 6.2-8.1; 5.8-5.9         |
| the home screen app, Settings over it    | 54-55 (42-43) | 44 (33) | 6.2-8.1; 5.8-5.9         |

Each tree was the same as before, all of it, but the status bar's clock. A depth limit was not tried: the answer is the whole tree.

On an iPhone 13 Pro Max with iOS 27.2, over USB, a build of the runner chose its snapshot at each read, so the whole snapshot, the keyed one and a third (below) took turns in each of 15 rounds. Medians of two runs in ms, the runner's own time in brackets, host load 9.8 and 7.0:

| ms, median (the runner's own)                           | whole             | keyed             | type, label and value |
| ------------------------------------------------------- | ----------------- | ----------------- | --------------------- |
| the fixture's first screen, 20 elements                 | 159-161 (146-148) | 130-134 (119-121) |                       |
| Settings, 189 elements                                  | 348-350 (335)     | 307-310 (293-294) |                       |
| the home screen app, the fixture over it, 76 elements   | 182-184 (169-170) | 150 (136)         | 140-141 (126-128)     |
| the home screen app, Settings over it, 77 elements      | 181-184 (169)     | 150 (136)         | 136-140 (124-127)     |
| the home screen, 77 elements                            | 181-183 (168-170) | 150-151 (137)     | 139-140 (126-127)     |
| the home screen app, a location prompt over the fixture | 232-237 (218-223) | 175-176 (161-163) | 166-168 (152-155)     |

The keyed trees were the same as the whole ones, node for node, but the clock. The commit's own build, on the phone afterwards, logged the keyed request.

The home screen app is read a second time, for the words of a sheet over the app, when an action changed nothing. Asking it for type, label and value alone, all those words are made of, gave the same words in every case, the location prompt's included, and saved 7-14 ms of the round trip, 4-9 % of that read. That third snapshot is not built, as it would need a request of its own through the protocol for so little.

A query for the sheets alone is not built either. On an iOS 27.2 simulator, a Face ID sheet over the fixture is a StaticText "Face ID" under 37 levels of Other, none with an identifier, inside the app switcher's card for the app: nothing a query could find it by. A permission prompt is an alert, which the app's read already takes by a query of its own. The phone has no passcode and no Face ID, so no such sheet could be raised on it.

## Earlier measurements

Measured from 2026-11-03 to 2026-11-06, with the Settings scenario, before the table of [Speed](perf.md#speed): their calls, scenario and builds differ from it, so compare a number only within its own table.

### iPhone 13 Pro Max, iOS 27.0.1

iPhone 13 Pro Max, iOS 27.0.1, the Settings scenario through the library: read 240, tap and see 1,523, back 1,682,
screenshot 140, app in front 240, cold launch 279 ms until in front (819 until its first screen reads), a runner's start
3-5 s. No stale answer, nothing moved in 4 checks. A measure costs 8-13 s, nearly all the trace tool's start and stop.

### iOS simulator, iOS 26.5

Measured with the Settings scenario on an iPhone 17 Pro simulator, iOS 26.5, on a Mac with other builds running
(load in the table). Median of 10-15 rounds, in ms.

| read  | tap and see | back and see | screenshot | app in front, with its screen | app behind, no screen |
| ----- | ----------- | ------------ | ---------- | ----------------------------- | --------------------- |
| 54-56 | 894-916     | 733-776      | 84-88      | 292-359                       | 179-183               |

Three runs, host load 4-14. The read follows a back there, with the app still busy: at rest it took 31-32 ms, 25 ms of it
in the helper for 167 elements. No stale answer in any run.

Answers against a read 1.5 s later: nothing moved, missing or extra in 20 answers (`device-tests/ios.test.ts` keeps this
check). Opening an app waits for it to be in front, and with a screen it looks until the layout has held for 200 ms, as
an action's settle does, in `packages/ops`.

What each change did, the rest of the scenario held still:

| change                                                                                                | before                           | after                  | conditions                                                               |
| ----------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------- | ------------------------------------------------------------------------ |
| direct input with the settle on the host                                                              | tap 1,206; back 1,340            | tap 905; back 760      | load 5-12; the touch itself 52-58 ms                                     |
| direct read                                                                                           | 74-75                            | 31-32 at rest          | load 7-11, 167 elements                                                  |
| the settle compares what can be named, in any order                                                   | back 1,220                       | back 500-750           | load 18-36; a floating search bar moves levels                           |
| 150 ms once something has reacted, against 200 ms                                                     | tap 984-1,357                    | tap 944-959            | load 8-21; nothing moved in 16 answers at either                         |
| `launch` without a restart, running app                                                               | 2,592-5,735                      | 273-292                | load 7-320                                                               |
| first start: erased simulator, booted (19 s), runner not installed                                    |                                  | 2.7 s; installed 1.9 s | load 7; 37 s seen at load 319. Says where it has got to on stderr        |
| a first open with no runner, the app started alongside the helper                                     | first open 12,507 (6,303-13,424) | 2,391 (2,052-2,918)    | three runs each, in turn, load 5-11; a screen in every answer            |
| the app's animation report asked of the helper, a touch held 650 ms after one that changed the screen | tap 987; back 600                | tap 976; back 484      | the same runs; nothing moved, no stale answer                            |
| a row said once where a control of its name stands at its place                                       | read 1,120 characters            | 587                    | the same runs                                                            |
| an answer's image at 800 px, quality 60                                                               | 86,782 characters of base64      | 44,808                 | the same runs; the smallest text of Settings and the fixture still reads |

Where a first open of Settings goes, five runs at load 18-27: `simctl launch` and the helper's hello, side by side, 250-750 ms;
the app's own start until it is the primary one, by far the most, done at 1,520-3,440 ms; a read 70-400; the 200 ms of stillness
`launch_app` waits for; a read 40-115. What a first open no longer pays, the first thing only the runner does pays instead: a first
image took 3,012-3,317 ms in the runs above, against 85 for the next ones.

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

### Android emulator, Android 14

The Settings scenario on a Pixel 6 emulator, Android 14, ten rounds in each of three runs, before and after in turn, load 5-10.

| measure                        | before | after  |
| ------------------------------ | ------ | ------ |
| first open, agent not up       | 1,739  | 1,441  |
| read, characters               | 700    | 700    |
| an image, characters of base64 | 39,546 | 21,972 |

Nothing moved and no answer was stale in any run, and a first open's answer holds the screen. Starting the agent and
`am start -W` take about 500 ms each at load 8-9, and the first read about 450 while the app is still coming up: the first open
went down by starting the app alongside the agent. It does not do so over another tool's UI automation, where the session may be
refused and must have left the device alone.

## Mirror

A window's own cost, kept off every screen on an iPhone 17 Pro simulator at rest, on a quiet Mac (load 3 to 10), over five runs of 22 s and one of 60 s: its first picture in 338 ms (269 to 437), 0.01 % of a core while nothing moves, and 106 MB once it has settled, with 121 MB at its first second.

`packages/appdyno/scripts/mirror-bench.mjs <device>`, headless: the fixture's frames screen on Android, a flick along Settings on a simulator. All arrive-on-Mac figures, not glass: a window adds about a display tick. It waits for two still seconds before each touch, so that the next frame is the touch's own. Measured 2026-11-04 on an M5 Pro with 15 cores, on the same Mac as other work, with the host's load beside each. Each is one run; a number is relative to this Mac at this load.

| device, picture                                         | frames/s while moving (target)               | capture to arrival p50, p95, ms (target) | touch to first changed frame p50, ms (target) | decode or copy p95, ms (target) | still screen: viewer CPU, RSS | host load |
| ------------------------------------------------------- | -------------------------------------------- | ---------------------------------------- | --------------------------------------------- | ------------------------------- | ----------------------------- | --------- |
| Xiaomi 25078RA3EY, Android 16, H.264, 720x1600          | 60, best 60 (59)                             | 31.2, 34.6 (35, 50)                      | **92.2, a miss** (80)                         | 0.9 (8)                         | 0.3 %, 106 MB                 | 11-28     |
| Samsung SM-A525F, Android 14, H.264, 576x1280 by `auto` | 81, best 84 (59)                             | 23.6, 26.3 (35, 50)                      | **107, a miss** (80)                          | 0.7 (8)                         | 0.2 %, 104 MB                 | 14-49     |
| The same at its display's 1080x2400, `--quality high`   | 89, best 91 (59)                             | **69.3, 73.4, a miss** (35, 50)          | **217, a miss** (80)                          | 1 (8)                           | 0.3 %, 69 MB                  | 16-25     |
| Android 14 emulator, gRPC `MMAP`, 1080x2400             | 43, best 54 (40.3: 90 % of the guest's 44.8) | not measured by this path                | 41.4 (120)                                    | 0.6 (8)                         | 0 %, 40 MB                    | 24-31     |
| iPhone 17 Pro simulator, iOS 27.0, surface, 1206x2622   | 91, best 114 (58)                            | no encode                                | 55 (80)                                       | no decode; frame gap 18.8 (20)  | 0 %, 24 MB                    | 25-31     |

The phone's touch stays about one display tick over its target: 98 ms by way of UI automation with two round trips per tap, 86 to 91 ms as it is now, with 7 ms of it a round trip to the agent. The simulator's touches come in two sizes, about 70 ms up a list and about 20 ms back down it. Its frame rate is its panel's 120 Hz at the start of a flick and falls as the list coasts; only seconds with 30 frames or more are counted. A real window of the viewer has about 86 MB, against 24 headless.

Under other work, nothing but the load differs: on the phone at load 325 to 369, 51 frames/s, capture to arrival 33.8, 48.4 ms, touch 103 ms, decode 9.6 ms.

By Wi-Fi, against the same phone by cable: a Samsung SM-A525F, Android 14, H.264, with its cable in and driven by its Wi-Fi serial, `--max-size 1280` both ways, three runs each in turn, a minute and a half apart, at load 3 to 6, on a network where a ping to the phone averaged 31 to 86 ms:

| way   | first picture, ms | touch to first changed frame p50, ms | frames/s while moving | capture to arrival p50, p95, ms    |
| ----- | ----------------- | ------------------------------------ | --------------------- | ---------------------------------- |
| cable | 260, 256, 260     | 106, 103, 110                        | 75, 74, 75            | 25, 28; 25, 29; 25, 28             |
| Wi-Fi | 357, 411, 357     | **187, 208, 197**                    | 82, 82, 72            | 29, **81**; 27, **74**; 32, **88** |

The third pair ran with one agent on the phone, and the first two with a second one idle. `auto` keeps a size for each way in: by Wi-Fi it settled at 720x1600, where touch read 212 and 201 ms and capture to arrival p95 100 and 85 ms. Why frames/s reads higher by Wi-Fi in two of three runs has not been looked into. A fourth pair at the last commit, at load 4, read 258 ms, 109 ms and 75 frames/s by cable and 1615 ms, 168 ms and 85 frames/s by Wi-Fi: its first picture is unlike the three before it, and is not explained.

An iPhone 13 Pro Max, iOS 27.2, HEVC, with its cable in, by `--wifi` or not, `auto` both ways, five runs each in turn, at load 4 to 14, on a network where a ping to the phone averaged 12 to 86 ms:

| way   | first picture, ms            | touch to first changed frame p50, ms | flicks seen of 10 | frames/s while moving  | freezes a run      |
| ----- | ---------------------------- | ------------------------------------ | ----------------- | ---------------------- | ------------------ |
| cable | 559, 508, 510, 510, 463      | 98, 97, 98, 93, 93                   | 7, 7, 7, 7, 7     | 60, 60, 60, 60, 60     | 1, 4, 0, 0, 1      |
| Wi-Fi | 1677, 2545, 1577, 1529, 1840 | 128, **470**, **270**, 121, **164**  | 10, 2, 3, 10, 5   | 59, 56, 58, **44**, 56 | 17, 17, 14, 13, 18 |

A touch here is a flick along the fixture's list. A flick that brought no frame within 5 s is not counted, so a p50 of few flicks rests on few samples. By cable the flicks not seen were the first 3 of each run, and by Wi-Fi they were any of them. Neither is explained, and whether those flicks reached the phone was not checked. `auto` took mode 7 at 1284x2778, 4:4:4, by cable, and mode 5 at 1296x2816, 4:2:0, by Wi-Fi. By Wi-Fi a freeze lasted up to 834 ms, and a run's freezes came to 2.3 to 6.0 s in all; by cable each lasted about 1.1 s. The phone's cable was in for every run, by Wi-Fi too: a phone with its cable out was not measured.

A phone's target for frames is 59, or 59 of every 60 where its display is slower, read from `dumpsys display`: `auto` gives up what is past that for a touch. On the Samsung capture to arrival follows the picture's pixels, and touch read 215 ms at load 160 and 217 at load 21, so that is the size, not load, and [`auto` measures it](mirror.md#the-size-of-a-phones-picture). Its first stream settled on 576x1280 from 1080x2400 by way of 1920 lines, and the next started there, first picture in 360 to 932 ms. Touch stays a miss at any size: 95 to 107 ms at 1280 lines across runs, and 94 at 1024.

Thirty minutes of a picture that keeps moving, by `--soak 30`, with the viewer's memory a minute in and at the end:

| device                               | RSS, MB      | descriptors | frames in the last 30 s | load at the end |
| ------------------------------------ | ------------ | ----------- | ----------------------- | --------------- |
| Xiaomi 25078RA3EY, Android 16, H.264 | 21.8 to 17.6 | 45, 45      | 734                     | 251             |
| Samsung SM-A525F, Android 14, H.264  | 21 to 15.1   | 45, 45      | 991                     | 19              |
| Android 14 emulator, gRPC `MMAP`     | 49.2 to 49.3 | 45, 45      | 399                     | 86              |
| iPhone 17 Pro simulator, iOS 27.0    | 26.4 to 15.5 | 45, 45      | 606                     | 42              |

An iPhone 13 Pro Max, iOS 27.2, mode 7, on a screen of noise, 167 Mbit/s at 60 frames/s, with the viewer's memory and what the stream counted:

| minutes, load             | RSS, MB      | packets lost         | pictures held          | freezes                       | stop           |
| ------------------------- | ------------ | -------------------- | ---------------------- | ----------------------------- | -------------- |
| 15, load 6 to 8           | 20.9 to 17.3 | 1,504 of 16,027,627  | 129 of 54,715          | 1, 1.1 s, in its first minute | the phone says |
| 30, load 361 falling to 8 | 17.3 to 15.8 | 80,398 of 32,038,280 | 9,425 of about 108,000 | not yet counted               | the phone says |

All the quiet run's loss is in the stream's first second. On that noise the first key comes as a burst of about 330 Mbit/s, twice the steady rate: 1,506 of the 3,457 packets in its heaviest 100 ms were lost, and the first whole picture was the next key, 1.56 s from the start, at load 27. A still screen shows its first picture in 459 ms, at load 18 to 20.

An iPhone's live numbers come from its instruments service, a sample a second, on the same 13 Pro Max under a held stream at load about 370: 36 KB/s, 0.6 to 1.5 % of a Mac core to read, and about 6 % of a phone core for `DTServiceHub` itself while they run. Frames count the display, not the app: 59 to 60 on the noise screen, 19 to 20 on a still one under a stream, 0 on a dark phone.

A simulator's turns are read four times a second by the helper that reads its screen, which a mirror starts if it is not running: 0.3 % of a core and 98 MB resident on a still screen at load 94.
