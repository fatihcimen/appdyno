# How the tools were tested

[Türkçe](tools-tested.tr.md)

What [the tools](tools.md) were run on, and what each run showed. The device suites are in `device-tests/`, and [CI and releases](ci.md) says how to run them. The _fixture_ is appdyno's own test app, `dev.appdyno.fixture`. A _host load_ is the Mac's 1-minute load average, on as many cores as each run says.

## Tested versions

Each device, OS and Xcode that a run on this page names whole, newest first. The simulator smoke of [CI and releases](ci.md) writes the same four columns at the top of its `device-summary.md`, which each release holds as a file: a row there that is not here names a pair that only the smoke's suites ran on. The smoke ran 18 cases in its rows of 2026-11-16; from 1.3.0 it runs 21, the keys with a modifier among them, and no run of the 21 on GitHub's runner is recorded yet.

| device                             | OS                                      | Xcode         | date       | what ran                                                                                                                                                                                                           |
| ---------------------------------- | --------------------------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iPhone 17 simulator                | iOS 27.2 (24B8117)                      | 27.2 (27B52)  | 2026-11-18 | 41 suites, one file at a time: 292 passed, 2 failed, each passing run again alone; the simulator smoke's 21 cases passed by the helpers and by the runner alone: [1.3.1 on the simulators](#131-on-the-simulators) |
| iPhone 17 simulator                | iOS 26.5 (23F77)                        | 26.5 (17F42)  | 2026-11-18 | 41 suites, one file at a time: 292 passed, 2 failed; the simulator smoke's 21 cases passed by the helpers and by the runner alone: [1.3.1 on the simulators](#131-on-the-simulators)                               |
| Android emulator, Pixel 7          | Android 16, API 36 (BE2A.250530.026.F3) | none          | 2026-11-18 | 50 suites, one file at a time: 346 passed, 4 failed: [1.3.1 on an emulator](#131-on-an-emulator)                                                                                                                   |
| iPhone 17 simulator                | iOS 27.2 (24B8117)                      | 27.2 (27B52)  | 2026-11-17 | 41 suites, one file at a time: 292 passed, 2 failed: [1.3.0 on the simulators](#130-on-the-simulators)                                                                                                             |
| iPhone Duo simulator               | iOS 27.2 (24B91016s)                    | 27.2 (27B52)  | 2026-11-17 | `fold.test.ts` three times: 6 of 6 once, 5 of 6 twice: [A fold](#a-fold)                                                                                                                                           |
| iPhone 17 simulator                | iOS 26.5 (23F77)                        | 26.5 (17F42)  | 2026-11-17 | 41 suites, one file at a time: 292 passed, 2 failed: [1.3.0 on the simulators](#130-on-the-simulators)                                                                                                             |
| Android emulator, Pixel 7          | Android 16, API 36 (BE2A.250530.026.F3) | none          | 2026-11-17 | 50 suites, one file at a time: 348 passed, 4 failed: [1.3.0 on the emulators](#130-on-the-emulators)                                                                                                               |
| Android emulator, Pixel 9 Pro Fold | Android 15, API 35 (AE3A.240806.043)    | none          | 2026-11-17 | a fold, the conditions, the battery page and the window's bar: 24 passed, none failed: [1.3.0 on the emulators](#130-on-the-emulators)                                                                             |
| iPhone 13 Pro Max                  | iOS 27.2 (24B119)                       | 27.2 (27B52)  | 2026-11-17 | every suite that takes a phone but `person-prompts`, in two passes: 132 passed, 1 failed: [An iPhone on iOS 27.2](#an-iphone-on-ios-272)                                                                           |
| Xiaomi REDMI 15C                   | Android 16, API 36, HyperOS 3.0.301.0   | none          | 2026-11-17 | every suite that takes a phone, in two passes: 235 passed, none failed: [A Xiaomi on HyperOS 3](#a-xiaomi-on-hyperos-3)                                                                                            |
| iPhone 17 simulator                | iOS 26.5 (23F77)                        | 26.6 (17F113) | 2026-11-16 | the simulator smoke on GitHub's hosted macOS runner: its 18 cases passed by the runner alone, as the host has no simulator HID service, in 417 s of suites (15 min for the whole job)                              |
| iPhone 17 simulator                | iOS 26.5 (23F77)                        | 26.5 (17F42)  | 2026-11-16 | the simulator smoke on a Mac: its 18 cases passed by the simulator's helpers in 189 s, and by the runner alone in 219 s, at host load 40 to 329 on 10 cores                                                        |
| iPhone 17 simulator                | iOS 27.2 (24B8117)                      | 27.2 (27B52)  | 2026-11-16 | the simulator suites, one file at a time: [Xcode 27.2](#xcode-272)                                                                                                                                                 |
| iPhone Duo simulator               | iOS 27.2 (24B91016s)                    | 27.2 (27B52)  | 2026-11-15 | a trial outside the tools, before 1.3.0: its hinge event folded and unfolded it, and appdyno 1.2.0 read it open: [A fold](#a-fold)                                                                                 |
| Android emulator                   | Android 17, API 37 (CE2A.260420.051.A3) | none          | 2026-11-08 | every Android suite: [Android 17](#android-17)                                                                                                                                                                     |

## 1.3.1 on the simulators

Every simulator suite ran one file at a time on 2026-11-18, on 1.3.1 before its release, on the Mac of [1.3.0 on the simulators](#130-on-the-simulators): on a new iPhone 17 simulator with iOS 26.5 (23F77) under Xcode 26.5 (17F42), at host load 2 to 254, and on a new iPhone 17 simulator with iOS 27.2 (24B8117) under Xcode 27.2 (27B52), used through `DEVELOPER_DIR` with the runner and the fixtures built by it, at host load 2 to 408, as other work ran on the Mac. What was left out, and what skipped, is as in 1.3.0. A case that failed ran again alone, and a suite fixed ran again whole.

What the runs found, each fixed and run again:

- A simulator's waits for a change read its helper in 1.3.1, where the helper reads the app, so the device itself answers such a wait with nothing. `driving.test.ts` and `ios.test.ts` still asked it to wait, and failed in each run on both systems: they now hold that answer, and the runner's wait where the runner works alone.
- The New Simulator sheet of a hub kept to an allow list says, as it opens, that the hub makes none, and holds its Create off. `hub.test.ts` waited for a note the hub no longer sends.
- The simulator smoke took the first runtime of its Xcode's iOS version, and Xcode 27.2 lists the iPhone Duo's own iOS 27.2 runtime first, which runs no iPhone with a plain name: the smoke ended before it made a simulator. It now takes the runtime that runs one.

Three cases failed in the iOS 27.2 sweep and passed run again alone at host load 5: the web view case of `evidence.test.ts` that adds what the tree does not hold, at host load 129 to 408, whose whole file then passed 22 of 22; the core at work off the main thread of `gate-why.test.ts`, which the gate called noisy at host load 65; and the 500 ms slow start of `ios-perf.test.ts`, read as 158 ms at host load 243. The Face ID sheet of `ios.test.ts` and XCTest's metrics of `ios-perf.test.ts`, open in 1.3.0 on iOS 27.2, passed there.

Still failing on iOS 26.5, as in 1.3.0: the CPU profile and the trace query of `ios-perf.test.ts`, in each of their runs. Xcode 26.5's `xctrace` started no recording, and an `xctrace record` with a 2 s limit kept running until it was ended.

Open, and older than 1.3.1: the web view block of `evidence.test.ts` run alone, with no runner up, failed its setup on iOS 27.2, on 1.3.1 and on 1.3.0 alike, in 2 runs of 2 each. Its wait of 5 s for the page's words read only the native Back button: the read helper hands a page to the runner once it sees the page's content, and while no runner is up a read answers with the helper's own tree. The page's words were read once a runner was up, 8.7 s after a cold start. In a whole run the file's earlier blocks have a runner up, and the block passes.

Each suite's count is its last whole run. Passed, failed and skipped:

| suite               | iOS 26.5    | iOS 27.2    |
| ------------------- | ----------- | ----------- |
| `allow-apps`        | 4, 0, 5     | 4, 0, 5     |
| `app-data`          | 1, 0, 3     | 1, 0, 3     |
| `ask-person`        | 8, 0, 0     | 8, 0, 0     |
| `build-and-run`     | 2, 0, 2     | 2, 0, 2     |
| `crashes`           | 2, 0, 2     | 2, 0, 2     |
| `diagnose`          | 3, 0, 10    | 3, 0, 10    |
| `driving`           | 22, 0, 41   | 22, 0, 41   |
| `evidence`          | 22, 0, 42   | 22, 0, 42   |
| `flows-ci`          | 7, 0, 7     | 7, 0, 7     |
| `flows`             | 9, 0, 21    | 9, 0, 21    |
| `fold`              | 0, 0, 12    | 0, 0, 12    |
| `gate-why`          | 4, 0, 8     | 3, 1, 8     |
| `guards`            | 1, 0, 9     | 1, 0, 9     |
| `hub.device`        | 1, 0, 0     | 1, 0, 0     |
| `hub`               | 2, 0, 0     | 2, 0, 0     |
| `install-ipa`       | 2, 0, 1     | 2, 0, 1     |
| `ios`               | 42, 0, 0    | 42, 0, 0    |
| `ios-perf`          | 15, 2, 0    | 16, 1, 0    |
| `keys`              | 8, 0, 17    | 8, 0, 17    |
| `lifecycle`         | 5, 0, 7     | 5, 0, 7     |
| `mcp-stdio`         | 8, 0, 8     | 8, 0, 8     |
| `measures-sim`      | 7, 0, 0     | 7, 0, 0     |
| `mirror.hud`        | 2, 0, 1     | 2, 0, 1     |
| `mirror.record`     | 4, 0, 14    | 4, 0, 14    |
| `mirror.simulator`  | 5, 0, 3     | 5, 0, 3     |
| `mirror.window`     | 10, 0, 0    | 10, 0, 0    |
| `network.simulator` | 18, 0, 0    | 18, 0, 0    |
| `open-settings`     | 23, 0, 30   | 23, 0, 30   |
| `perf-compare`      | 1, 0, 2     | 1, 0, 2     |
| `person-prompts`    | 1, 0, 4     | 1, 0, 4     |
| `picture-words`     | 2, 0, 4     | 2, 0, 4     |
| `push`              | 8, 0, 10    | 8, 0, 10    |
| `scroll`            | 3, 0, 6     | 3, 0, 6     |
| `settings`          | 4, 0, 16    | 4, 0, 16    |
| `small-tools`       | 11, 0, 20   | 11, 0, 20   |
| `steps`             | 2, 0, 4     | 2, 0, 4     |
| `timeline`          | 2, 0, 6     | 2, 0, 6     |
| `views.simulator`   | 9, 0, 0     | 9, 0, 0     |
| `watch`             | 7, 0, 14    | 7, 0, 14    |
| `window.push-token` | 2, 0, 0     | 2, 0, 0     |
| `window.sends`      | 3, 0, 2     | 3, 0, 2     |
| all 41              | 292, 2, 331 | 292, 2, 331 |

The case `mirror.hud.test.ts` skips is Android's own, the fold of its bar, which the table of 1.3.0 does not count.

The simulator smoke, `node scripts/sim-smoke.mjs`, made its own iPhone 17 simulator on each Xcode's iOS and passed its 21 cases in each of four runs, its suites taking:

| Xcode        | input and reads         | suites | host load  |
| ------------ | ----------------------- | ------ | ---------- |
| 26.5 (17F42) | the simulator's helpers | 140 s  | 146 to 151 |
| 26.5 (17F42) | the runner alone        | 200 s  | 71 to 151  |
| 27.2 (27B52) | the simulator's helpers | 219 s  | 23 to 167  |
| 27.2 (27B52) | the runner alone        | 248 s  | 66 to 167  |

## 1.3.1 on an emulator

Every Android suite ran one file at a time on 2026-11-18, on 1.3.1 before its release, on a new emulator with a Pixel 7's profile and Android 16, API 36, the image and build of [1.3.0 on the emulators](#130-on-the-emulators), emulator 37.2.12, drawing on the Mac's GPU, at host load 2 to 317 on 10 cores, as other work ran on the Mac. 50 suites passed 346 tests and failed 4, each suite counted in its last whole run; 323 were skipped, as a simulator's, an iPhone's, a foldable's, or a window's that opens only when asked. The emulator was first started by hand with no gRPC port, and the case of `mirror.android.test.ts` that reads its own picture by gRPC passed once it was started with `-grpc`, as `manage_simulator` starts one. `baseline-profile.test.ts` and `push.test.ts` ran again whole once their fixtures were built and installed, and passed 5 of 5 and 10 of 10.

Still failing, as in 1.3.0: the battery page of `open-settings.test.ts`; `frame-cause.test.ts`'s case of a 100 ms GC in each frame, named `busy`; `measures-android.test.ts`'s energy case; and `vitals.test.ts`'s light screen, read as 99.34 % slow frames.

Failed once and passed run again: the case of `settings.test.ts` that writes down the rotation lock a turn sets. In the sweep, at host load 4 to 5, `restore` put auto-rotate back off where the case had turned it on before its turn; it passed alone, with its whole file, and after `scroll.test.ts`, which ran before it in the sweep, and why it failed once is not known. The first case of `allow-apps.test.ts`, the first suite on the new emulator, found the fixture on its permission screen after a link to its form, and its file passed whole run again.

## The Mac app in 1.3.1

The app was built from the same commit by `scripts/build-app.mjs`, signed ad hoc, on 2026-11-18. The viewer's self test, `packages/core/test/viewer-self-test.test.ts`, passed with no check failed and none left unrun, and `scripts/check-app.mjs` passed its 16 steps. A person's own `dev.appdyno.app` and `dev.appdyno.window` read the same after every run here as before the first.

Then the app's own binary was started as a person opens it, its windows on the screen, with a preferences domain of the run's own and an allow list of one shut-down simulator of the run, and its windows were read and pressed through the Accessibility API. The Welcome opened at the first launch, and each of its buttons took the hub where it says: AI Clients to AI Clients, New Simulator… to the New Simulator sheet, with this Mac's models and systems and, as the hub kept to its list, its refusal and Create off, and Connect a Phone to Connect a Phone. Help's Welcome opened it again, and Appdyno Help opened Help. With the simulator chosen, Device offered Start, with Shake and the screen's items off. Start booted it, and Device then offered Shut Down and the device's own items, Shake still off, as a simulator has none to shake: Home took the fixture to the home screen and App Switcher showed the switcher, as the simulator's own screenshots showed, and Shut Down shut it down. Documentation, Tools Reference and Report an Issue each open a web page and were not pressed; each of their pages, in English and in Turkish, answered.

## 1.3.0 on the simulators

Every simulator suite ran one file at a time on 2026-11-17, on a Mac with macOS 26.7.3 and 10 cores: on an iPhone 17 simulator with iOS 26.5 (23F77) under Xcode 26.5 (17F42), at host load 2 to 56, and on a new iPhone 17 simulator with iOS 27.2 (24B8117) under Xcode 27.2 (27B52), used through `DEVELOPER_DIR` with the runner and the fixtures built by it, at host load 3 to 190 while the Android suites ran beside it. A suite that failed ran again once its cause was found. `simulator-create.test.ts` was left out, as it makes a simulator under a stock model's name, and so were the three blocks of `mirror.simulator.test.ts` that open a real window or restart a simulator under one, which run only when asked. Every other case skipped is another platform's: Android, an emulator or an iPhone.

What the runs found, each fixed and run again:

- On a simulator on its side, `type_text` by ref into "Your name" typed the text into the password field, and answered that it had typed it: the keyboard lifted the form, the password field came to stand where "Your name" had been read, and the simulator's keys looked for the field by that place. They now follow the field touched by what it is. It showed in `flows.test.ts` run after `flows-ci.test.ts`, whose flow turned the simulator: a simulator has no rotation lock to write down, so its turn was not put back then, and the suite's check read the home screen, which reads `rotation 0` turned or not. The CI suite now stands the simulator upright itself.
- On iOS 27.2 a web view's page is listed while it is still `about:blank`, and an `inspect_app` `web_click` right after the link that showed it found nothing on it, in 4 runs of 4. It now waits up to 1.5 s for its selector, as a tap by selector waits for its element.
- The Mac app's New Simulator added each runtime by its name, and this Mac had two named iOS 27.2, the second for one model alone: the menu kept one, nothing was chosen, and Create did nothing, not even the refusal of a hub kept to an allow list. Each runtime is now a row of its own.
- An iOS 26.5 simulator that has once discarded an app's saved scene at a launch discards it at every launch until it boots again, and the stops in front of `keys.test.ts` brought that on: `lifecycle.test.ts` run after it lost its kept value, and kept it in 2 runs of 2 after a fresh boot. The suite now boots the simulator first.
- `gate-why.test.ts` left the frame probe held for the fixture, so `ios-perf.test.ts`, run next, found the probe in an app it had launched without one; and a case of `network.simulator.test.ts` or `flows.test.ts` that failed left a capture or a recording running, which refused every case after it. Each suite now ends what it held.
- Cases still read a refusal without the code and the hint an MCP client reads, the data-loss question by the tool's name before 1.3.0, and Notification Center by its date view's line, which a read now leaves out as it holds only the date and time it lists: each was corrected.

Each suite's count is its last whole run, with each case that failed there run again after its fix. Passed, failed and skipped:

| suite               | iOS 26.5    | iOS 27.2    |
| ------------------- | ----------- | ----------- |
| `allow-apps`        | 4, 0, 5     | 4, 0, 5     |
| `app-data`          | 1, 0, 3     | 1, 0, 3     |
| `ask-person`        | 8, 0, 0     | 8, 0, 0     |
| `build-and-run`     | 2, 0, 2     | 2, 0, 2     |
| `crashes`           | 2, 0, 2     | 2, 0, 2     |
| `diagnose`          | 3, 0, 10    | 3, 0, 10    |
| `driving`           | 22, 0, 41   | 22, 0, 41   |
| `evidence`          | 22, 0, 42   | 22, 0, 42   |
| `flows-ci`          | 7, 0, 7     | 7, 0, 7     |
| `flows`             | 9, 0, 21    | 9, 0, 21    |
| `fold`              | 0, 0, 12    | 0, 0, 12    |
| `gate-why`          | 4, 0, 8     | 4, 0, 8     |
| `guards`            | 1, 0, 9     | 1, 0, 9     |
| `hub.device`        | 1, 0, 0     | 1, 0, 0     |
| `hub`               | 2, 0, 0     | 2, 0, 0     |
| `install-ipa`       | 2, 0, 1     | 2, 0, 1     |
| `ios`               | 42, 0, 0    | 41, 1, 0    |
| `ios-perf`          | 15, 2, 0    | 16, 1, 0    |
| `keys`              | 8, 0, 17    | 8, 0, 17    |
| `lifecycle`         | 5, 0, 7     | 5, 0, 7     |
| `mcp-stdio`         | 8, 0, 8     | 8, 0, 8     |
| `measures-sim`      | 7, 0, 0     | 7, 0, 0     |
| `mirror.hud`        | 2, 0, 0     | 2, 0, 0     |
| `mirror.record`     | 4, 0, 14    | 4, 0, 14    |
| `mirror.simulator`  | 5, 0, 3     | 5, 0, 3     |
| `mirror.window`     | 10, 0, 0    | 10, 0, 0    |
| `network.simulator` | 18, 0, 0    | 18, 0, 0    |
| `open-settings`     | 23, 0, 30   | 23, 0, 30   |
| `perf-compare`      | 1, 0, 2     | 1, 0, 2     |
| `person-prompts`    | 1, 0, 4     | 1, 0, 4     |
| `picture-words`     | 2, 0, 4     | 2, 0, 4     |
| `push`              | 8, 0, 10    | 8, 0, 10    |
| `scroll`            | 3, 0, 6     | 3, 0, 6     |
| `settings`          | 4, 0, 16    | 4, 0, 16    |
| `small-tools`       | 11, 0, 20   | 11, 0, 20   |
| `steps`             | 2, 0, 4     | 2, 0, 4     |
| `timeline`          | 2, 0, 6     | 2, 0, 6     |
| `views.simulator`   | 9, 0, 0     | 9, 0, 0     |
| `watch`             | 7, 0, 14    | 7, 0, 14    |
| `window.push-token` | 2, 0, 0     | 2, 0, 0     |
| `window.sends`      | 3, 0, 2     | 3, 0, 2     |
| all 41              | 292, 2, 330 | 292, 2, 330 |

The failures, and what else stayed open, are in [Open in 1.3.0](#open-in-130). `fold.test.ts` takes a Duo simulator alone, and its runs on one are in [A fold](#a-fold).

## 1.3.0 on the emulators

Every Android suite ran one file at a time on 2026-11-17, on an emulator with a Pixel 7's profile and Android 16, API 36: `system-images;android-36;google_apis;arm64-v8a` revision 7, build `BE2A.250530.026.F3`, emulator 37.2.12, drawing on the Mac's GPU, at host load 2 to 375 on 10 cores, beside the iOS suites. The cases of a foldable ran on a Pixel 9 Pro Fold's profile with Android 15, API 35: revision 9, build `AE3A.240806.043`. On the first, 50 suites passed 348 tests and failed 4, each suite counted in its last whole run with each case that failed there run again after its fix; 319 were skipped, as an iPhone's, a simulator's, a foldable's, or a window's that opens only when asked. On the foldable `fold.test.ts` passed 6 of 6, `settings.test.ts` 15 of 15, the battery page of `open-settings.test.ts` 1 of 1 and `mirror.hud.test.ts` 2 of 2, its case of the bar's fold skipped on the foldable's wider window.

What the runs found, each fixed and run again:

- `measure_performance` `launch` with `mode: hot` or `warm` started the app again 800 ms after it was sent home, while it was still pausing, and the system brought its task back with no start timed: `UNKNOWN` in every run. It now waits, at most 5 s, until the app has stopped; the hot start read 31 to 43 ms against a warm 48 to 81 and a cold 346.
- A turn the agent let go of wrote its rotation lock again each second for three, over what came next: `set_device` `restore` put auto-rotate back and was locked again 30 ms later, in 4 runs of 4. Only auto-rotate on is written again now.
- The suites' own: mobile data is turned off with Wi-Fi off, as an emulator's Wi-Fi reaches this Mac by itself; the window's live numbers are turned on as the View menu does, and the bar's fold of Show Performance at 780 pt is a case of its own; an emulator killed under its stream is booted again as the serial it ran as; and a read after lock waits for the display to go off, not only for the system to doze.

Still failing, each understood, in each of its runs on the API 36 emulator: the battery page of `open-settings.test.ts`, as the image lacks a package that page needs, where the API 35 one opens it; `frame-cause.test.ts`'s case of a 100 ms GC in each frame, which an emulator names `busy`, not `gc`, in 4 runs of 4; `measures-android.test.ts`'s energy case, whose units an emulator mixes, in 4 runs of 4; and `vitals.test.ts`'s light screen, which an emulator reads as 99.67 % slow frames, as [Android 17](#android-17) found on API 37.

## Android 17

Every Android device suite ran on an emulator of Android 17, API 37, on 2026-11-08: `system-images;android-37.0;google_apis;arm64-v8a` revision 8, build `CE2A.260420.051.A3`, emulator 37.2.13, 1080x2400 at 420 dpi, drawing on its CPU (`swiftshader_indirect`), adbd not root, one file at a time at host load 8 to 28 on 15 cores. `evidence.test.ts`'s proxy test was left out, as this run changed no proxy. A test that failed ran again, and then on an API 34 emulator of the same make, revision 14, build `UE1A.230829.050`, to tell Android 17 from the rest. What Android 17 changed, each fixed and run again on it:

- The dispatcher holds injected touches to one whole stream, whoever sent them. A finger left down, by an agent killed during a long press, had every later finger-down refused ("Invalid DOWN event - pointers already down"), and held on the status bar it opened the shade at the next activity start. A new agent lifts a finger left down, and a refused finger-down lifts it and goes again. Where none was left, the dispatcher refuses the agent's cancel and writes that to the log, with its state, at most twice a start; API 34 writes nothing of it. Google's pages for Android 17 do not name this.
- The credential prompt is the biometric one with a credential view in it, and read as a fingerprint: it reads as a passcode.
- An app that targets 37 reaches this Mac at `10.0.2.2`, or the LAN, only with `ACCESS_LOCAL_NETWORK`: without it the fixture's download hung, and `measure_performance snapshot` and `capture_network` counted 0 bytes. The fixture asks for it, and `adb install -g` grants it; an app of yours that targets 37 needs it for the same. `capture_network` with `via: proxy` for such an app was not tried.
- `cmd package compile --reset` keeps a `.dm`'s profile and compiles nothing with it, so a launch measure with `compile` left an app the `.dm` had compiled at `verify`. It compiles that app at `speed-profile` again, which then reads `reason=cmdline`.
- A `.dm` for another range of API is refused at install, "The profile is in the wrong format", where API 34 took it and compiled nothing.
- `dumpsys meminfo` lists native allocations by kind, with a bitmap row only where the app holds one: there no row reads 0 bitmaps, where an Android with no such list reads none.
- `locksettings clear` fails where no PIN is set, saying it "has no password", as after a test has cleared its own: that test's cleanup takes the answer as done.

After these, every test of 37 of the 45 suites passed, in the sweep or run again after its fix, where `perf.test.ts` and `evidence.test.ts` ran again only for their network tests; 8 failed a test each that failed the same on API 34, or that this emulator's make explains: a native crash's symbols of another build, of which NDK r30's `ndk-stack` no longer warns, where r28's does on the same tombstone; the light screen of `vitals.test.ts`, on emulators drawing on their CPU, where [the performance reference](perf.md#what-works-where) draws on the Mac's GPU; the live numbers of `mirror.hud.test.ts`, whose click on Show Performance reached no button: at the window's opening width of 780 pt, where a phone's tall picture opens it, an Android device's bar folds it into its » overflow once its capsule says the picture's rate, as an API 36 emulator showed on 2026-11-17, and an open foldable's window, wider, holds it, and the case now turns it on as the View menu does; mobile data off with Wi-Fi on, by which the API 37 emulator still reached this Mac at `10.0.2.2`; high contrast text, whose test lost an agent on both; the steps of `record_session` from the command line; a fingerprint sensor with none enrolled, which answers `NOT_FOUND` where the test wants no sensor; and the emulator's own picture by gRPC, as this one wrote no file that names its port. `diagnose.test.ts` fails on both right after `crashes.test.ts`, as the system's crash dialog holds the crashed process alive and no app window is left in front, and passes by itself. `exits.test.ts`, `timeline.test.ts` and `perf-compare.test.ts` each failed once and passed run again.

Of Google's behavior changes for Android 17, for all apps and for apps that target 37, these could touch what this does: the local network permission, above; hidden passwords from a physical keyboard, the IME not shown again after a rotation, and accessibility events for a physical keyboard's typing, which the suites' typing, rotation and password field passed through; static final fields that reflection cannot change, of which the agent changes none; and, not tried here, `setContentCaptureEnabled(false)` no longer blocking content capture, which is not the screen capture this does, the hardening of background audio and of launches by an `IntentSender`, the memory limiter, whose exit reads `MemoryLimiter:AnonSwap`, and the end of the large-screen orientation opt-out. No page names a change to `am`, `cmd`, `pm`, `run-as`, an FCM broadcast from the app's own uid, notifications, logcat, App Link verification, per-app locales or edge-to-edge, and the suites for each passed.

## Asking the person first

`device-tests/ask-person.test.ts` runs a yes, a no, a client that cannot ask and the flag, over stdio on a simulator, on each revision of MCP, and the fixture's data stays on the no and where nothing could ask. `manage_app install` was run over an installed fixture on a simulator, and a file the fixture kept was still there after it.

## Push notifications

Run through the MCP server over stdio, by `device-tests/push.test.ts`. On an API 34 emulator `tapped` opened the fixture, whose screen showed the two keys it was given, and each other type to it was refused, as it has no Firebase Messaging, with no notification drawn by anyone. On an iPhone 17 Pro simulator with iOS 27.2 an alert from fields and one from APNs' own payload, with a badge, a sound and a category, reached the fixture's code with their keys, and `simctl` refused a background push: "Notification has no user visible content". With the fixture in the background, an alert, and one with `content-available`, left its code with the push before, as it did when it was not running.

A rich push is the app's Notification Service Extension's to change, and a simulator runs none for `simctl push`. Xcode 11.4's release notes say "The mutable-content key is not honored", and Xcode 14's that remote notifications "support more features (like Notification Service Extensions) than locally simulated notifications using .apns payload files or the simctl push command". Tried with Xcode 27.1 on an iOS 27.2 simulator: the fixture, built with an extension that `pluginkit` listed as installed, got a push with `mutable-content` in its own code unchanged, and no process of the extension started. Its log says why: `simctl` hands the notification center a request of its own making (`CoreSimulatorBridge` "Forwarding addRequest"), so apsd, which runs an extension, never sees the push.

A Live Activity's push reaches `liveactivitiesd` by its topic, the app's id with `.push-type.liveactivity`, and `simctl push` takes no topic but an app's. On the same simulator, given `dev.appdyno.fixture.push-type.liveactivity` it took that for an app and was refused, "Source is not authorized", and it sent an `event: start` payload to the fixture's own id as a plain notification. `liveactivitiesd`, `apsd` and `chronod`, the processes Apple names for these pushes, logged nothing of either.

### FCM's own message on Android

Run through the MCP server over stdio, by `device-tests/push.test.ts`, with `android/push-fixture`, an app with Firebase Messaging 26.0.1 whose options are made up. On an API 34 emulator, whose adbd was not root, a background push with the app in front, a Live Activity's at the home screen and a background push after its process was killed reached `onMessageReceived` with their data, a value with a space and an apostrophe as given; an alert and a rich push with the app in front reached it with their title, body and image; an alert at the home screen was drawn by its SDK and reached no code; with notifications revoked, the answer said so. To the fixture, which has no Firebase Messaging, each of the four was refused with that reason, and the shell posted nothing. On a Samsung Galaxy A52 with Android 14, not rooted, the data pushes in front, at home and after a kill reached it the same way. On the Xiaomi REDMI 15C with HyperOS 3, on 2026-11-17, the suite's cases of the push fixture passed: HyperOS takes a revoke of its notifications as a force stop, and the case starts the app again before its push. By hand, with a test app of the same kind on Firebase Messaging 24.1.0, the broadcast sent as root on that emulator reached `onMessageReceived`, and one from the shell's uid reached nothing there or on the Samsung; `send_push`'s own use of root is held by unit tests alone, as no device here runs adbd as root by itself.

### Apple's and Google's servers

FCM's request is tested against the one Firebase documents for a message to one device, recorded here, and the routes and the reading of an app's logcat with a fake device; no test reaches Google. On an API 34 emulator, by `device-tests/push.test.ts` with an account made up in a state folder of the suite's own, the types FCM takes were listed with their routes, and each push was refused before anything left this Mac: no token from the fixture, which prints none, a payload naming a topic, an app not installed. No push by FCM has been sent from here yet: it waits for a project's account.

Request shapes are tested against the requests recorded for each type, and the sending against a local HTTP/2 server; no test reaches Apple. On an iPhone 17 Pro simulator with iOS 27.2, by `device-tests/push.test.ts` with a key made up in a state folder of the suite's own, the types APNs takes were listed with their routes, and each push was refused before anything left this Mac: no token from the fixture, which prints none, a Live Activity's payload with no content state, VoIP the fixture does not declare, an app not installed. No push by APNs has been sent from here yet, and no iPhone run: they wait for a phone and a team's key.

## Links

`open_link` `links` was run on both: the fixture's scheme on the simulator, and on the emulator its scheme, its `https://example.com/order*` App Link, and that domain's state, `none` just after the install and a number of the verifier's own once it had tried. A link's prompt and the `opened` answer were run on an iPhone 17 Pro simulator with iOS 27.2, just erased, from a window's Links pane. A simulator opened `App-prefs:root=General` under an allow list of one app, as no other route opened Settings: that is why such a link is held to Settings' own id.

## Radios and biometrics

`device-tests/settings.test.ts` turned mobile data off and airplane mode on on an emulator, which left it no way to this Mac, and `restore` brought it back. On a Xiaomi with Android 16 all three radios took effect and read back in 234 to 1,127 ms, its saved networks untouched; it rejoined its Wi-Fi a few seconds after the switch read on. `biometric` was run on an API 34 emulator, where the whole check, enrolment and the fixture's prompt answered both ways, took 17 s. What an iPhone's `devicectl device simulate biometrics` answers was seen on one iPhone with no face enrolled, and no phone has been seen to take one.

## What could not be done on a simulator

A simulator's animations stay as they are, as no way to slow them was found. UIKit's `UIAnimationDragCoefficient` set to 10, in `com.apple.UIKit`, in the global domain or as a launch argument, left the fixture's 300 ms slide over within 0.7 s on an iPhone 17 Pro simulator with iOS 27.2, as it was with none. An iPhone Duo simulator folds by its hinge event, as [A fold](#a-fold) says, and not by its screens: with its outer screen powered off by `simctl io screenConfig`, on iOS 27.1, Settings started again showed nothing on the inner one.

## An iPhone's own conditions

Run on an iPhone 13 Pro Max over its cable: the fixture's data went from 4 files to none; its location went from Allowed to "Not asked", it asked again, and `answer_alert deny` made it "Denied"; `network slow` read back `SlowNetworkEdgeBad` and `full` none; `thermal serious` read back `ThermalSerious` and `nominal` none; the fixture showed `tr-TR`. `network slow` on a Samsung with One UI set the cap to 29,600 and `restore` deleted it, as the key had none before.

## A slow network

On an API 34 emulator a megabyte from this Mac took 778 ms, 11.2 s under a cap of 100,000, and the cap was gone after `restore`.

## Network on a simulator

`device-tests/network.simulator.test.ts` holds the network probe on a simulator: headers and bodies kept and hidden, a HAR read back, each kind of rule, the throttle, and nothing left once a capture or a session ends. It was written on an iOS simulator on 2026-11-16, where it found that the probe could hand an app the end of a mocked answer before its body, which was fixed. On the fixture there, a session whose configuration adds headers and gives up after 2 s still sent its headers, which the probe listed, and still ended at 2.0 s; a delegate that trusts no server failed without the probe and got its answer with it, as the probe does not ask an app's own certificate check; and an upload of 100 kB by a stream arrived whole, its body not kept. On the first start of a feed reader with 39 requests, a read of them all went from 2,313 characters to 1,319 once each host was said once. On 2026-11-17 the suite passed 18 of 18 on iOS 26.5 and on iOS 27.2: [1.3.0 on the simulators](#130-on-the-simulators). It is not among the simulator smoke's cases.

## A fold

`fold` was run on a 7.6" foldable emulator with API 34, where the device read `CLOSED` from the request and nothing after `restore`.

On an iPhone Duo simulator a fold is the hinge event that the simulator's own hinge slider sends, which is private. Before 1.3.0 was built on it, a trial outside the tools sent that event on 2026-11-15, to a Duo with iOS 27.2 (24B91016s) under Xcode 27.2 (27B52): the simulator folded and unfolded, `devicectl` said which display it showed, and an app kept its process while its scene moved between 466 x 678 points closed and 951 x 669 open. appdyno 1.2.0 read its screen open, by the runner, and its taps reached nothing on the inner display.

`device-tests/fold.test.ts` holds each pose against the fixture's own window, over a restart of the app, `restore` and the session's end, on a foldable emulator and on a Duo simulator. Its cases were written on 2026-11-16 for a Pixel 9 Pro Fold emulator with API 35 and a Duo simulator. On 2026-11-17 its 6 emulator cases passed on a Pixel 9 Pro Fold's profile with API 35 (`AE3A.240806.043`). On an iPhone Duo simulator with iOS 27.2 (24B91016s), under Xcode 27.2 (27B52) with the runner and the fixture built by it, it ran three times: its 6 cases passed once; once a tap on the open inner display did not open the fixture's Dialog screen; and once a person's window did not show the cover within 30 s, each case passing in the other two runs.

## Languages

`locale` on Android was run on an API 30 emulator, where Settings read Turkish after `tr-TR` and English after `restore`. On a simulator it was run on an iPhone 17 Pro with iOS 27.2, where Settings held in `tr-TR` read Ayarlar while the simulator's own `AppleLocale` stayed as it was, and read Settings again after `restore`.

## A locked phone

On an emulator with API 36 and a PIN set for the test, at host load 220-250, `read_screen`, `tap_screen` and `swipe_screen` were refused with `DEVICE_LOCKED` and no touch went out, by `device-tests/guards.test.ts`. On an iPhone with no passcode, a swipe 90 s after the last touch reached the app after one press of the home button, a launch woke the screen, and a session with no app chosen got past the lock screen on its own. The phone tested reads `passcodeRequired: false`, so the refusal for a phone with a passcode comes from the code alone and has not been run.

## Crashes

`read_logs` with `source: crashes` and `symbols` was run on an iPhone 13 Pro Max: a stripped Release build's crash read a bare `Fixture` frame, then `Fixture fixtureCrash(_:)` from its dSYM.

## Xcode 27.2

The simulator suites ran with Xcode 27.2 (27B52), used through `DEVELOPER_DIR` beside Xcode 26.5, on an iPhone 17 simulator with iOS 27.2 (24B8117), on 2026-11-15 and 16, one file at a time at host load 5 to 700 on 10 cores. 34 of the 40 files passed every test they ran, in the sweep or run again after a fix or at a lower load, taps, swipes, typing and keys by the simulator's helpers and by the runner alone among them; `hub.test.ts` and `mirror.hud.test.ts` failed one test each that failed the same on iOS 26.5, `gate-why.test.ts` and `perf-compare.test.ts` wait for a quiet Mac and were not run, `crashes.test.ts` needs a release build, and `simulator-create.test.ts` was left out. A runner and helpers built by Xcode 26.5 drove the same simulator under Xcode 27.2. On 2026-11-17 every one of those files ran again on a new simulator, with the runner and the fixtures built by Xcode 27.2, and these five passed: [1.3.0 on the simulators](#130-on-the-simulators).

## An iPhone on iOS 27.2

An iPhone 13 Pro Max with iOS 27.2 (24B119) on its cable, with Xcode 27.2 (27B52) used through `DEVELOPER_DIR` beside Xcode 26.5, on 2026-11-16 and 17, one file at a time at host load 2 to 120 on 10 cores. The phone has no passcode, and its developer was already trusted. Its signing was found by itself, with no variable set: a paid team's wildcard development profile that names the phone, with its identity in the login keychain. The runner built for a phone in 22 s, on a Mac whose Xcode had built it for a simulator before. The first connection, in which the runner is signed, installed and started, answered in 6.5 s, with a runner of an earlier build on the phone, and nothing was asked on the phone. The fixture installed in 1.5 s and launched in 3 s.

13 suites ran, each with the cases that stay inside the fixture, and 61 tests passed with none failed: `driving` 14 in 119 s, `keys` 3 in 36 s, `evidence` 6 in 49 s, `flows` 8 in 136 s, `scroll` 3 in 61 s, `steps` 2 in 59 s, `watch` 7 in 75 s, `picture-words` 2 in 20 s, `list-devices` 1, `app-data` 1 in 3 s, `guards` 3 in 59 s, `small-tools` 9 in 23 s and `diagnose` 2 in 5 s. `watch` failed one test at host load 104 and passed all 7 when run again. `press_key` with `command+a` selected a field's text, which `delete` then emptied. Left out, as each leaves the fixture or changes the phone: the clipboard, dark mode with text size and reduce motion, and volume with lock, of `driving`; copy and paste, Control Center, Notification Center and Spotlight of `keys`; the videos and the report of `evidence`, whose steps press home; the two lock screen cases of `guards`; mute and Siri of `small-tools`; and `iphone.test.ts`, `iphone-mcp.test.ts` and `open-settings.test.ts` whole, as they drive Settings. The suites that measure, and those of a window, were not run in that pass.

On 2026-11-17 a second pass ran what the first left out, and every other suite that takes a phone but `person-prompts.test.ts`, which needs a person's face, with the phone left as it was found: `driving` 3, `keys` 5, `evidence` 1, `guards` 2, `small-tools` 1, `open-settings` 6, `iphone-mcp` 1, `iphone` 22, `measures-iphone` 3, `install-ipa` 1, `live.iphone` 2, `inspector.iphone` 3, `mirror.iphone` 15 and `mirror.letters` 6 passed, 71 in all. Three of them passed once a fix was in: Siri's refusal had lost its hint, `appdyno mirror`; Settings over stdio was launched on the page another suite had left it on; and the trace tool did not find Settings for 240 s after a recording had attached to it, which is now refused with what to do, as the case starts Settings anew first. `diagnose` passed its 2 again once crash reports copied from the phone were held to the app's own. One case failed: the 5 MB network measure of `measures-iphone`, where the trace tool did not find the process of a hand-signed Debug fixture for 240 s, though `devicectl` listed it running; the case is written for a signed Release fixture.

`read_logs` answered with its note, as before: Xcode 27.2's `devicectl` has no command that reads a log. A trial outside the tools read the fixture's lines while it ran, with no restart. The phone's `com.apple.os_trace_relay.shim.remote` service, reached through the tunnel a live window uses and asked for one process id, sent that process's lines alone, each with its time, level, library and subsystem: 3,591 lines in 150 s, and 17,083 in 16 min 41 s, none of another process, and the app's process id was the same before and after. A stream that carried no line for about half a minute ended, and one that kept carrying them did not. No tool reads a log this way yet.

No push by APNs was sent: this Mac has no key set up, and the wildcard profile carries no push entitlement.

## A Xiaomi on HyperOS 3

A Xiaomi REDMI 15C (25078RA3EY) with Android 16, API 36, and HyperOS 3.0.301.0, on its cable, with "USB debugging (Security settings)" and "Install via USB" on, no screen lock and its language Turkish, on 2026-11-16 and 17, one file at a time at host load 2 to 54 on 10 cores. The agent needs no install, as it is pushed as a file: its first start took 8.5 s.

15 suites ran, each with the cases that stay inside the fixture, and 130 tests passed with none failed: `smoke` 1 in 13 s, `steps` 2 in 32 s, `scroll` 3 in 41 s, `picture-words` 2 in 17 s, `flows-ci` 5 in 83 s, `flows` 8 in 94 s, `surface` 4 in 83 s, `views.android` 7 in 29 s, `watch` 7 in 70 s, `keys` 4 in 32 s, `driving` 16 in 96 s, `android` 42 in 331 s, `small-tools` 7 in 22 s, `guards` 2 in 15 s and `evidence` 20 in 61 s. `views.android` and `watch` failed one test each at host load 32 to 54 and passed every test when run again at load 4. Taps, swipes, typing and keys reached the fixture. The phone writes a button's `List` as `LİST`, and a selector with `LIST` found it. `set_device fold` was refused, "this device does not fold". Left out, as each leaves the fixture or changes the phone: the clipboard, volume with lock and power, the app switcher, an install by `manage_app`, dark mode with its other settings, the animations, and the fingerprint, of `driving`; copy and paste, Control Center, the notifications and the search of `keys`; the animations, the clipboard and the two dark screen cases of `android`; mute and high contrast of `small-tools`; the lock screen case of `guards`; the videos, the report, the proxy, the status bar's clock and another app's web pages of `evidence`. The other suites were not run in that pass.

On 2026-11-17 a second pass ran what the first left out, and every other suite that takes a phone: `driving` 7, `keys` 5, `android` 4, `small-tools` 2, `evidence` 7, `open-settings` 24, `exits` 5, `diagnose` 8, `app-data` 2, `allow-apps` 5, `mcp-stdio` 8, `crashes` 2, `timeline` 6, `push` 10, `install-consent` 5 and `baseline-profile` 5 passed, 105 in all, and none failed once each fix was in. `allow-apps` read the phone's Turkish labels, and now goes by ids. `timeline` found that a crashed app the system holds for its "keeps stopping" dialog keeps its process, which read as running: it now reads as a crash. `push` passed 10 of 10 with the push fixture installed again, and a tapped push to an app held so now stops it first. `install-consent` answered the phone's install prompt itself, and now wakes a screen that went dark as the prompt opened. `baseline-profile` passed 5 of 5 by `manage_app install` with the APK and its `.dm`, appdyno answering each of HyperOS's install prompts itself. `guards.test.ts`'s PIN case and `lifecycle.test.ts` are an emulator's alone, and ran nothing here.

What this phone showed:

- An `adb install` of the fixture that nobody answered on the phone came back refused after 90 s, `INSTALL_FAILED_USER_RESTRICTED`, and one a person answered took 6 s. A fixture signed by another Mac's debug key had to be uninstalled first: `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
- The phone answers a new user rotation with a rotation lock of its own, written up to 3 s after. A turn put back, by `set_device restore`, at a flow's end or as the agent let go of UI automation, wrote the user rotation and then auto-rotate, and the phone's own write came after: auto-rotate stayed off. The first now writes the lock again until it reads as asked, and the agent writes it again each second for three. After each the phone read auto-rotate on, as it was found, and its own second key, `accelerometer_rotation_inner`, followed within 5 s.
- Not fixed: after the cases of `android.test.ts` that kill the agent or hand UI automation to another process, with no turn made, auto-rotate read off and stayed off, where the phone had it on. `accelerometer_rotation` written to 1 by hand held, and `accelerometer_rotation_inner` was later found at 0 and written to 1 too. Which of the five cases does it is not known yet. In the second pass the keys were read after each suite: as found, but for `accelerometer_rotation_inner` at 0 after `small-tools.test.ts`.

## Open in 1.3.0

What these runs left failing or unexplained, each as it was seen:

- **XCTest's metrics on iOS 27.2.** The launch metric recorded 0, 2 or 4 launches of the 5 asked for, of about 3.65 s each, in 4 runs of 4, its result bundle saying it passed; on iOS 26.5 it recorded 5 of about 1.17 s in 5 runs of 6. The hitches run ended "Test crashed with signal kill before establishing connection" in 3 runs of 4.
- **The Face ID sheet on iOS 27.2.** `ios.test.ts`'s case failed in 2 runs of 4: in the sweep the sheet was not seen within 10 s, and run alone the look at what stands over the app refused it as `remote-content` with no runner up to read it. It passed on iOS 26.5.
- **A fold on the iPhone Duo simulator.** 2 runs of 3 failed one case each, a different one each time: [A fold](#a-fold).
- **The trace tool of Xcode 26.5 on this Mac.** `ios-perf.test.ts`'s CPU profile and trace query timed out on iOS 26.5, in 3 runs of 3: `xctrace` of Xcode 26.5 started no recording, with Time Profiler or Allocations, where Xcode 27.2's recorded the same process in 12 s, and both cases passed on iOS 27.2. An `xctrace record` of Xcode 26.5 had been left running since 2026-11-15 for a simulator deleted since, with its `DTServiceHub`; those processes were ended after these runs, and the two cases have not run again under Xcode 26.5.
- **Settings on iOS 26.5.** A privacy page of `open-settings.test.ts` opened on Privacy & Security itself 3 times in 5 runs, a different page each time, and in none of one run on iOS 27.2. The settled Motion & Fitness page reads its title in a folded column, with no `text "Motion & Fitness"` line, so that case passes only on an early read.
- **A simulator's turn.** Put back since 1.3.1: the runner reads the turn before one is made, and `set_device` `restore`, a session's end and a test file turn it back. On an iPhone 17 simulator, iOS 26.5, found at `landscape_right` and turned upright, each of the three stood Safari wide again, 9 checks of 9, and the file after the one that turned it started with nothing changed.
- **The four emulator cases** of [1.3.0 on the emulators](#130-on-the-emulators).
- **The fixture's network measure on the iPhone,** and **auto-rotate on the Xiaomi** after cases that end its agent: [An iPhone on iOS 27.2](#an-iphone-on-ios-272) and [A Xiaomi on HyperOS 3](#a-xiaomi-on-hyperos-3).
