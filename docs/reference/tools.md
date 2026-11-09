# Tools

[Türkçe](tools.tr.md)

The 48 tools an MCP client can call. Each is also [a command](cli.md), and a call in [the library](library.md).

Tools take no `device` parameter. The device is the server's `--device`, else the only connected one,
else the one `use_device` selected.

The server speaks MCP's revisions from 2024-10-07 to 2025-11-25, which open with `initialize`, and 2026-07-28, which
opens with `server/discover`, over stdio and over `--http` alike: the client's first message says which. The tools
and what they say of themselves are the same, byte for byte, on each.

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

A screenshot's answer says where its pixel is tapped: its x and y times its scale to tap units, said as a division where that is a whole one, `x/3` for an iPhone's picture at full size.

## Targets

A target is a `ref`, `x` and `y`, or a `selector` `{ text, id, role, index }`, resolved on a fresh read
just before the action. Text matches as `find` does, without case or accents ("İstanbul", "istanbul"),
and an exact match beats a partial one. Several matches refuse and list them with their refs; no match
waits a moment, then refuses with the nearest labels.

## Steps, gestures, apps and settings

`steps` runs up to 30 steps across screens. A ref or selector need exist only when its step runs. It
stops at the first failure, says which step and why, and shows the screen. `wait_for` and selectors
wait on the device, so the tree crosses the wire only when the screen changed. A step whose app died, of an app
that was in front when the step began, ends it too, naming the step, with the `appDied` and words that action alone gives.
`wait_for` waits 15000 ms at most a call, as its description says, and a number past an argument's limit is refused with the limit in the hint.
A touch's target in a step goes in `selector`, as `{"action":"tap","selector":{"text":"OK"}}`, where `wait_for` takes `text` at its top: a touch given it there is refused with its step in that shape in the hint.

`gesture` holds `double_tap`, `long_press`, `drag`, `pinch` and a free `plan`. `press_key` holds the
hardware buttons. `app` holds `list`, `state`, `install`, `uninstall`, `clear`, `grant`, `revoke`,
`launch` with arguments and environment, `download_data` into a new or empty folder, and `replace_data`
from one, which stops the app and takes away what the folder does not hold, and `build_and_run` from a
project on this Mac: an Xcode project with `scheme` and `configuration`, or a Gradle folder with `scheme` as
its module and `configuration` as its variant. `device_setting` holds `dark_mode`, `text_size`,
`reduce_motion`, `animations`, `locale`, `network`, `proxy`, `battery`, `airplane`, `wifi`, `mobile_data`, `biometric`, `fold`, `call`, `sms` and `keychain`. `dark_mode` reads as it is set, `on` or `off`, on both platforms.

`launch_app` says whether it started the app or brought a running one to the front, on the screen it was on, and `app` `launch` whether it started the app or restarted a running one, as it stops one first. An app the device does not have is refused as `NOT_FOUND` on both platforms, with `app` `list` in its hint.

Each change is read back: the answer says `changed` only when the device then reads otherwise than before, and `restore` says restored only of what reads as it was. `text_size` on iOS is one of its sizes, from `extra-small` to `accessibility-extra-extra-extra-large`, and on Android a scale from 0.25 to 5 or `default`: another is refused, with what it takes.

## What asks the person first

These lose what a person may want, so each waits for the person's yes:

- `app uninstall`: the app and all it keeps on the device
- `app clear`: all the app keeps
- `app replace_data`: all the app keeps now, which the folder's data replaces
- `app revoke`: a permission the app was given
- `app grant`: on an iPhone only, whose grant resets the permission to ask: the answer the person gave. A simulator's
  and Android's lose nothing and ask nothing
- `device_setting keychain`: every item apps keep in the keychain
- an input on the system's own power, emergency or erase controls, the device itself: a tap, gesture, swipe, long press,
  typing or key from any tool, `steps` or a flow, on Android's power menu (Power off, Restart, Emergency) or its button in
  quick settings, a lock screen's emergency call, Settings' resets and its erase-all-data screen, iOS's slide to power off
  and Emergency SOS, or Settings' Reset and Erase All Content and Settings, known by the system app, the ids in any
  language and the words in English and Turkish wherever the touch lands; and a third press of the power or side key in
  5 seconds, which calls for help on many phones. appdyno restarts, powers off, resets and erases no device, and the
  answer says the person does it. Reading such a screen asks nothing, nor back and home, which leave it. Only
  `--allow-power virtual` or `all` lets these go ahead with nothing asked, never `--allow-data-loss`

