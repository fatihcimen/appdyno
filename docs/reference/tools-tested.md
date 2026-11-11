# How the tools were tested

[Türkçe](tools-tested.tr.md)

What [the tools](tools.md) were run on, and what each run showed. The device suites are in `device-tests/`, and [CI and releases](ci.md) says how to run them. The _fixture_ is appdyno's own test app, `dev.appdyno.fixture`. A _host load_ is the Mac's 1-minute load average, on 15 cores.

## Android 17

Every Android device suite ran on an emulator of Android 17, API 37, on 2026-11-08: `system-images;android-37.0;google_apis;arm64-v8a` revision 8, build `CE2A.260420.051.A3`, emulator 37.2.13, 1080x2400 at 420 dpi, drawing on its CPU (`swiftshader_indirect`), adbd not root, one file at a time at host load 8 to 28 on 15 cores. `evidence.test.ts`'s proxy test was left out, as this run changed no proxy. A test that failed ran again, and then on an API 34 emulator of the same make, revision 14, build `UE1A.230829.050`, to tell Android 17 from the rest. What Android 17 changed, each fixed and run again on it:

- The dispatcher holds injected touches to one whole stream, whoever sent them. A finger left down, by an agent killed during a long press, had every later finger-down refused ("Invalid DOWN event - pointers already down"), and held on the status bar it opened the shade at the next activity start. A new agent lifts a finger left down, and a refused finger-down lifts it and goes again. Where none was left, the dispatcher refuses the agent's cancel and writes that to the log, with its state, at most twice a start; API 34 writes nothing of it. Google's pages for Android 17 do not name this.
- The credential prompt is the biometric one with a credential view in it, and read as a fingerprint: it reads as a passcode.
- An app that targets 37 reaches this Mac at `10.0.2.2`, or the LAN, only with `ACCESS_LOCAL_NETWORK`: without it the fixture's download hung, and `perf_snapshot` and `network` counted 0 bytes. The fixture asks for it, and `adb install -g` grants it; an app of yours that targets 37 needs it for the same. `network` with `via: proxy` for such an app was not tried.
- `cmd package compile --reset` keeps a `.dm`'s profile and compiles nothing with it, so a launch measure with `compile` left an app the `.dm` had compiled at `verify`. It compiles that app at `speed-profile` again, which then reads `reason=cmdline`.
- A `.dm` for another range of API is refused at install, "The profile is in the wrong format", where API 34 took it and compiled nothing.
- `dumpsys meminfo` lists native allocations by kind, with a bitmap row only where the app holds one: there no row reads 0 bitmaps, where an Android with no such list reads none.
- `locksettings clear` fails where no PIN is set, saying it "has no password", as after a test has cleared its own: that test's cleanup takes the answer as done.

