# Tools

The 47 tools an MCP client can call. Each is also [a command](cli.md), and a call in [the library](library.md).

Tools take no `device` parameter. The device is the server's `--device`, else the only connected one,
else the one `use_device` selected.

| purpose  | tools                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| devices  | `list_devices`, `use_device`, `device_info`, `set_orientation`, `set_location`, `clipboard`, `device_setting`, `simulator` |
| window   | `mirror`, `hand_off`                                                                                                       |
| read     | `screen`, `find`, `wait_for`, `assert`, `screenshot`                                                                       |
| act      | `tap`, `gesture`, `swipe`, `scroll_to`, `type_text`, `press_key`, `keyboard`, `steps`, `alert`, `inspector`                |
| apps     | `open_link`, `launch_app`, `terminate_app`, `app`                                                                          |
| check    | `audit` (accessibility), `logs`, `crashes`, `visual`                                                                       |
| evidence | `record`, `report`, `network`                                                                                              |
| inside   | `webview`, `react_native`                                                                                                  |
| measure  | `perf_snapshot`, `perf_scroll`, `perf_launch`, `perf_profile`, `perf_heap`, `perf_trace`, `perf_compare`, `perf_query`     |
| replay   | `flow`                                                                                                                     |

## Reading the screen

A whole screen in an answer folds what repeats. A plain text or image inside a row whose label holds it gets no line, nor does a control of the row's name at the row's very place, and the first line counts them. Three or more rows alike in a row share one header (`cell x=201 clickable: ref "label" y`). A label given twice over is said once, and what tells alike elements apart only when another line shows the same name. Only the text is folded: `find`, selectors, refs, diffs, flows and `report` still reach every element.

## Targets

A target is a `ref`, `x` and `y`, or a `selector` `{ text, id, role, index }`, resolved on a fresh read
just before the action. Text matches as `find` does, without case or accents ("İstanbul", "istanbul"),
and an exact match beats a partial one. Several matches refuse and list them with their refs; no match
waits a moment, then refuses with the nearest labels.

## Steps, gestures, apps and settings

`steps` runs up to 30 steps across screens. A ref or selector need exist only when its step runs. It
stops at the first failure, says which step and why, and shows the screen. `wait_for` and selectors
wait on the device, so the tree crosses the wire only when the screen changed.

`gesture` holds `double_tap`, `long_press`, `drag`, `pinch` and a free `plan`. `press_key` holds the
hardware buttons. `app` holds `list`, `state`, `install`, `uninstall`, `clear`, `grant`, `revoke`,
`launch` with arguments and environment, `download_data` into a new or empty folder, and `replace_data`
from one, which stops the app and takes away what the folder does not hold, and `build_and_run` from a
project on this Mac: an Xcode project with `scheme` and `configuration`, or a Gradle folder with `scheme` as
its module and `configuration` as its variant. `device_setting` holds `dark_mode`, `text_size`,
`reduce_motion`, `animations`, `locale`, `network`, `proxy`, `battery`, `airplane`, `wifi`, `mobile_data`, `push`, `biometric`, `fold`, `call`, `sms` and `keychain`.

## What each platform can do

What a platform cannot do is refused with the reason (`UNSUPPORTED`):

| what                         | Android                    | simulator                    | iPhone                         |
| ---------------------------- | -------------------------- | ---------------------------- | ------------------------------ |
| volume buttons               | yes                        | yes (no way to read back)    | the runner                     |
| clear an app's data          | `pm clear`                 | empties its container        | no: uninstall and install      |
| reads with no signing        | no need                    | no need                      | `inspector`: words and ids     |
| download, replace app data   | debuggable builds          | yes                          | development-signed apps        |
| grant, revoke a permission   | `pm grant`, `pm revoke`    | `simctl privacy`             | no: answer with `alert`        |
| launch environment           | no: args are intent extras | yes                          | yes                            |
| dark mode, text, motion      | yes                        | yes                          | `devicectl`                    |
| animations                   | yes                        | no: use `reduce_motion`      | no                             |
| locale                       | per app, API 33+           | whole simulator              | no                             |
| slow network                 | emulator only              | no                           | no                             |
| push                         | a shell notification       | to the app                   | no: needs Apple credentials    |
| biometrics                   | an emulator's fingerprint  | yes                          | no: `devicectl` simulates none |
| airplane, Wi-Fi, mobile data | yes, read back             | no: it has the Mac's network | no                             |
| keychain                     | no: Android has none       | emptied, counted             | no                             |
| fold pose                    | a foldable emulator        | no: `simctl` has none        | no                             |
| incoming call, SMS           | emulator only              | no: no telephony             | no                             |
| battery level                | yes                        | no: it only draws one        | no                             |
| proxy                        | yes, put back              | follows the Mac's            | no: its Wi-Fi settings         |

## Radios, biometrics and the keychain

A radio is done when the device reads as asked, within 10 s: Wi-Fi by the state of the radio, because its setting changes first, and airplane mode and mobile data by the user's switch, so that a restore during airplane mode brings back what they chose. A device that does not change is refused with what it said. A device reached over its network (`adb connect`, wireless debugging) refuses `wifi off` and `airplane on`, because nothing could reach it to put them back. On an emulator, by `test-device/settings.test.ts`, data off or airplane mode on leaves the device with no way to this Mac, and `restore` brings it back. On a Xiaomi with Android 16 all three took effect and read back in 234 to 1,127 ms, its saved networks untouched; it rejoined its Wi-Fi a few seconds after the switch read on. A switch says nothing of a connection.