The server asks by the client's own prompt, MCP elicitation, where the client declared it can, at `initialize` on a 2025
revision and on each request on 2026-07-28, and names the device, the app and what is lost. The model cannot answer it.
A no or a closed prompt does nothing, and the answer says its question got no yes, never that a person declined: a client may answer by itself, as one run headless answered no in 9 ms, with no person shown the question. Each refusal's hint says how a person allows it ahead, by the flag below, the hint of a no too. On 2026-07-28 no request goes back to a
client, so the call ends its round with the question and the client brings the answer back with the call: the call waits
where it stopped, so a step before it in the same `steps` is not done again, and an answer that does not come in 5
minutes is a no. A client that cannot ask is refused with `PERMISSION_REQUIRED` and how a person allows it, and so is a
2025 client over `--http`, whose server lasts one POST and never saw its `initialize`; a 2026-07-28 one is asked within
the call. `--allow-data-loss virtual` on the
server's command line lets these go ahead with nothing asked on simulators and emulators, and `all` on phones too. Only a
person's registration of the server sets it: no argument, step or file of a tool stands for a yes. A command asks on its
terminal and takes `--yes` for the answer; with neither, only the flag lets it go ahead. `device-tests/ask-person.test.ts`
runs a yes, a no, a client that cannot ask and the flag over stdio on a simulator, on each revision, and the fixture's
data stays on the no and where nothing could ask.

`app install` and `build_and_run` are not among them: neither removes an app first, and on a simulator a file the
fixture kept was still there after its install over itself. Under `--allow-apps`, `app install` installs only an app the list
names, by the id the file holds, read before anything reaches the device, and refuses another, naming it; `build_and_run` is refused, as what a project builds is not known before it is built.

## What each platform can do

What a platform cannot do is refused with the reason (`UNSUPPORTED`):

| what                         | Android                              | simulator                         | iPhone                         |
| ---------------------------- | ------------------------------------ | --------------------------------- | ------------------------------ |
| volume buttons               | yes                                  | yes (no way to read back)         | the runner                     |
| clear an app's data          | `pm clear`                           | empties its container             | development-signed apps        |
| reads with no signing        | no need                              | no need                           | `inspector`: words and ids     |
| download, replace app data   | debuggable builds                    | yes                               | development-signed apps        |
| grant, revoke a permission   | `pm grant`, `pm revoke`              | `simctl privacy`                  | reset to ask, then `alert`     |
| launch environment           | no: args are intent extras           | yes                               | yes                            |
| dark mode, text, motion      | yes                                  | yes                               | `devicectl`                    |
| animations                   | yes                                  | no: use `reduce_motion`           | no                             |
| locale                       | per app, API 33+; whole device below | per app, changed; `app ""`: whole | per app, the tool's launches   |
| slow network, thermal state  | emulator; a phone's downloads, 13+   | no                                | Xcode's conditions             |
| biometrics                   | an emulator's fingerprint            | yes                               | no: `devicectl` simulates none |
| airplane, Wi-Fi, mobile data | yes, read back                       | no: it has the Mac's network      | no                             |
| keychain                     | no: Android has none                 | emptied, counted                  | no                             |
| fold pose                    | a foldable, API 31+, put back        | no: `simctl` has none             | no                             |
| incoming call, SMS           | emulator only                        | no: no telephony                  | no                             |
| battery level                | yes                                  | no: it only draws one             | no                             |
| proxy                        | yes, put back                        | follows the Mac's                 | no: its Wi-Fi settings         |

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

## Push notifications

`push` sends one to the app, by `type`, from fields (`title`, `body`, `image`, `data`) or from `payload`, the platform's own JSON: APNs' on iOS, an FCM message on Android. Given both, it refuses. A push is always the app's own: nothing shows a notification under any name but the app's, and where the app cannot be given one, `push` refuses, saying what it needs. With no type and nothing else it answers each type this device takes, the route it takes and the fields it takes there, with a template of the payload it would send, or why it cannot; its `data` holds the same as `types`, where a route by APNs or FCM names in `tokens` the kinds of token it goes by, which a person may type in a window. A `title` or `body` with no type goes as an `alert` where the device takes one, and the answer says so; where it takes none, and for `image`, `data` or `payload` alone with no type, it refuses, naming the types that go. A push is answered with the screen after it, as an action is.

