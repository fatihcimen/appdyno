# Tools

The 48 tools an MCP client can call. Each is also [a command](cli.md), and a call in [the library](library.md).

Tools take no `device` parameter. The device is the server's `--device`, else the only connected one,
else the one `use_device` selected.

| purpose  | tools                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| devices  | `list_devices`, `use_device`, `device_info`, `set_orientation`, `set_location`, `clipboard`, `device_setting`, `simulator` |
| window   | `mirror`, `hand_off`                                                                                                       |
| read     | `screen`, `find`, `wait_for`, `assert`, `screenshot`                                                                       |
| act      | `tap`, `gesture`, `swipe`, `scroll_to`, `type_text`, `press_key`, `keyboard`, `steps`, `alert`, `inspector`                |
| apps     | `open_link`, `launch_app`, `terminate_app`, `app`, `push`                                                                  |
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
`reduce_motion`, `animations`, `locale`, `network`, `proxy`, `battery`, `airplane`, `wifi`, `mobile_data`, `biometric`, `fold`, `call`, `sms` and `keychain`.

## What asks the person first

These lose what a person may want, so each waits for the person's yes:

- `app uninstall`: the app and all it keeps on the device
- `app clear`: all the app keeps
- `app replace_data`: all the app keeps now
- `app revoke`: a permission the app was given
- `app grant`: on an iPhone only, whose grant resets the permission to ask: the answer the person gave. A simulator's
  and Android's lose nothing and ask nothing
- `device_setting keychain`: every item apps keep in the keychain

The server asks by the client's own prompt, MCP elicitation, where the client declared it at `initialize`, and names the
device, the app and what is lost. The model cannot answer it. A no or a closed prompt does nothing, and the answer says
the person declined. A client that cannot ask is refused with `PERMISSION_REQUIRED` and how a person allows it, and so is
every client over `--http`, whose server lasts one POST and never saw its `initialize`. `--allow-data-loss virtual` on the
server's command line lets these go ahead with nothing asked on simulators and emulators, and `all` on phones too. Only a
person's registration of the server sets it: no argument, step or file of a tool stands for a yes. A command asks on its
terminal and takes `--yes` for the answer; with neither, only the flag lets it go ahead. `test-device/ask-person.test.ts`
runs a yes, a no, a client that cannot ask and the flag over stdio on a simulator, and the fixture's data stays on the no
and where nothing could ask.

`app install` and `build_and_run` are not among them: neither removes an app first, and on a simulator a file the
fixture kept was still there after its install over itself.

## What each platform can do

What a platform cannot do is refused with the reason (`UNSUPPORTED`):

| what                         | Android                              | simulator                         | iPhone                         |
| ---------------------------- | ------------------------------------ | --------------------------------- | ------------------------------ |
| volume buttons               | yes                                  | yes (no way to read back)         | the runner                     |
| clear an app's data          | `pm clear`                           | empties its container             | no: uninstall and install      |
| reads with no signing        | no need                              | no need                           | `inspector`: words and ids     |
| download, replace app data   | debuggable builds                    | yes                               | development-signed apps        |
| grant, revoke a permission   | `pm grant`, `pm revoke`              | `simctl privacy`                  | no: answer with `alert`        |
| launch environment           | no: args are intent extras           | yes                               | yes                            |
| dark mode, text, motion      | yes                                  | yes                               | `devicectl`                    |
| animations                   | yes                                  | no: use `reduce_motion`           | no                             |
| locale                       | per app, API 33+; whole device below | per app, changed; `app ""`: whole | no                             |
| slow network                 | emulator; a phone's downloads, 13+   | no                                | no                             |
| biometrics                   | an emulator's fingerprint            | yes                               | no: `devicectl` simulates none |
| airplane, Wi-Fi, mobile data | yes, read back                       | no: it has the Mac's network      | no                             |
| keychain                     | no: Android has none                 | emptied, counted                  | no                             |
| fold pose                    | a foldable, API 31+, put back        | no: `simctl` has none             | no                             |
| incoming call, SMS           | emulator only                        | no: no telephony                  | no                             |
| battery level                | yes                                  | no: it only draws one             | no                             |
| proxy                        | yes, put back                        | follows the Mac's                 | no: its Wi-Fi settings         |

## Push notifications

`push` sends one to the app, by `type`, from fields (`title`, `body`, `image`, `data`) or from `payload`, the platform's own JSON: APNs' on iOS, an FCM message on Android. Given both, it refuses. With no type it answers each type this device takes, the route it takes and the fields it takes there, with a template of the payload it would send, or why it cannot; its `data` holds the same as `types`. A push is answered with the screen after it, as an action is.