`biometric` on an emulator touches its sensor and is done only when the fingerprint service counted the touch: `match`, `nomatch`, each refused when no app is asking. A fresh emulator has no fingerprint: set a screen lock, open Settings' fingerprint enrolment, and `enroll` touches until the service holds one. A simulator's `enroll` turns Face ID or Touch ID on. An app's prompt on Android is the system's and holds the focus: it reads as elements like any screen, though a screenshot of it is blank, because it is a secure window.

On an iPhone `devicectl device simulate biometrics` answers `Device does not support any biometric simulation, nothing to do` and exits 0, so it is not used: an answer would say done for a touch that never happened. That is one iPhone with no face enrolled, and no phone has been seen to take one.

`keychain` `reset` empties a simulator's keychain, and says how many items apps held, from the store's own rows, which also prove it empty after. The system's own rows stay and are not counted. It is one-shot: nothing brings them back.

## Putting a device back

Changing a condition writes the old value down first, with the process that changed it. It goes back
when that session ends, or with `device_setting` name `restore`, which leaves alone what another live
process changed and says so. A session that died leaves the file, and the next one on that device puts
back only what a dead process left, and says so; what cannot be put back is reported, and a file that
cannot be read is kept beside it as `.bad`. A command line is one process per command, so its changes
stay until `restore`, whatever sessions come and go.

A recording, a network capture, an open report and a flow recording go the same way. The next session
ends what a dead process left and says so (a flow recording stops with its steps kept), leaves what a
live one runs, and leaves what a command line started for its next command.

## Sharing a device

A process that drives a device holds it: a file in the state directory with its pid and start time.
A dead owner's claim is free. A second process is refused with the owner's pid and name unless it asks
to share: `use_device` with `share: true`, `--share` on either command line, or `APPDYNO_SHARE=1`.
`list_devices` shows who holds what. There is no daemon.

## Starting a simulator or emulator

`simulator` boots and shuts down simulators and emulators, on request only. With no name, shutdown
touches only what this tool started. `APPDYNO_EMULATOR_ARGS` replaces the emulator's default flags, and `APPDYNO_EMULATOR_FIRST_PORT` is where the search for a free port starts.

## What an action answers

An action answers with the settled screen. `settled` means the screen was still for the window.
`changed` means the screen differs from before the action, in layout or text; it does not say the action
caused it. If nothing changed the answer says "no change seen in N ms; if a slow reaction is expected,
use wait_for". A failed call is an `isError` answer with a `code` and a `hint`, and a failed action says whether its touch went out (`dispatched`). An action reads a screen nobody has seen before it touches it, and a locked phone refuses by name (`DEVICE_LOCKED`). Cancelling a request
reaches the device, and long operations report progress.

## Logs and crashes

`logs` reads logcat for the app on Android and the simulator log on a simulator. For an iPhone,
`devicectl` cannot read the log of a running app, and the answer says so. `crashes` collects the
system's crash records for the app (Android exit info and dropbox, the simulator's DiagnosticReports,
an iPhone's system crash logs) as a bounded summary and a file path. Secrets are redacted. On Android it also counts every exit the system keeps, by its reason in full, because an app that left by itself or was killed did not crash: `SIGNALED status 9`, `USER REQUESTED KILL BACKGROUND`, `EXIT_SELF status 3`.

With `symbols`, it names the stack of a release build. On iOS that is a `.dSYM`, or a folder holding them such as the build's products, and an image is named with `atos` only from the dSYM whose UUID, by `dwarfdump`, is the crashed image's: any other would name the wrong functions and look right, so a report with none says which UUID it wanted and which the folder has. On Android it is a folder of libraries that keep their symbols, such as the `lib` folder of a build (`merged_native_libs/.../out/lib`, the ABI found from the tombstone), read by `ndk-stack` from the newest NDK in the SDK, which leaves a library of another build unread, and the answer says which ids differ. On an iPhone 13 Pro Max a stripped Release build's crash read a bare `Fixture` frame, then `Fixture fixtureCrash(_:)` from its dSYM. A tombstone comes a moment after the crash, and a Java crash has none. Android keeps few: on API 34 the first 6 native crashes of an app in some minutes left one and the next left none, and the answer says so, which a loop of crashing runs will meet. The whole stack is left in the file `named` gives. Optimized Swift may give a function with no line.

## Reaching a phone

- Android: turn on USB debugging, connect, and check `adb devices`. A Xiaomi asks on its screen before each new install over USB and
  says no by itself after 10 s: `app install` wakes it and taps yes, and only that, during the install it started, and the answer and `report`
  say so (`--no-install-consent` leaves it to you). Play Protect's prompt to send the app to Google is always answered no: a private build stays
  here. A Play Protect warning is left alone, quoted, unless the server runs with `--accept-install-warnings`. See [the protocol](protocol.md),
  "A phone's install prompts", for what was seen on which phone. A Samsung with One UI has no prompt of its own, and Play Protect's come only with "Verify apps over USB" on. What else differs between the two is in [the performance reference](perf.md), "One UI against HyperOS".
- iPhone: turn on developer mode. A phone needs a development signing identity and a provisioning profile that names it. An
  installed profile for a wildcard app id, with its identity in the unlocked login keychain, is found by itself. To choose another,
  set `APPDYNO_IOS_PROFILE=<profile.mobileprovision>`, `APPDYNO_IOS_KEYCHAIN=<keychain-db>` and
  `APPDYNO_IOS_KEYCHAIN_PASSWORD=<password>`. Run `appdyno doctor` to see what it found. The phone is
  reached over USB, never the network. A phone's clipboard goes by Xcode's `devicectl`, with no runner and nothing asked on the phone,
  and a simulator's is read from the Mac. Text goes in as keys on iOS: a paste brings up iOS's "Allow Paste" alert.