| type          | Android emulator and phone                                                                                                                                               | simulator                                                                                    | iPhone                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| alert         | FCM's own message to the app's Firebase SDK, as below: in front its code gets it, else the SDK draws it; FCM, once set up; else no, saying what it needs                 | `simctl push`: the app's code gets it if the app is in front, else only on a tap             | APNs, once set up                                   |
| rich          | as an alert, with an image by a link                                                                                                                                     | APNs' sandbox, once set up; `simctl push` runs no Notification Service Extension             | APNs, once set up                                   |
| background    | FCM's own data message to the app's Firebase SDK, as below: `onMessageReceived` gets it wherever the app is; FCM, data alone, once set up; else no, saying what it needs | APNs' sandbox, once set up; `simctl` refuses a push with nothing to see                      | APNs, once set up                                   |
| live_activity | as a background push, for the app to make its own Live Update                                                                                                            | APNs' sandbox, once set up; `simctl push` makes a notification, which no Live Activity takes | APNs, once set up                                   |
| voip          | no: an iOS push                                                                                                                                                          | APNs' sandbox, once set up, for an app that declares VoIP; `simctl` takes none               | APNs, once set up, for an app known to declare VoIP |
| widgets       | no: an iOS push                                                                                                                                                          | APNs' sandbox, once set up, from iOS 26; `simctl` takes none                                 | APNs, once set up, from iOS 26                      |
| tapped        | the launcher activity, or `click_action`'s, with the data as extras                                                                                                      | no: `simctl` taps nothing                                                                    | no: only a person's tap                             |