| type                    | Android emulator and phone                                          | simulator                                                                        | iPhone                   |
| ----------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------ |
| alert                   | drawn by the shell, big text: the app's code gets nothing           | `simctl push`: the app's code gets it if the app is in front, else only on a tap | no: only Apple's servers |
| rich                    | drawn by the shell, big picture                                     | no: `simctl push` runs no Notification Service Extension                         | no                       |
| inbox, messaging, media | drawn by the shell in that style                                    | no: Android's styles                                                             | no                       |
| tapped                  | the launcher activity, or `click_action`'s, with the data as extras | no: `simctl` taps nothing                                                        | no                       |
| background              | no: only Google's servers call `onMessageReceived`                  | no: `simctl` refuses a push with nothing to see                                  | no                       |
| live_activity           | no: a Live Update is built by the app from a data message           | no: `simctl push` makes a notification, which no Live Activity takes             | no                       |

The shell's notification is not the app's, and Android lets the shell give it nothing to open when tapped: `Permission Denial: getIntentSender()`. `tapped` is what [Firebase documents](https://firebase.google.com/docs/cloud-messaging/android/receive) for a push tapped while the app is in the background, "the data payload is delivered in the extras of the intent of your launcher Activity", opened as Firebase's tap opens it, on top of the app's task anew. An image is made small on this Mac and goes in the command, as the system cannot read the shell's files. A real iPhone takes a push only from Apple's servers: `open_link` with the app's deep link reaches the same code, or a simulator takes the push.

Run through the MCP server over stdio, by `test-device/push.test.ts`. On an API 34 emulator each drawn style was drawn, and `tapped` opened the fixture, whose screen showed the two keys it was given. On an iPhone 17 Pro simulator with iOS 27.2 an alert from fields and one from APNs' own payload, with a badge, a sound and a category, reached the fixture's code with their keys, and `simctl` refused a background push: "Notification has no user visible content". The answer says what reached the app's code by where the app was at the push, read just before it: in front, the code gets it; in the background or not running it is only shown, and the code gets it when its banner is tapped. With the fixture in the background, an alert, and one with `content-available`, left its code with the push before, as it did when it was not running.

A rich push is the app's Notification Service Extension's to change, and a simulator runs none for `simctl push`. Xcode 11.4's release notes say "The mutable-content key is not honored", and Xcode 14's that remote notifications "support more features (like Notification Service Extensions) than locally simulated notifications using .apns payload files or the simctl push command". Tried with Xcode 27.1 on an iOS 27.2 simulator: the fixture, built with an extension that `pluginkit` listed as installed, got a push with `mutable-content` in its own code unchanged, and no process of the extension started. Its log says why: `simctl` hands the notification center a request of its own making (`CoreSimulatorBridge` "Forwarding addRequest"), so apsd, which runs an extension, never sees the push.

A Live Activity's push reaches `liveactivitiesd` by its topic, the app's id with `.push-type.liveactivity`, and `simctl push` takes no topic but an app's. On the same simulator, given `dev.appdyno.fixture.push-type.liveactivity` it took that for an app and was refused, "Source is not authorized", and it sent an `event: start` payload to the fixture's own id as a plain notification. `liveactivitiesd`, `apsd` and `chronod`, the processes Apple names for these pushes, logged nothing of either. Apple tests them on a simulator through APNs' sandbox, `api.sandbox.push.apple.com`, from a Mac with Apple silicon or a T2 on macOS 13 or later, with the activity's own push token. So a rich push, a background push and a Live Activity's reach a simulator only from APNs' sandbox, with a key of the app's team, as each refusal says.

`open_link` `links` with an app's id lists the links it opens, read from the installed app: on a simulator its URL schemes and the domains its signature names, on Android each filter that views a link, as `scheme://host/path`, and each App Link domain with Android's verification state. Run on both: the fixture's scheme on the simulator, and on the emulator its scheme, its `https://example.com/order*` App Link, and that domain's state, `none` just after the install and a number of the verifier's own once it had tried. An iPhone's installed app is not read.

`open_link` says `opened` only when no system alert stands over the screen the link left. A simulator asks "Open in …?" before an app's scheme first opens it, and nothing opens until that is answered: the answer then says `sent`, with the alert's words and buttons, and to answer it with `alert`. With `read: none` nothing is read, and it says `opened`. Run on an iPhone 17 Pro simulator with iOS 27.2, just erased, from a window's Links pane.

## Radios, biometrics and the keychain

A radio is done when the device reads as asked, within 10 s: Wi-Fi by the state of the radio, because its setting changes first, and airplane mode and mobile data by the user's switch, so that a restore during airplane mode brings back what they chose. A device that does not change is refused with what it said. A device reached over its network (`adb connect`, wireless debugging) refuses `wifi off` and `airplane on`, because nothing could reach it to put them back. On an emulator, by `test-device/settings.test.ts`, data off or airplane mode on leaves the device with no way to this Mac, and `restore` brings it back. On a Xiaomi with Android 16 all three took effect and read back in 234 to 1,127 ms, its saved networks untouched; it rejoined its Wi-Fi a few seconds after the switch read on. A switch says nothing of a connection.

`biometric` on an emulator touches its sensor and is done only when the fingerprint service counted the touch: `match`, `nomatch`, each refused when no app is asking. On an emulator with no fingerprint `enroll` takes one by itself: it sets the screen lock to PIN 1234, written down first, goes through Settings' enrolment by its kinds of control and not their words (the PIN field, then the lowest and rightmost button), and touches the sensor until the service holds one. `restore` takes the PIN off, and Android deletes the fingerprints with it. An emulator with a lock of its own is refused, as its PIN cannot be typed, and so is a server started with `--no-home`, since Settings leaves the app. A real phone is refused: its sensor takes only a person's finger, and its lock is its owner's. Run on an API 34 emulator, where the whole check, enrolment and the fixture's prompt answered both ways, took 17 s. A simulator's `enroll` turns Face ID or Touch ID on. An app's prompt on Android is the system's and holds the focus: it reads as elements like any screen, though a screenshot of it is blank, because it is a secure window.

On an iPhone `devicectl device simulate biometrics` answers `Device does not support any biometric simulation, nothing to do` and exits 0, so it is not used: an answer would say done for a touch that never happened. That is one iPhone with no face enrolled, and no phone has been seen to take one.

`keychain` `reset` empties a simulator's keychain, and says how many items apps held, from the store's own rows, which also prove it empty after. The system's own rows stay and are not counted. It is one-shot: nothing brings them back.

## Two that were tried

A simulator's animations stay as they are, as no way to slow them was found. UIKit's `UIAnimationDragCoefficient` set to 10, in `com.apple.UIKit`, in the global domain or as a launch argument, left the fixture's 300 ms slide over within 0.7 s on an iPhone 17 Pro simulator with iOS 27.2, as it was with none. An iPhone Duo simulator with iOS 27.1 shows its app on the outer screen. With that screen powered off by `simctl io screenConfig`, Settings started again showed nothing on the inner one, so a fold of it is not that either.

## A slow network

`network` `slow` on an emulator goes by its console: an EDGE speed both ways and a delay of 40 to 100 ms. A phone from Android 13 has only Android's own cap, `ingress_rate_limit_bytes_per_second`: `slow` caps what it downloads at 30 kB/s, an EDGE network's download, and a number caps it at that many bytes a second on a phone or an emulator. It adds no delay and leaves uploads at full speed, and the answer says so. The cap is a setting the device keeps, so the old one is written down and `restore` deletes it. On an API 34 emulator a megabyte from this Mac took 778 ms, 11.2 s under a cap of 100,000, and the cap was gone after `restore`. No phone has been run yet.

## A fold

`fold` on Android asks `cmd device_state` for the state of that name, `open`, `closed` or another the device lists such as `half_opened`, by its id there, which differs by device, and is done when the device is in it. The request holds until it is reset, whatever the hinge does and whatever becomes of this tool, so it is a condition: `restore` resets it, and `default (now open)` is no request. It is the same on an emulator and a phone, from API 31. Run on a 7.6" foldable emulator with API 34, where the device read `CLOSED` from the request and nothing after `restore`. No real foldable has been run.

## Languages

`locale` on Android is an app's own from API 33, given the app or with one selected, by `cmd locale`. Below API 33, where apps have none, it is the whole device's, set by the agent as Settings sets it: Android keeps it in `persist.sys.locale`, so the old value is written down first and put back. A device that had never chosen one keeps the old language as chosen after. Run on an API 30 emulator, where Settings read Turkish after `tr-TR` and English after `restore`.

On a simulator, with an app given or selected, `locale` holds that app in a language for every launch this tool makes, by `-AppleLanguages` and `-AppleLocale`, kept on this Mac: nothing changes on the simulator. This is a change: it used to set the whole simulator whatever the app. What no longer changes with an app selected is the system's own text, such as permission prompts and Settings, and a launch this tool does not make: an icon tap, a link or a push that starts the app, the app starting itself again. `app ""` sets the whole simulator, as before, and the answer names which it took. An app that runs is started again in it, and again at `restore`. XCTest's launch measure is given the same arguments, which has not been checked. `launch_app` `language` holds the same way until `restore`, as on Android. One app's language is held at a time: another is refused until `restore`. Run on an iPhone 17 Pro simulator with iOS 27.2, where Settings held in `tr-TR` read Ayarlar while the simulator's own `AppleLocale` stayed as it was, and read Settings again after `restore`.

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
  reached over USB. Only a window goes by the network. A phone's clipboard goes by Xcode's `devicectl`, with no runner and nothing asked on the phone,
  and a simulator's is read from the Mac. Text goes in as keys on iOS: a paste brings up iOS's "Allow Paste" alert.