After these, every test of 37 of the 45 suites passed, in the sweep or run again after its fix, where `perf.test.ts` and `evidence.test.ts` ran again only for their network tests; 8 failed a test each that failed the same on API 34, or that this emulator's make explains: a native crash's symbols of another build, of which NDK r30's `ndk-stack` no longer warns, where r28's does on the same tombstone; the light screen of `vitals.test.ts` and the live numbers of `mirror.hud.test.ts`, on emulators drawing on their CPU, where [the performance reference](perf.md#what-works-where) draws on the Mac's GPU; mobile data off with Wi-Fi on, by which the API 37 emulator still reached this Mac at `10.0.2.2`; high contrast text, whose test lost an agent on both; the steps of `report` from the command line; a fingerprint sensor with none enrolled, which answers `NOT_FOUND` where the test wants no sensor; and the emulator's own picture by gRPC, as this one wrote no file that names its port. `diagnose.test.ts` fails on both right after `crashes.test.ts`, as the system's crash dialog holds the crashed process alive and no app window is left in front, and passes by itself. `exits.test.ts`, `timeline.test.ts` and `perf-compare.test.ts` each failed once and passed run again.

Of Google's behavior changes for Android 17, for all apps and for apps that target 37, these could touch what this does: the local network permission, above; hidden passwords from a physical keyboard, the IME not shown again after a rotation, and accessibility events for a physical keyboard's typing, which the suites' typing, rotation and password field passed through; static final fields that reflection cannot change, of which the agent changes none; and, not tried here, `setContentCaptureEnabled(false)` no longer blocking content capture, which is not the screen capture this does, the hardening of background audio and of launches by an `IntentSender`, the memory limiter, whose exit reads `MemoryLimiter:AnonSwap`, and the end of the large-screen orientation opt-out. No page names a change to `am`, `cmd`, `pm`, `run-as`, an FCM broadcast from the app's own uid, notifications, logcat, App Link verification, per-app locales or edge-to-edge, and the suites for each passed.

## Asking the person first

`device-tests/ask-person.test.ts` runs a yes, a no, a client that cannot ask and the flag, over stdio on a simulator, on each revision of MCP, and the fixture's data stays on the no and where nothing could ask. `app install` was run over an installed fixture on a simulator, and a file the fixture kept was still there after it.

## Push notifications

Run through the MCP server over stdio, by `device-tests/push.test.ts`. On an API 34 emulator `tapped` opened the fixture, whose screen showed the two keys it was given, and each other type to it was refused, as it has no Firebase Messaging, with no notification drawn by anyone. On an iPhone 17 Pro simulator with iOS 27.2 an alert from fields and one from APNs' own payload, with a badge, a sound and a category, reached the fixture's code with their keys, and `simctl` refused a background push: "Notification has no user visible content". With the fixture in the background, an alert, and one with `content-available`, left its code with the push before, as it did when it was not running.

A rich push is the app's Notification Service Extension's to change, and a simulator runs none for `simctl push`. Xcode 11.4's release notes say "The mutable-content key is not honored", and Xcode 14's that remote notifications "support more features (like Notification Service Extensions) than locally simulated notifications using .apns payload files or the simctl push command". Tried with Xcode 27.1 on an iOS 27.2 simulator: the fixture, built with an extension that `pluginkit` listed as installed, got a push with `mutable-content` in its own code unchanged, and no process of the extension started. Its log says why: `simctl` hands the notification center a request of its own making (`CoreSimulatorBridge` "Forwarding addRequest"), so apsd, which runs an extension, never sees the push.

A Live Activity's push reaches `liveactivitiesd` by its topic, the app's id with `.push-type.liveactivity`, and `simctl push` takes no topic but an app's. On the same simulator, given `dev.appdyno.fixture.push-type.liveactivity` it took that for an app and was refused, "Source is not authorized", and it sent an `event: start` payload to the fixture's own id as a plain notification. `liveactivitiesd`, `apsd` and `chronod`, the processes Apple names for these pushes, logged nothing of either.

### FCM's own message on Android

Run through the MCP server over stdio, by `device-tests/push.test.ts`, with `android/push-fixture`, an app with Firebase Messaging 26.0.1 whose options are made up. On an API 34 emulator, whose adbd was not root, a background push with the app in front, a Live Activity's at the home screen and a background push after its process was killed reached `onMessageReceived` with their data, a value with a space and an apostrophe as given; an alert and a rich push with the app in front reached it with their title, body and image; an alert at the home screen was drawn by its SDK and reached no code; with notifications revoked, the answer said so. To the fixture, which has no Firebase Messaging, each of the four was refused with that reason, and the shell posted nothing. On a Samsung Galaxy A52 with Android 14, not rooted, the data pushes in front, at home and after a kill reached it the same way. By hand, with a test app of the same kind on Firebase Messaging 24.1.0, the broadcast sent as root on that emulator reached `onMessageReceived`, and one from the shell's uid reached nothing there or on the Samsung; `push`'s own use of root is held by unit tests alone, as no device here runs adbd as root by itself.

### Apple's and Google's servers

FCM's request is tested against the one Firebase documents for a message to one device, recorded here, and the routes and the reading of an app's logcat with a fake device; no test reaches Google. On an API 34 emulator, by `device-tests/push.test.ts` with an account made up in a state folder of the suite's own, the types FCM takes were listed with their routes, and each push was refused before anything left this Mac: no token from the fixture, which prints none, a payload naming a topic, an app not installed. No push by FCM has been sent from here yet: it waits for a project's account.

Request shapes are tested against the requests recorded for each type, and the sending against a local HTTP/2 server; no test reaches Apple. On an iPhone 17 Pro simulator with iOS 27.2, by `device-tests/push.test.ts` with a key made up in a state folder of the suite's own, the types APNs takes were listed with their routes, and each push was refused before anything left this Mac: no token from the fixture, which prints none, a Live Activity's payload with no content state, VoIP the fixture does not declare, an app not installed. No push by APNs has been sent from here yet, and no iPhone run: they wait for a phone and a team's key.

## Links

`open_link` `links` was run on both: the fixture's scheme on the simulator, and on the emulator its scheme, its `https://example.com/order*` App Link, and that domain's state, `none` just after the install and a number of the verifier's own once it had tried. A link's prompt and the `opened` answer were run on an iPhone 17 Pro simulator with iOS 27.2, just erased, from a window's Links pane. A simulator opened `App-prefs:root=General` under an allow list of one app, as no other route opened Settings: that is why such a link is held to Settings' own id.

## Radios and biometrics

`device-tests/settings.test.ts` turned mobile data off and airplane mode on on an emulator, which left it no way to this Mac, and `restore` brought it back. On a Xiaomi with Android 16 all three radios took effect and read back in 234 to 1,127 ms, its saved networks untouched; it rejoined its Wi-Fi a few seconds after the switch read on. `biometric` was run on an API 34 emulator, where the whole check, enrolment and the fixture's prompt answered both ways, took 17 s. What an iPhone's `devicectl device simulate biometrics` answers was seen on one iPhone with no face enrolled, and no phone has been seen to take one.

## What could not be done on a simulator

A simulator's animations stay as they are, as no way to slow them was found. UIKit's `UIAnimationDragCoefficient` set to 10, in `com.apple.UIKit`, in the global domain or as a launch argument, left the fixture's 300 ms slide over within 0.7 s on an iPhone 17 Pro simulator with iOS 27.2, as it was with none. An iPhone Duo simulator with iOS 27.1 shows its app on the outer screen. With that screen powered off by `simctl io screenConfig`, Settings started again showed nothing on the inner one, so a fold of it is not that either.

## An iPhone's own conditions

Run on an iPhone 13 Pro Max over its cable: the fixture's data went from 4 files to none; its location went from Allowed to "Not asked", it asked again, and `alert deny` made it "Denied"; `network slow` read back `SlowNetworkEdgeBad` and `full` none; `thermal serious` read back `ThermalSerious` and `nominal` none; the fixture showed `tr-TR`. `network slow` on a Samsung with One UI set the cap to 29,600 and `restore` deleted it, as the key had none before.

## A slow network

On an API 34 emulator a megabyte from this Mac took 778 ms, 11.2 s under a cap of 100,000, and the cap was gone after `restore`.

## A fold

`fold` was run on a 7.6" foldable emulator with API 34, where the device read `CLOSED` from the request and nothing after `restore`.

## Languages

`locale` on Android was run on an API 30 emulator, where Settings read Turkish after `tr-TR` and English after `restore`. On a simulator it was run on an iPhone 17 Pro with iOS 27.2, where Settings held in `tr-TR` read Ayarlar while the simulator's own `AppleLocale` stayed as it was, and read Settings again after `restore`.

## Crashes

`crashes` with `symbols` was run on an iPhone 13 Pro Max: a stripped Release build's crash read a bare `Fixture` frame, then `Fixture fixtureCrash(_:)` from its dSYM.