`tapped` draws nothing. It is what [Firebase documents](https://firebase.google.com/docs/cloud-messaging/android/receive) for a push tapped while the app is in the background, "the data payload is delivered in the extras of the intent of your launcher Activity": the activity opens anew on top of the app's task, as Firebase's own tap opens it. A real iPhone takes a push only from Apple's servers, once a person has set APNs up as in [Push to a phone and a simulator, by Apple and Google](#push-to-a-phone-and-a-simulator-by-apple-and-google). Until then, `open_link` with the app's deep link reaches the code a push with that link would, or a simulator takes the push. Xcode 27.1's `devicectl` has no push of its own: `devicectl device notification post` posts a Darwin notification, by its name alone, as its help says, which is no push. Without a key, Apple's Push Notifications Console sends a push from a browser signed in to the team's account, to the token the app printed, as [Apple shows it](https://developer.apple.com/videos/play/wwdc2023/10025/): that was not tried here, and nothing here can drive it.

A type this device or the app's build cannot take is refused with why, and the hint names the types that still work there, such as `tapped`.

Run through the MCP server over stdio, by `device-tests/push.test.ts`. On an API 34 emulator `tapped` opened the fixture, whose screen showed the two keys it was given, and each other type to it was refused, as it has no Firebase Messaging, with no notification drawn by anyone. On an iPhone 17 Pro simulator with iOS 27.2 an alert from fields and one from APNs' own payload, with a badge, a sound and a category, reached the fixture's code with their keys, and `simctl` refused a background push: "Notification has no user visible content". The answer says what reached the app's code by where the app was at the push, read just before it: in front, the code gets it; in the background or not running it is only shown, and the code gets it when its banner is tapped. With the fixture in the background, an alert, and one with `content-available`, left its code with the push before, as it did when it was not running. An app no one allowed notifications shows none, and `simctl` fails, "Source is not authorized", yet an app in front still got the push in its code: the answer says so then, and refuses with how to allow them when the app is not in front.

A rich push is the app's Notification Service Extension's to change, and a simulator runs none for `simctl push`. Xcode 11.4's release notes say "The mutable-content key is not honored", and Xcode 14's that remote notifications "support more features (like Notification Service Extensions) than locally simulated notifications using .apns payload files or the simctl push command". Tried with Xcode 27.1 on an iOS 27.2 simulator: the fixture, built with an extension that `pluginkit` listed as installed, got a push with `mutable-content` in its own code unchanged, and no process of the extension started. Its log says why: `simctl` hands the notification center a request of its own making (`CoreSimulatorBridge` "Forwarding addRequest"), so apsd, which runs an extension, never sees the push.

A Live Activity's push reaches `liveactivitiesd` by its topic, the app's id with `.push-type.liveactivity`, and `simctl push` takes no topic but an app's. On the same simulator, given `dev.appdyno.fixture.push-type.liveactivity` it took that for an app and was refused, "Source is not authorized", and it sent an `event: start` payload to the fixture's own id as a plain notification. `liveactivitiesd`, `apsd` and `chronod`, the processes Apple names for these pushes, logged nothing of either. Apple tests them on a simulator through APNs' sandbox, `api.sandbox.push.apple.com`, from a Mac with Apple silicon or a T2 on macOS 13 or later, with the activity's own push token. So a rich push, a background push, a Live Activity's, a VoIP push and a widget's reach a simulator only from APNs' sandbox, with a key of the app's team: once a person has set one up, as below, `push` sends them there, and until then each refusal says so.

### FCM's own message on Android, with no project or key

An Android app with Firebase Messaging takes an alert, a rich push, a background push and a Live Activity's as FCM's own message, with no Firebase project and no key. `push` sends the broadcast Google Play services hands an app, `com.google.android.c2dm.intent.RECEIVE`, to the receiver the Firebase Messaging SDK declares, `com.google.firebase.iid.FirebaseInstanceIdReceiver`, with the extras the SDK reads, as its [source](https://github.com/firebase/firebase-android-sdk/tree/main/firebase-messaging) has them: the data as given, a notification under `gcm.n.`, a `google.message_id` new for each push, the priority, high unless FCM's own payload says `NORMAL`, and its collapse key. The receiver lets in only the system, root and the app itself, so `push` sends it by `run-as` on a debuggable build, as the app's own uid, or as root where adbd already runs as root; it never restarts adbd to make it so. A broadcast from the shell's own uid is skipped without a word. The receiver's result says it took the message: one that took nothing is refused, as a force-stopped app takes none, from FCM either. The SDK then does as it does for a message from Google: a data message goes to `onMessageReceived` wherever the app is, and starts the app when it is not running; a notification goes to `onMessageReceived` with its data when the app is in front, and else the SDK draws it under the app's name and icon, in its own channel, where a tap opens the app with the data, as [Firebase documents](https://firebase.google.com/docs/cloud-messaging/android/receive); no tap on one was tried here, and `tapped` opens the app the same way. The answer says when the app is not allowed notifications, as the SDK then draws nothing. With no type, `push` and a window's Push pane name the route each type takes for the app named, read from its build; the listing goes through the allow list as a push does. With FCM set up, these pushes go by Google's servers instead.

What it leaves untried: Google's servers carry nothing, so their delivery, Doze's deferral, a TTL or a collapse across sends and a token's validity are not tried, and `from` reads `appdyno`, so an app that checks it against its sender ID turns the message down. An image goes by a link, which the SDK fetches. A data key that is FCM's own name, `from`, `notification`, `message_type`, `collapse_key` or one that starts with `google` or `gcm`, is refused, as FCM refuses it. Where the app has no Firebase Messaging, the only way a push reaches an Android app's code, each of these is refused and the answer says so; where it is a release build on a phone whose adbd is not root, each is refused with what takes it: a debuggable build, or FCM set up with `appdyno push setup fcm`. A style such as Android's inbox, messaging or media is no push of its own: an app draws it from what its code was handed, so `background`, with the data that code reads, is the push for it.

Run through the MCP server over stdio, by `device-tests/push.test.ts`, with `android/push-fixture`, an app with Firebase Messaging 26.0.1 whose options are made up. On an API 34 emulator, whose adbd was not root, a background push with the app in front, a Live Activity's at the home screen and a background push after its process was killed reached `onMessageReceived` with their data, a value with a space and an apostrophe as given; an alert and a rich push with the app in front reached it with their title, body and image; an alert at the home screen was drawn by its SDK and reached no code; with notifications revoked, the answer said so. To the fixture, which has no Firebase Messaging, each of the four was refused with that reason, and the shell posted nothing. On a Samsung Galaxy A52 with Android 14, not rooted, the data pushes in front, at home and after a kill reached it the same way. By hand, with a test app of the same kind on Firebase Messaging 24.1.0, the broadcast sent as root on that emulator reached `onMessageReceived`, and one from the shell's uid reached nothing there or on the Samsung; `push`'s own use of root is held by unit tests alone, as no device here runs adbd as root by itself.

### Push to a phone and a simulator, by Apple and Google

What only Apple's or Google's servers deliver goes by them once a person has set up their credentials, at a terminal of this Mac: `appdyno push setup apns` asks for the team's APNs key, the `.p8` file, its key ID, the team ID, and whether a distribution build may take pushes from production; `appdyno push setup fcm` asks for a Firebase service account's JSON file. Each is kept in the state folder, `push/apns.json` or `push/fcm.json`, readable by this user alone (mode 0600, in a folder of mode 0700), and `--forget` deletes it. Nothing an MCP client sends sets, reads or deletes them: it is told only whether one is set. Neither command runs without a terminal, and neither says back a key, an id or a token.

With APNs set up, `push` sends a simulator's rich, background, Live Activity, VoIP and widget pushes, and each of these and an alert to an iPhone on its cable, by APNs, behind these:

- **Hosts.** `api.sandbox.push.apple.com` and `api.push.apple.com`, written in the code, and no other; a simulator takes only the sandbox's. A request goes by node's `http2`, with an ES256 provider token signed by node's `crypto`, kept 40 minutes, as Apple refuses one made more often than every 20 and one older than 60.
- **Token.** Only one this tool read from the app's own lines in this session, in the device's own log, or one a person typed in the window; nothing an MCP client sends is one. On a simulator the lines are `log show`'s, from the start of the session, of the app's process alone. On an iPhone this tool reads no running app's log, so a push that has no token relaunches the app with `devicectl device process launch --console`, its `os_log` and `NSLog` in that console as under Xcode, and reads what it prints for up to 15 s: only then, and the answer says the app was relaunched and lost its state. The console stays followed for the session, for a token printed later, and is let go by SIGKILL, which devicectl cannot hand on to the app as it does a signal it catches. Reading the phone's own log by its developer services would spare the relaunch, and is a later improvement. A token is hex, 32 bytes or more, in a line that names a token where any line does, as an app's log has other hex as long, and the words of its line say which it is: a line naming a push to start, an activity, VoIP (or PushKit) or a widget gives that token, any other the device token. The app prints it with `NSLog` or `os_log`; a push with none says so, and how. A token Apple calls bad or no longer registered is dropped, and the next push reads the app's lines again. No answer, error or log says a token, a key or a provider token: a token is named by its kind and the time it was read.
- **App.** The topic is the app named, installed on that device, and the token is from that app. On an iPhone, the build's signature and Info.plist are read only from a build this tool installed, by `app install` or `app build_and_run`: nothing on the phone gives them.
- **Environment.** The sandbox, but for an app on an iPhone known to be a distribution build, by the signature of a build this tool installed, with production turned on at setup: then production. An app whose signing cannot be read here goes to the sandbox, never production, and a push refused on one host never goes to the other: on `BadDeviceToken` the answer says the token may be for the other environment, and what a person can do. A sandbox push reaches no production build, so nothing is lost by it.
- **Payload.** 4 KB at most, 5 for VoIP, with `aps` an object. Each type has APNs' push type, topic suffix and priority: `alert` and `rich` as `alert`, priority 10; `background` at 5; `live_activity` as `liveactivity` on `.push-type.liveactivity`; `voip` on `.voip`, only for an app known to declare VoIP; `widgets` on `.push-type.widgets`, from iOS 26. `apns-expiration` is 0: a push is delivered now or never. A Live Activity's payload is ActivityKit's: `event` start, update or end, `content-state` as the app's `ContentState`, and to start one `attributes-type`, `attributes` and an alert, with `timestamp` filled in when it is not given; start goes by the push-to-start token, update and end by the activity's.
- **Rate.** At most 10 a minute to a device, one push a call.
- **Answers.** Apple's reason, with words for a person: `BadDeviceToken`, `TopicDisallowed`, `ExpiredProviderToken` and each other Apple lists.

With FCM set up, `push` sends an Android device's alert, rich, background and Live Activity pushes by FCM: an alert and a rich push as a notification, with `image`, a background push and a Live Activity's as data alone, for the app's own code (a Live Update is the app's own notification, built from a data message), at high priority with a TTL of 0, so delivered now or never, unless the payload, FCM's own `message`, says otherwise. `tapped` stays as above. Behind the same kind of controls:

- **Host.** `fcm.googleapis.com`, written in the code, and no other: the service account signs its own RS256 token for FCM's audience, as Google's "service account authorization without OAuth" describes, so no token is fetched from another host. Whether FCM's HTTP v1 API takes such a token is unverified until a live send; if it does not, the token comes from Google's token endpoint instead, a second host written in the code.
- **Token.** A registration token the app printed in its own logcat in this session, of its process running now (by `getToken` or `onNewToken`), or one a person typed in the window; never one an MCP client sends. One FCM calls no longer valid is dropped, and the next push reads the app's log again.
- **App.** Installed on that device, and the payload names no token, topic or condition of its own: a message reaches the app on this device alone.
- **Payload.** 4 KB at most, its data strings alone; 10 a minute to a device; FCM's error codes in words, none naming a key or a token.

FCM's request is tested against the one Firebase documents for a message to one device, recorded here, and the routes and the reading of an app's logcat with a fake device; no test reaches Google. On an API 34 emulator, by `device-tests/push.test.ts` with an account made up in a state folder of the suite's own, the types FCM takes were listed with their routes, and each push was refused before anything left this Mac: no token from the fixture, which prints none, a payload naming a topic, an app not installed. No push by FCM has been sent from here yet: it waits for a project's account.

Request shapes are tested against the requests recorded for each type, and the sending against a local HTTP/2 server; no test reaches Apple. On an iPhone 17 Pro simulator with iOS 27.2, by `device-tests/push.test.ts` with a key made up in a state folder of the suite's own, the types APNs takes were listed with their routes, and each push was refused before anything left this Mac: no token from the fixture, which prints none, a Live Activity's payload with no content state, VoIP the fixture does not declare, an app not installed. No push by APNs has been sent from here yet, and no iPhone run: they wait for a phone and a team's key.

`open_link` `links` with an app's id lists the links it opens, read from the installed app: on a simulator its URL schemes and the domains its signature names for universal links, on Android each filter that views a link, as `scheme://host/path`, and each App Link domain with Android's verification state. Its `data.links` holds the same, each with its `url`, its `kind` (`scheme`, `domain` or `filter`) and a domain's `state` where Android verifies it, for a client to offer or go through. Run on both: the fixture's scheme on the simulator, and on the emulator its scheme, its `https://example.com/order*` App Link, and that domain's state, `none` just after the install and a number of the verifier's own once it had tried. An iPhone's installed app is not read.

`open_link` says `opened` only when no system alert stands over the screen the link left. A simulator asks "Open in …?" before an app's scheme first opens it, and nothing opens until that is answered: the answer then says `sent`, with the alert's words and buttons, and to answer it with `alert`. With `read: none` nothing is read, and it says `opened`. Run on an iPhone 17 Pro simulator with iOS 27.2, just erased, from a window's Links pane. Every answer that reads the screen names a system alert over it so, an Android app's crash dialog ("keeps stopping") among them, with `alert` to answer it.

`open_link` `settings` opens Settings, an app of its own, where a person can go anywhere: under `--allow-apps` it opens it, at a page or at an app's, only when Settings' own id is in the list, `com.apple.Preferences` on iOS and `com.android.settings` on Android, and else refuses with `POLICY_DENIED`, saying how a person adds it. A page this device lacks is refused as a wrong word, with this device's pages.

## Radios, biometrics and the keychain

A radio is done when the device reads as asked, within 10 s: Wi-Fi by the state of the radio, because its setting changes first, and airplane mode and mobile data by the user's switch, so that a restore during airplane mode brings back what they chose. A device that does not change is refused with what it said. A device reached over its network (`adb connect`, wireless debugging) refuses `wifi off` and `airplane on`, because nothing could reach it to put them back. On an emulator, by `device-tests/settings.test.ts`, data off or airplane mode on leaves the device with no way to this Mac, and `restore` brings it back. On a Xiaomi with Android 16 all three took effect and read back in 234 to 1,127 ms, its saved networks untouched; it rejoined its Wi-Fi a few seconds after the switch read on. A switch says nothing of a connection.

`biometric` on an emulator touches its sensor and is done only when the fingerprint service counted the touch: `match`, `nomatch`, each refused when no app is asking. On an emulator with no fingerprint `enroll` takes one by itself: it sets the screen lock to PIN 1234, written down first, goes through Settings' enrolment by its kinds of control and not their words (the PIN field, then the lowest and rightmost button), and touches the sensor until the service holds one. `restore` takes the PIN off, and Android deletes the fingerprints with it. An emulator with a lock of its own is refused, as its PIN cannot be typed, and so is a server started with `--no-home`, since Settings leaves the app. A real phone is refused: its sensor takes only a person's finger, and its lock is its owner's. Run on an API 34 emulator, where the whole check, enrolment and the fixture's prompt answered both ways, took 17 s. A simulator's `enroll` turns Face ID or Touch ID on. An app's prompt on Android is the system's and holds the focus: it reads as elements like any screen, though a screenshot of it is blank, because it is a secure window.

On an iPhone `devicectl device simulate biometrics` answers `Device does not support any biometric simulation, nothing to do` and exits 0, so it is not used: an answer would say done for a touch that never happened. That is one iPhone with no face enrolled, and no phone has been seen to take one.

`keychain` `reset` empties a simulator's keychain, and says how many items apps held, from the store's own rows, which also prove it empty after. The system's own rows stay and are not counted. It is one-shot: nothing brings them back.

## Two that were tried

A simulator's animations stay as they are, as no way to slow them was found. UIKit's `UIAnimationDragCoefficient` set to 10, in `com.apple.UIKit`, in the global domain or as a launch argument, left the fixture's 300 ms slide over within 0.7 s on an iPhone 17 Pro simulator with iOS 27.2, as it was with none. An iPhone Duo simulator with iOS 27.1 shows its app on the outer screen. With that screen powered off by `simctl io screenConfig`, Settings started again showed nothing on the inner one, so a fold of it is not that either.

## An iPhone's own conditions, data and permissions

`network` and `thermal` on an iPhone are the phone's own conditions, as Xcode's Devices window sets them, through its instruments: `network` `slow` is the first EDGE profile the phone lists, or a profile by name, and `full` none; `thermal` `fair`, `serious` or `critical`, and `nominal` none. One holds at a time. The phone keeps one after the process that set it is gone: a session killed by SIGKILL left `SlowNetworkEdgeBad` on, and the next session's start found it written down and turned it off. A thermal profile ramps for seconds each way, and the phone answers nothing meanwhile, so one is done when the phone reads it so. These go through the phone stream, and with its folder gone are refused with why.

`app clear` on an iPhone empties the app's data container, as `replace_data` with an empty folder does: development-signed apps only. iOS has no grant: `grant` and `revoke` reset the app's answer, so it asks again, and `alert` answers. `locale` with an app holds it in a language for every launch this tool makes, as on a simulator.

Run on an iPhone 13 Pro Max over its cable: the fixture's data went from 4 files to none; its location went from Allowed to "Not asked", it asked again, and `alert deny` made it "Denied"; `network slow` read back `SlowNetworkEdgeBad` and `full` none; `thermal serious` read back `ThermalSerious` and `nominal` none; the fixture showed `tr-TR`. `network slow` on a Samsung with One UI set the cap to 29,600 and `restore` deleted it, as the key had none before.

## A slow network

`network` `slow` on an emulator goes by its console: an EDGE speed both ways and a delay of 40 to 100 ms. A phone from Android 13 has only Android's own cap, `ingress_rate_limit_bytes_per_second`: `slow` caps what it downloads at 30 kB/s, an EDGE network's download, and a number caps it at that many bytes a second on a phone or an emulator. It adds no delay and leaves uploads at full speed, and the answer says so. The cap is a setting the device keeps, so the old one is written down and `restore` deletes it. On an API 34 emulator a megabyte from this Mac took 778 ms, 11.2 s under a cap of 100,000, and the cap was gone after `restore`. It was run on a Samsung too: see the end of [An iPhone's own conditions, data and permissions](#an-iphones-own-conditions-data-and-permissions).

## A fold

`fold` on Android asks `cmd device_state` for the state of that name, `open`, `closed` or another the device lists such as `half_opened`, by its id there, which differs by device, and is done when the device is in it. The request holds until it is reset, whatever the hinge does and whatever becomes of this tool, so it is a condition: `restore` resets it, and `default (now open)` is no request. It is the same on an emulator and a phone, from API 31. Run on a 7.6" foldable emulator with API 34, where the device read `CLOSED` from the request and nothing after `restore`. No real foldable has been run.

## Languages

`locale` on Android is an app's own from API 33, given the app or with one selected, by `cmd locale`. Below API 33, where apps have none, it is the whole device's, set by the agent as Settings sets it: Android keeps it in `persist.sys.locale`, so the old value is written down first and put back. A device that had never chosen one keeps the old language as chosen after. Run on an API 30 emulator, where Settings read Turkish after `tr-TR` and English after `restore`.

On a simulator, with an app given or selected, `locale` holds that app in a language for every launch this tool makes, by `-AppleLanguages` and `-AppleLocale`, kept on this Mac: nothing changes on the simulator. This is a change: it used to set the whole simulator whatever the app. What no longer changes with an app selected is the system's own text, such as permission prompts and Settings, and a launch this tool does not make: an icon tap, a link or a push that starts the app, the app starting itself again. `app ""` sets the whole simulator, as before, and the answer names which it took. An app that runs is started again in it, and again at `restore`. XCTest's launch measure is given the same arguments, which has not been checked. `launch_app` `language` is that launch's alone, on a simulator and an iPhone: the next launch is in the language held, else the system's. It held until `restore` for a while, as on Android, and a plain launch after it was still in it. One app's language is held at a time: another is refused until `restore`. Run on an iPhone 17 Pro simulator with iOS 27.2, where Settings held in `tr-TR` read Ayarlar while the simulator's own `AppleLocale` stayed as it was, and read Settings again after `restore`.

## Putting a device back

Changing a condition writes the old value down first, with the process that changed it. It goes back
when that session ends, or with `device_setting` name `restore`, which leaves alone what another live
process changed and says so. A session that died leaves the file, and the next one on that device puts
back only what a dead process left, and says so; what cannot be put back is reported, and a file that
cannot be read is kept beside it as `.bad`. A command line is one process per command, so its changes
stay until `restore`, whatever sessions come and go. A change's answer says which of the two it is.

A recording, a network capture, an open report and a flow recording go the same way. The next session
ends what a dead process left and says so (a flow recording stops with its steps kept), leaves what a
live one runs, and leaves what a command line started for its next command.

## Sharing a device

A process that drives a device holds it: a file in the state directory with its pid and start time.
A dead owner's claim is free. A second process is refused with the owner's pid and name unless it asks
to share: `use_device` with `share: true`, `--share` on either command line, or `APPDYNO_SHARE=1`.
`list_devices` shows who holds what. There is no daemon.

With no device selected and more than one this server may drive, a call that needs one is refused, naming each by serial, kind and model, and `use_device` picks one. `list_devices` gives each device's `kind`: `phone`, `simulator` or `emulator`; an emulator has no `link`, as no cable joins it.

## Starting a simulator or emulator

`simulator` boots and shuts down simulators and emulators, on request only. With no name, shutdown
touches only what this tool started. `APPDYNO_EMULATOR_ARGS` replaces the emulator's default flags, and `APPDYNO_EMULATOR_FIRST_PORT` is where the search for a free port starts.

`--allow-devices` takes a simulator or emulator here by its id, its serial or its name, as `name` does, so one allowed for `shutdown` is allowed for the `boot` after it. A stopped emulator has no serial of its own: it answers to the one it ran as when this tool shut it down, and comes back on that port while it is free. A `shutdown` that the `boot` after it would refuse is refused first, and the device stays on.

## What an action answers

An action answers with the settled screen. `settled` means the screen was still for the window.
`changed` means the screen differs from before the action, in layout or text; it does not say the action
caused it. If nothing changed the answer says "no change seen in N ms; if a slow reaction is expected,
use wait_for". Every answer's `structuredContent` holds its whole text as `text`, beside the summary, as a client may show either part alone. A failed call is an `isError` answer whose text starts with its `code` and ends with its `hint`, both in `structuredContent` too, and a failed action says whether its touch went out (`dispatched`). An action reads a screen nobody has seen before it touches it, and a locked phone refuses by name (`DEVICE_LOCKED`). Cancelling a request
reaches the device, and long operations report progress. An answer warns that the app is not in front when it left by itself, not after a key, a Settings page, another app's launch or a stop that left it on purpose.

## Logs and crashes

`logs` reads logcat for the app on Android and the simulator log on a simulator. For an iPhone,
`devicectl` cannot read the log of a running app, and the answer says so. With no `since` it reads from when the last action began, as what a push or a tap sets off is logged while it runs. `crashes` collects the
system's crash records for the app (Android exit info and dropbox, the simulator's DiagnosticReports,
an iPhone's system crash logs) as a bounded summary and a file path. Every simulator's reports are in one folder, so a simulator's are only those that name it, by the app's path or by the coalition its process ran in, which a system app's has too; the note says how many were left out and why. Secrets are redacted. On Android it also counts every exit the system keeps, by its reason in full, because an app that left by itself or was killed did not crash: `SIGNALED status 9`, `USER REQUESTED KILL BACKGROUND`, `EXIT_SELF status 3`.

With `symbols`, it names the stack of a release build. On iOS that is a `.dSYM`, or a folder holding them such as the build's products, and an image is named with `atos` only from the dSYM whose UUID, by `dwarfdump`, is the crashed image's: any other would name the wrong functions and look right, so a report with none says which UUID it wanted and which the folder has. On Android it is a folder of libraries that keep their symbols, such as the `lib` folder of a build (`merged_native_libs/.../out/lib`, the ABI found from the tombstone), read by `ndk-stack` from the newest NDK in the SDK, which leaves a library of another build unread, and the answer says which ids differ. On an iPhone 13 Pro Max a stripped Release build's crash read a bare `Fixture` frame, then `Fixture fixtureCrash(_:)` from its dSYM. A tombstone comes a moment after the crash, and a Java crash has none. Android keeps few: on API 34 the first 6 native crashes of an app in some minutes left one and the next left none, and the answer says so, which a loop of crashing runs will meet. The whole stack is left in the file `named` gives. Optimized Swift may give a function with no line.

## Reaching a phone

- Android: turn on USB debugging, connect, and check `adb devices`. A Xiaomi asks on its screen before each new install over USB and
  says no by itself after 10 s: `app install` wakes the phone and taps that prompt's yes, but only during an install it started itself; the answer and `report`
  say so (`--no-install-consent` leaves it to you). Play Protect's prompt to send the app to Google is always answered no: a private build stays
  here. A Play Protect warning is left alone, quoted, unless the server runs with `--accept-install-warnings`. See [the protocol](protocol.md),
  "A phone's install prompts", for what was seen on which phone. A Samsung with One UI has no prompt of its own, and Play Protect's come only with "Verify apps over USB" on. What else differs between the two is in [the performance reference](perf.md), "One UI against HyperOS".
- iPhone: turn on developer mode. A phone needs a development signing identity and a provisioning profile that names it. An
  installed profile for a wildcard app id, with its identity in the unlocked login keychain, is found by itself. To choose another,
  set `APPDYNO_IOS_PROFILE=<profile.mobileprovision>`, `APPDYNO_IOS_KEYCHAIN=<keychain-db>` and
  `APPDYNO_IOS_KEYCHAIN_PASSWORD=<password>`. Run `appdyno doctor` to see what it found. The phone is
  reached over USB. Only a window goes by the network. A phone's clipboard goes by Xcode's `devicectl`, with no runner and nothing asked on the phone,
  and a simulator's is read from the Mac. Text goes in as keys on iOS: a paste brings up iOS's "Allow Paste" alert.
