# Changelog

## Unreleased

- `Appdyno.app` and a disk image, from `scripts/build-app.mjs` and from `release.yml`. It carries its own Node, the Android agent and a prebuilt viewer, and runs on a Mac with no Node and no developer tools, where the Mac's own dialog offering to install them is never raised. A double click opens the hub, its devices are in the menu bar, and it is in the Dock only while a window is open. With no Developer ID it signs ad hoc; `APPDYNO_SIGN_IDENTITY` and the notary's variables sign and notarize.
- `adb` is not in the app: Google's terms forbid passing it on, and it holds LGPL code. `appdyno tools install adb --accept-license` downloads Google's platform-tools, checked against a pinned hash.
- `appdyno path` puts the app's command on every shell's PATH, and `appdyno install` gives MCP clients the app's own path. A moved app is fixed on the next open: its entries and its link follow, and all else in them stays.
- `appdyno update` and `doctor` know the app. It updates itself on a signed appcast, verified with a key it was built with, and changes nothing until the download, its signature, its signer and its version all hold. Nothing checks in the background.
- A Homebrew cask, `appdyno.rb`, made for each release.
- A baseline or a comparison that cannot judge never looks done: `perf baseline` exits 1 until it holds the runs a comparison needs, saying how many it has and how many are missing, and `perf compare`, `perf why` and the job in `docs/perf-gate.yml` fail on `few-samples`, which says the gate could not judge.
- A window keeps its pictures through a decoder's stall on a busy Mac: pictures already decoding were thrown away with the frame that did not fit, and a stream's first burst could leave a window black until the next key frame.
- The library is one function, `connect`, shown in the README by an example a test runs: every tool by name, typed from its schema, and `replay`. The 347 names it exported, the README's `flowsFor(ctx)` that was not among them, and the need for zod's types are gone.
- `bench` says it is for an Android device, in its help and to an iOS one, where it spoke of adb.
- `perf baseline` counts a run once, takes `--last`, and says how many runs it holds of the 3 a comparison needs. The README's lines left one run in it, so that a regression could only be `few-samples`.
- `perf compare --device-class` with no runs of that class says which classes have them.
- `scroll_to` and `swipe` `exact` move a row across a page: the finger went through the page's middle, whatever x,y said, and a banner changing by itself was called the list moving.
- A first read of a simulator with no app named starts no runner: it asked for the runner where nothing was named, and a new simulator's home screen took a build to read.
- A touch on a turned simulator lands where the read says: it takes the path a window's touch takes, turned by what the app in front says of itself, and it left that path for one that missed and said tapped. A process started after the turn knows it too. The runner's tap on a turned screen is XCUI's own.
- `mirror stats` says a dash where nothing was counted, not -1, and a status has no such number.
- A journey's `frames_p95_ms` is of the step's own frames, as its `frames_worst_ms` is: it could pass the worst, from gfxinfo's buckets. A baseline kept before this moves.
- `mirror --record` makes its movie as a window's Record does, by the device's own recorder where the picture is no stream, so that an emulator and a simulator get one. A movie that does not start, or ends with nothing, fails the run with exit 1.
- `mcp --http`: a second client is refused at its call, by who is calling: one that connected before the first tool call was served on the same context. Each client gets its name back as its session id, and a call with none is refused while another holds the server. A refused client no longer keeps the holder's time running.
- `press_key` `app_switch` on a simulator opens the switcher, by the input a window's control sends: the drag it made showed none, and it said pressed.
- A failed action says `dispatched: "unknown"` once its touch has left for the device: the read after a touch can fail too, and `false` told a client to press again. An app in front that does not answer says so, in the words of a screen that is off.
- `restore` and the end of a session bring Android's Wi-Fi back: its old value was read while the radio came back from airplane mode, and written down as off.
- `press_key` `power` and `lock` press with no look at the screen first: on a dark Android screen the look woke it, and the key put it back to sleep.
- A `wait_for` that ran out answers `TIMEOUT` and an `alert` answer with no alert `NOT_FOUND`, both refusals, and exit 1 on the command line. In a flow an `alert` step with no alert still passes, as a prompt comes once.
- `audit` `types` is kept to on Android. On iOS a type the platform audit has not is refused by name: none of its types it knew meant every one.
- `doctor --serial` asks the driver that would open the device, so that a booted simulator is no longer "not connected", and a missing runner's fix is `appdyno ios build`.
- `--help` answers on every command, `--version` prints the version, a flag with a default is not called required, and a command's line is its first sentence, not its first colon.
- The package holds the README, and `THIRD_PARTY_NOTICES` holds the notice of each package bundled in it.
- A point past the edge of the screen is refused, with no touch sent: `tap`, `swipe`, `type_text` and `gesture`. It was called tapped.
- `screenshot --out a.png` writes the format its name says, as `file` does, and answers `saved`.
- `perf_snapshot` gives no percentile on no frames: gfxinfo's was the top bucket of an empty histogram.
- Arguments a tool does not take answer `isError` with `code: INVALID_ARGUMENT`, a hint and `dispatched: false`. `type_text` says it takes up to 500 characters.
- `perf_launch` `compile` is refused on iOS, where it was ignored.
- A click on a window's toolbar does what it says, the first one included: on macOS 27 no button of it did anything, as a button answers `representedObject` with nil, and a window not yet in use took a first click for itself.
- `appdyno mirror`: **Record Flow** writes what a person does on a window as a flow, by selector: clicks, double clicks, long presses, swipes, typing, keys, Home and Back, and Launch and Quit from the Apps pane. A password is written as a secret's name, never as its text, typed on the Mac or on the device's own keyboard. What has no step is said at that moment and written as `unrecorded`, and a place nothing names is marked as coordinates. Swipes that reached what is clicked next become `scroll_to`. The recording is the one `flow` keeps, so an agent's `flow start` takes a person's clicks too.
- The Inspector's **Flow** pane: the steps as they are written, and what is under the pointer, with its role, words, ref, id, contrast and what a click there would write. A click can copy its selector, or add an assertion, in place of touching the device.
- `scroll_to` no longer runs past a row: on a simulator a list went on coasting from each stroke, and could reach its end with the row behind it. Each stroke now slows to a stop and takes 0.7 s, from 0.5 s. One stroke that moves nothing no longer reads as the list's end: it may land as a screen still arrives, and two in a row are asked for.
- `--quality auto` stops at the smallest picture a person can read, 1.12 pixels for each dp of the screen, and says the device cannot keep up, and it grows again when a device has room. It no longer goes down to 360x800.
- `report` `timeline`, `appdyno timeline`: a journey's video, touches, steps, frames, requests, traffic, log and memory on one clock, in one HTML file that loads nothing and can be sent to someone. Click a slow frame and the video goes to that moment, with the requests and log lines around it. The offset between the device's clock and the Mac's is measured at both ends, the page says how far apart two rows can be, and a row a device cannot give stands empty with its reason. A URL keeps no query and no body is held, unless a person passes `--full-urls`. See `docs/perf.md`.
- `report` `flight`, `appdyno flight`: a flight recorder, off until a person turns it on. It keeps the last 30 s of an app, `--flight-seconds` from 20 to 120, and saves them as a timeline on a crash or a stall. Saved pages go by the rules of kept traces. What it costs is in `docs/perf.md`.
- `perf_trace` on Android: `stalls.worst_ms` sees a main thread held while the render thread draws, which left no long frame: a 1500 ms hold read 38 ms. The number comes from Choreographer's `Skipped frames` line in the app's log, and the answer has `heldMs` and says so. A Samsung with One UI writes no such line, so there a hold still shows nowhere.
- An agent's `ping` says the device's time, and is answered past the queue.
- A timed log query: `logs` of a platform can say each line's place on the device's clock, and a process's lines can be read after it has gone.
- A window's rotate says when the app in front does not turn, as a launcher may not, and leaves no turn asked for.
- Two devices at once: **Open Beside…** in the hub or `appdyno mirror --device A --device B --pair` opens two windows side by side. A touch goes to the same thing on both, wherever it stands on each, each window says where it went and turns red where it failed, and one flow runs on each with their numbers compared.
- **Journey…** in a window's Performance pane measures a flow, kept with every other run.
- A window's colour holds when it is not in front: it was the glass's tint, which glass gives up. Its words stay on one line.
- A measure on an iPhone no longer ends in a crash of Xcode's trace tool: the tool dies now and then as it loads a trace, and the read is made again.
- A person's touch reaches the app on a dimmed screen: on a Xiaomi the touch that brightened it was lost, with a tap reported.
- `--quality auto` on a phone takes the largest size that keeps up with a person, by what its encoder takes on motion, and starts the next stream there. `high` and `standard` keep the display's size.
- Reads of the window dump take the phone's own display: under a mirror they read its virtual display, with no focus and no lock.
- An iPhone's numbers each second for a live panel, by its own instruments with no runner and no `xctrace`: frames, and the app's CPU, memory and threads. Nothing runs until a panel asks, as reading takes about 6 % of a phone core. Frames count the display, not the app, and a mirror keeps them near 20 on a still screen.
- `appdyno perf why`, `perf_compare` `action: why`: on a regression the gate finds the cause by itself, on the same device, build and journey, and writes one answer: what got worse, how sure it is, against which baseline and run, and the likeliest cause with what shows it: a function by the diff of two profiles, a phase of a start, a frame's cause or a hang's. A cause is named only with the evidence that shows it; otherwise the answer says what is missing. Only a regression is looked at, so noise touches no device, and what a look reads never becomes a run. `perf_compare` is no longer marked read-only, as this replays a flow and restarts the app.
- `appdyno perf reference`, `perf_compare` `action: reference`: the other side of a function or phase diff, taken on the baseline's build and kept beside the baseline, as only one build is installed once a regression is there.
- `appdyno perf comment --out file`: the gate's newest answers as Markdown in a file, with no device. Nothing is posted: `docs/perf-gate.yml` is a job to copy, which posts the file with the repository's own token.
- The gate's comparisons keep a modelled number and one timed through the host marked, in every format.
- `clipboard` works on an iPhone, by Xcode's `devicectl`, with no runner and nothing asked on the phone.
- `screenshot` keeps to its size on an iPhone: the phone's own service has one size, and it gave the whole screen whatever was asked.
- Notification Center on an iPhone reads as what it is: it has the lock screen's date, and a read took it for the lock screen and pressed home.
- `app` `install` takes an `.ipa`, and says when a build is for another kind of device than this one, before trying it.
- `simulator` `create`: a new iOS simulator of a model, on the newest runtime that runs it, started, selected for the calls that follow, and counted among those this tool started. An Android emulator refuses, naming what makes one.
- `screenshot` `file`: the whole picture, `.png` or `.jpg`, or into a folder under a new name. What is there stays unless `overwrite`.
- `launch_app` takes an app by its name as well as its id, in any case and with or without accents. A name that no app has, or that several have, refuses, and the second says their ids. `app` `list` gives names on Android too.
- `launch_app` `language`: restarts the app in that language, for that launch on iOS, and on Android as the app's own language, put back with the other conditions.
- `press_key` takes `mute` and `siri`: on Android the media mute and the assistant, on an iPhone simulator the Action button and the side button held. On an iPhone `mute` needs an Action button, doing what it is set to, and `siri` refuses and names `appdyno mirror`.
- `screenshot` `points`: an image where 1 pixel is 1 tap unit, with no scale to apply. `width`: an image that wide in the answer, up to the screen's own.
- `set_location` `clear: true` ends a fixed position, on every kind of device.
- `gesture` `drag` takes `holdMs`: a press before it moves, which lifts a list row or an icon.
- `device_setting` takes `increase_contrast` and `reduce_transparency`, read back and put back at the end. On Android the first is high contrast text, and the second refuses: it has no such switch. Off on Android takes the key away, as a device that never had it left it.
- `set_orientation` takes `landscape_left`, `landscape_right` and `upside_down`, where `landscape` was. An iPhone with Face ID does not turn upside down: the answer says no change was seen.
- `steps` takes any tool but `steps` and `flow`, 30 steps, and answers with what each step answered, images in order. A touch reads the screen with `read` on its step, or last; an image asked for at a step is given, changed or not.
- A Face ID, fingerprint or passcode prompt is said in the answer of the call that met it, on Android by the system prompt's own ids in any language, on iOS from the home screen app's words, which `screen`, `screenshot`, a launch and any action that changed nothing look at. A first sheet can take 3 to 5 s, after the action's answer: the next read says it. Android's permission controller pages no longer read as wanting a person for mentioning a password.
- A screen with no word in its tree (a game, a canvas, anything drawn) is read from its picture, by the Mac's own Vision and nothing on the device: its accurate level if it answers within 3 s, which takes any language, else its fast level, whose letters are those of English, French, Italian, German, Spanish and Portuguese, and the answer says so. A late accurate scan goes on in its own process, one at a time and for 10 minutes at most, and leaves its words for the next look at that picture, as the system's Neural Engine compiler can take minutes and a kill throws that away. They are a person's screen: in a file for this user alone, gone once read and after 5 minutes anyway: its words get refs, and `find`, `tap`, `wait_for` and `assert` take them. The answer says they came from the picture, and that their places are near. A screen with any word of its own is read as ever, and takes no picture.
- `swipe` `exact`: the content moves `distance` and stops, in several strokes if long, each slowing to a stop before it lifts and measured on what the reads share. The answer says what was measured, and where the list ended, which is no failure. A screen that shares nothing between strokes refuses by name.
- `open_link` `settings`: Settings at a page, 39 by name, each opened on a device before it was listed, or at an app's own, by `am start` on Android, by `devicectl` on an iPhone, and a link through a small helper with the entitlement it needs on a simulator. A page a device has not got refuses by name. Off when the server turned home off.
- `press_key` opens `control_center`, `notification_center` and `spotlight` by name, and reads what they show: on a simulator by the drag a window's control sends, on an iPhone by the runner's drag and the keyboard's shortcut, on Android as Quick Settings, the shade and the system's search. `home` closes them and the app is read again. Off when the server turned home off.
- `press_key` takes `escape`, `space`, the arrows, and a letter or digit, with what is held during it (`command+a`, `shift+arrow_left`), and `count`, with one settle after the last press. On Android `command` is Ctrl. A server with home off refuses the shortcuts that leave the app as well.
- `list_devices` says what blocks each device, with the fix, in the words `mirror` uses: a lock behind a credential, a phone that does not trust this Mac, Developer Mode off, an OS too old for the agent. It only reads.
- A mirror on a phone runs on its hardware encoder where it was refused for a key that is a decoder's: on a Samsung's `OMX.qcom` encoders every step of the ladder failed down to software, and its 90 Hz panel now gets 89 frames/s.
- Android reads of the window dump skip its last ANR section: after any ANR they read a dead window's focus and a stale lock, until the next one.
- `tap` on plain text settles where a read outlasts the quiet window with no load: on a Samsung each such tap waited out its 3 s.
- A system window with no focus is no alert, and a strip at a side of the display is no screen: a Samsung's edge panel handle was both, on every screen.
- `record` joins a segment of one frame, as a near-still screen gives.
- A device's load of three zeros reads as not known, and the thermal status is read wherever the dump has it, which on a phone it was not.

- `inspector`: an iPhone with no signing identity lists what is on its screen, by its words and ids, and presses it by name, through the phone's own accessibility service, with nothing installed.
- `appdyno mirror`: a window with the device in a frame drawn in code, by model, with buttons that press, off by a setting. It stands on a backdrop of its own picture's colours, with its status, controls and Inspector on Liquid Glass; before macOS 26 a material stands in.
- A window's controls: Home, App Switcher, Lock, volume, Siri, Control Center, Notifications, Spotlight, rotation, screenshot, recording and zoom, in one table for its bar and menus, each kind of device showing only what it has. The Inspector has Stats, Activity and Apps, which lists, launches, quits and removes.
- A person's gestures: a right click is a long press, a pinch two fingers, a drag from the bezel an edge gesture, and text goes through the system's own input, so that dead keys and held accents work. ⌘V pastes up to 4,096 characters.
- `--behind` keeps a window off every screen, and it can write itself to a PNG as the window server draws it. `scripts/mirror-shots.mjs` does so for each state, in light and dark.
- `LiveMetrics`: a port for a device's numbers each second, in one `perf` message. A measure a device cannot give stays out with its reason, and is never a 0.
- A window's live numbers (⌥⌘P): frame rate, jank, frozen frames, CPU, memory and network beside the device, each with its last minute, a state in words, and the reason where a device has none. Nothing is read until they are open.
- The dashboard and the report share one look; rows no device has said anything of fold into a line, trends stand side by side, and a report's steps are cards.
- `appdyno hub`: every device of this Mac in one window, to start, stop, make, and open a window on.
- A window's Performance pane: readings over ten minutes, a real launch or scroll measure of the app in front by the tools an agent calls, its result, and the dashboard a click away.
- A simulator says what is in front with no runner, and the home screen can be measured: it read as not running.

- `app` `build_and_run`: builds an Xcode scheme or a Gradle variant for the device, with progress and what the build said was wrong, installs it and launches it. Off under an app allowlist, as a project's build runs its own scripts.
- `app` `download_data` and `replace_data`: an app's data into a new or empty folder and back, by its container on a simulator, `devicectl` on an iPhone and `run-as` on Android. A replace takes away what the folder does not hold, and on Android goes only once the app has read the new data.
- `perf_launch` on an iPhone refuses a launch that shows no screen within 20 s, as a simulator does: it was kept as a launch of about 20 s. Both now say what to look at.
- `appdyno update` moves to the latest release, and `--check` says what it would do and changes nothing. A release is verified before anything changes: the exact version in a temporary folder with none of its scripts run, then `npm audit signatures`, which must have verified a provenance attestation for that release itself, built from this repository. One that cannot be verified is refused with a code and a hint, and there is no flag to skip this. It upgrades with the manager that installed it, npm in its own prefix or pnpm, refuses a source checkout, a one-off `npx` run and a prefix another manager owns, and never goes back or to a prerelease. Nothing looks for a release in the background. It takes npm 11.12 or newer. See `docs/clients.md`.
- `appdyno doctor` says the version, where it is installed and by what, with no network.
- `.github/workflows/release.yml`: a version tag runs the gate, then publishes with `npm publish --provenance`. `ci.yml` packages the agent before it builds, which a clean checkout needs.
- `crashes` on Android counts every exit the system keeps, by its reason in full with its status, and what memory it died with where that was kept.
- `perf_snapshot` `also: surface`: an Android `SurfaceView` or game's frames from `dumpsys SurfaceFlinger --latency`, where `gfxinfo` has none, with its frame rate and Play's slow sessions, read in whole refreshes of the display.
- `appdyno mcp --http 127.0.0.1:PORT`: the same server over Streamable HTTP, for a client that cannot start a program on this Mac. Off unless asked, on loopback alone, with a token required and generated if not set, and an `Origin` check. A client holds it from its first tool call until 10 minutes after its last, when its conditions go back; another is refused by name. A tunnel is yours to run. See `docs/clients.md`.
- `docs/clients.md` and `docs/clients.tr.md`: each client step by step, the ones in a browser, and a phone from nothing, signing included, in English and Turkish.
- `appdyno install` adds one more client, and gives the entry that a desktop app shares with its command line the times a first run needs, where its own defaults would stop it. Times set by hand stay.
- `perf_launch` `baselineProfile`: an Android release build's Baseline Profile, present in the APK, applied by the device's status, and what it is worth, in cold starts with it and without taken in turns and called as the gate calls a change. A `.dm` that delivered a profile and compiled nothing is called that.
- `crashes` `symbols` names a release build's stack: `atos` from the dSYM whose UUID is the crashed image's, by `dwarfdump`; `ndk-stack` from a folder of libraries with their symbols. A dSYM or library of another build is never read, and the answer says which it wanted. A tombstone's signal and frames are its `detail` now, not its headers.
- `device_setting`: Android's `airplane`, `wifi` and `mobile_data`, read back from the device, put back at the end, and refused with what the device said. A device reached over its network refuses to cut it.
- `biometric` on an emulator: `match` and `nomatch` touch its sensor and are done only when the fingerprint service counted the touch, and `enroll` touches until one is held.
- `device_setting` `keychain`: empties a simulator's keychain and counts what apps held, from the store's own rows.
- Android: a system UI window with the focus is read: a biometric prompt was an empty screen.
- User-perceived ANRs count one the app recovered from: it ends in no exit, and read 0 for three real ones. The dropbox has them.
- One flow can run another: `run shared/login.flow` puts its steps in place. All are read before the first step acts, a file that runs itself is refused with the way round named, and a failure names the file and line it is on.
- Kept traces are pruned, to a limit that is said and can be changed (10 GB, `--trace-limit-gb`), oldest first and never what a baseline or a recent run names. It goes by one state folder, removes nothing when what it reads is empty or unreadable, and logs what it removes; `appdyno perf prune [--dry-run]` lists the same.
- A unit test can no longer reach this Mac's own state folder: it has one of its own, and a call on the real one fails the run.
- No silent success: a failed action says whether its touch went out (`dispatched`); a touch reads a screen nobody has seen first; a locked phone refuses by name (`DEVICE_LOCKED`); two recordings at once refuse by name, not an empty trace; an iPhone's thermal state is read from what it recorded.
- Android 15 and later: `perf_snapshot` `also: startInfo` says why the app last started, and where the start went, with no trace.
- `perf_snapshot` on a process with no window, up for a broadcast or a job, reads 0 frames: it failed on the summary such a process does not print.
- `appdyno install` adds the server to the MCP clients on this Mac: the ones you pick, or all with `--yes`. It changes that one entry and keeps every other byte, writes a backup first, does nothing when the entry is already right, and refuses a file it cannot read. `--dry-run` shows the change and `--remove` takes it out.
- Conditions go back only for their owner. Each entry records its process: the start of a session puts back only what a dead one left, and its end only its own, so a new session no longer undoes what a live `--share` process or the command line set. A command line's change stays until `restore`, even across sessions, which is new. `restore` leaves alone what another live process changed, and says so.
- A recording, a network capture, an open report and a flow recording that a dead process left are ended at the next session and said, not left running. What a live process runs, or a command line started, stays.
- State files are whole or not at all: written to a temp file and renamed, and checked by a schema. One that cannot be read is said at the start of a session and kept as `.bad`, where it was once silently written over.
- Tool calls in parallel can no longer lose a condition's old value, and open a device once.
- SIGTERM and SIGINT end the server as the client closing stdin does, so a killed server puts its conditions back.
- The command line's selected device and diff baseline are kept per working directory: two terminals in two folders no longer share one. The old `cli-session.json` is no longer read.
- iPhone: `perf_trace` `what: hangs` says whether each hang was busy or blocked, in which function, from what a Time Profiler trace holds already; `dsym` names the functions of a build with no symbols, on `perf_trace` and `perf_profile`.
- `perf_compare` `action: functions` and `appdyno perf functions`: which functions moved between two profiles.
- Android: `perf_trace` says why the slow frames were slow: a monitor lock and who holds it, a binder call and to whom, the garbage collector, work, a starved or blocked thread, or that they are unexplained.
- Tags: `tag smoke login` in a flow, `appdyno test --tag smoke --exclude-tag slow` to select. A file that cannot be read stays and fails, and selecting nothing is a failure.
- `--env-file` on `appdyno test` and `flow run` (`envFile` in the tool): a flow's values from a `.env` file, under `--param` and over the environment. A secret from it is hidden as any other.
- `appdyno flow run --iterations` and `--scenario` work: the command line took their values for stray words.
- `appdyno test --retries N` runs a file that failed on a step again, whole. One that passes then is reported as flaky, in the log and in JUnit (`flakyFailure`, `flakes`), never as a plain pass, and exits 0; each failed attempt's evidence stays.
- Android memory as Play judges it: `perf_snapshot` `also: anonMemory` reads anon RSS and swap by process state, and bitmaps, against Play's table for the device's RAM, and says a device is no P90.
- Android battery signals with no power model: `perf_snapshot` `also: battery` reads wake locks by tag, the longest one, wakeups and jobs over a window, on a phone on a cable and on an emulator. Nothing is reset and the phone is never told it is unplugged.
- Numbers against Play's definitions, in the answers and on the dashboard: slow frames over 16 ms (a session above 50 %), frozen frames (above 0.1 %, from 1,000 frames), a state's longest start of the day, user-perceived ANRs. A local run says "this session would count", never a rate.
- A journey measured and gated: `appdyno test <flow> --measure [--iterations N]`, or `flow` `run` with `iterations`, keeps a flow as a scenario with a time and what the device reads for each step. `perf compare` names the step that got slower, and the dashboard has a row `Journeys`, with one bar split by step.
- A `perf_*` call during a recording no longer stops a replay: what it did to the screen is written as the plain steps that do the same, and what left the screen alone writes nothing.
- A baseline takes what a run measured clean and names what it left out, rather than refusing the whole run for one number that went through a loaded Mac.
- `appdyno mirror`: a live native window on a simulator, an emulator or an Android phone, driven by mouse, trackpad and keyboard, with an agent on the same device if it shares. One viewer per device, compiled by `clang` on first use, with no server, daemon or port of ours. What stands in the way is named with its fix, and it goes on by itself when it clears. See `docs/mirror.md`.
- An iPhone in `appdyno mirror`, experimental, on iOS 27 and by USB: its own display service in 4:4:4 at its own size, nothing on the phone. It rests on undocumented services, so the runner stays, and its code can be left out of a build as a whole.
- The `mirror` tool: open, close, status, stats. No frames over MCP.
- `hand_off`: asks a person, and waits. A pill on a window while an agent drives, and an Activity panel of its calls.
- `perf_*` on a mirrored device gets the noise mark `mirrored`, as a stream runs an encoder there.
- The Android agent: a stream with an encoder ladder and bounded backpressure, on a connection of its own, and `touch`, with no settle.
- `simulator` boots an emulator with `-grpc <free port> -grpc-use-token`, for a window's picture with nothing in the guest.

- Protocol 2: the host parses every request by its schema, so the agents have no defaults of their own, and a value out of range is refused before it reaches a device. A dark screen is `SCREEN_OFF`, an unknown method `UNSUPPORTED` on both platforms. `device_info` no longer lists capabilities: there are none.

## 0.6.0

The first version run on all four kinds of device together: an emulator, a simulator, an Android phone and an iPhone.

Found when the parallel branches ran together:

- Neither fixture built: two branches had each added a network screen. One screen now, on each.
- `moving` read true in every answer with animations off, as the system's answer was merely not back yet.
- `--animations off` and `device_setting animations` could restore over each other: only one holds the scales' old value at a time. With `reduce_motion` as well, the newest is put back first.
- `perf_snapshot` `also: energy` on Android no longer resets the battery history: a window is what the count since the last charge grew by.
- iPhone: dark mode and reduce motion read empty or as an object, so a restore put back nothing; `crashes` always refused, as `devicectl` stops copying the folder at a file it cannot take (`19:24.spindump.txt`), and reports now copy one by one.
- iPhone: a signing profile that cannot be read says so, not an internal error; `record` says this phone has no recording capability and what to do.
- A locked simulator is opened by its lock state: a read under the lock held the runner up for 15 s.
- With an app selected and another in front, the answer shows what is in front, not 0 elements.
- The Xiaomi's lost first touch, found: its screen goes off by itself after 60 s, and once woken the app reads as on the screen before it can take a touch (6 of 14 touches lost, up to 1.5 s after the wake). The host now waits for the focus to hold (0 of 15), and the agent refuses a touch on a dark screen so that the host wakes it first. A long measure wakes the phone too: a dark one starts no app, and `am start` reads `UNKNOWN (0)`.
- A simulator's clipboard is set from the Mac: the runner's own call at times held it up for 15 s.
- Energy reads Android 16's row, whose parts follow on the next line.
- A packet trace with nothing in it says so, not "0 of 0": on a Xiaomi with Android 16 the source records nothing for any app.
- A web page's element that the tree has by id is not listed again as missing from it.
- `app install` wakes the phone, and names HyperOS's on-screen question when no one answered it.
- `app install` answers the phone's prompts by itself during the install it started, and says so in its answer and in `report`: yes to a Xiaomi's USB install prompt, for the app in the file and with its remember box left alone, and no to Play Protect's prompt to send the app to Google, always. A Play Protect warning is left alone and quoted, unless the server runs with `--accept-install-warnings`. `--no-install-consent` turns it all off. Earlier taps on that prompt were lost because it slides up with its buttons already read at their last place: a touch took nothing, or fell above the dialog, which cancels the install. A screen timing out as it opened lost it too. A prompt still open from an earlier call refuses the next install, as a touch on it would answer that earlier one.
- A pulled recording waits in the state folder, not beside the video.
- Answers: a control and its own text with the same words are one target; a launch or a found scroll carries no "no change seen"; refusals have no filler and no wire method's name; keys typed with no keyboard on iOS are refused as on Android.

- Evidence and reach, with no new dependency. Each answer says what a device cannot do and why.
- `record`: screen video on Android (segments of `screenrecord`, joined with no dependency), simulators (`simctl`) and iPhones (`devicectl`, not yet run on one). It outlives its process, one per device. `stop` reads the file: one that does not play is a refusal.
- `report`: a folder with `index.html`: steps, the screen and an image after each, video, logs, crashes, measurements. Secrets hidden, images painted over where an element holds one, nothing loaded from the network.
- `network`: a bounded list of an app's traffic, through a proxy you run (`http_proxy` on Android, put back; the Mac's on a simulator; read from Proxyman's export or a HAR file), an injected `NSURLProtocol` on a simulator, `dumpsys netstats` and Perfetto's packets on Android. `paths` says what each sees, and no certificate is installed.
- `webview`: pages, the DOM as elements, click and scripts, through DevTools on Android and Safari's inspector socket on a simulator. `screen` marks a web view's elements as `web` and adds what the accessibility tree does not hold.
- `react_native`: targets, the JS console and reload, through Metro. Flutter's Dart VM service is not built: no SDK here to test it on; see the README.
- `visual`: a baseline, a comparison with a tolerance and masks, a diff image. The PNG decoder moves to `core`, with an encoder.
- `device_setting`: `proxy`, `battery` (put back), `fold`, `call`, `sms`.
- The catalog leaves out what says nothing to a client: each tool's schema URL and task setting, and length limits, which the server still enforces. 42 tools, 24,814 characters.
- A device's refusals are async: a phone's `push`, `biometric`, `clear` and `grant` reached a client as an internal error.
- An op with `action` takes it as its first word on the command line: `appdyno record stop`.

- Flows. `flow` records what a session does to a readable file (`start`, `stop`, `save`), replays it with no model (`run`, `--from`, `--param`) and exports it to Maestro YAML, refusing what has no form there. `appdyno test` runs flows on each `--device` in turn: JUnit, a failure's screenshot and tree, exit code 1. A miss or several matches stop the run with the nearest candidates, the step and the file's line; nothing is guessed. Passwords and `APPDYNO_SECRETS` become named parameters and are in no file. New package `flows`. `flowsFor(ctx).replay` takes `onStep`, for measuring each step.
- `scroll_to` answers once the list has stopped: on a simulator a tap right after it was often lost, as the settle does not see a list coasting and UIKit takes a touch on one as "stop". Measured: 3 of 6 lost before.
- `ActionOut.settleMs`: from the action to the settled screen, as the device timed it.
- The nearest elements of a refusal are also judged by their ids, so a mistyped id finds its neighbour.

- Driving. Every action takes a ref, coordinates or a selector; `steps` runs across screens with `wait_for`,
  `assert` and `scroll_to`; `scroll_to`, `assert`, `gesture` (double tap, long press, drag, pinch, free plan), `keyboard`,
  `alert` (any system alert), hardware buttons in `press_key`, `app`, `simulator`, `device_setting`, `clipboard`.
- Device claims for parallel agents, with no daemon. Conditions the tool changed are put back.
- Protocol 1.3: the agent's `wait`.
- `long_press` and `pinch` are now kinds of `gesture`, `dismiss_alert` is `alert`, `set_clipboard` is `clipboard`.

- Performance: `packages/perf` keeps every measure with its context; baselines and budgets under `.appdyno/perf/`; `perf_compare` and `appdyno perf compare|baseline|budget` as a gate; `perf_query` on a kept trace; Android launch by state with compile control and a start trace, frame stats, threads, network, energy, exits, size and heap profiles; an opt-in frame probe on iOS simulators; hitches, hangs and launch on an iPhone on an app of our own. `docs/perf.md` has what works where.
- Docs: a README for new users, CONTRIBUTING, SECURITY and a CI workflow (lint, typecheck, unit tests, agent unit tests).
- iOS simulators take their touches and answer their reads directly: `SimHID` (the simulator's `dtuhidd`, from the Mac) and `SimAX` (accessibility snapshots, inside it), compiled on first use, checked against the runner, which answers whatever they refuse. `docs/protocol.md`, `docs/perf.md`. `appdyno doctor --serial <simulator>` reports them; `APPDYNO_SIM_DIRECT=off|read`.
- Two-finger gestures on simulators.
- The runner's `hello` and `visible` flag no longer take `UIScreen`'s 320 x 480 for the screen: everything below that line was marked not visible.
- `launch` brings a running app forward as it is, on a simulator and a phone; terminate it first for a fresh start.
- iPhone signing found by itself: a development profile naming the phone with a wildcard app id, its identity in the unlocked login keychain. `APPDYNO_IOS_PROFILE` still wins; a keychain and password are optional; `APPDYNO_IOS_TEAM` lets Xcode provision the runner.
- iPhone measures: memory and CPU (Activity Monitor), CPU profile and hangs (Time Profiler), launch time. `perf_profile` on simulators uses the Time Profiler: `sample` sees no busy samples of a simulator app under macOS 27. `xctrace` recordings wait for the tool's own "started" notification and their stop is bounded.
- Hitches on a phone answer UNSUPPORTED when the trace has no frames, never "no hitches" (Xcode 27.1 on iOS 27.0.1).
- `Device.virtual`: an iPhone is no longer called a virtual device.
- A starting runner says where it has got to on stderr.

- Android settle: reads only when one can decide something (none between two screens or before a transition's new window, as WMS tells it; an event brings the next one forward), and on API 34+ an answer during a window's slide with every place and visibility as they will be at rest (`settle.moving`); the next action or screenshot waits for the slide's end. See `docs/protocol.md` "Settle".
- An action or a read answered between two screens no longer says "0 elements": it waits for the next screen, else fails with `NOT_FOUND`.
- Compose `testTag` is the id of a node with no resource id, from its extras: no app change needed.
- `--animations off` (`APPDYNO_ANIMATIONS=off`): the device's animation scales are off for the session, back when the last host leaves or by a watcher process if the agent dies; on for performance measurements; `doctor --serial` warns if left off.
- Packages by module (`core`, `driver-android`, `driver-apple`, `ops`, `mcp`, `cli`, `appdyno`), the import rules enforced by a test. Commands: `appdyno` (with `appdyno mcp`) and `appdyno-mcp`.
- One definition per operation: every MCP tool is also a command (`appdyno screen`, `appdyno long-press --x 1 --y 2`, `--json`, `--out`).
- Device ports and measure sources: a device without a measure says which one it lacks. `perf_snapshot` answers `memoryKb` and `memoryKind` instead of `pssKb` and `footprintKb`.
- A device failing at open reaches the client with its cause and hint, not as an internal error.
- The iOS runner reads its port and token again (`TEST_RUNNER_APPDYNO_*`).
- `screen.window` is known in landscape with the navigation bar on the left, so swipes there use the real screen.
- Accessibility audit (`device.audit()`): the iOS platform audit through the runner (`audit`), and on
  Android the host's checks of a tree, a screenshot and the characters each text does not show
  (`a11y.read`, which also brings the nodes' traversal hints): touch targets, text and icon contrast, names, duplicate names, clipped text.
- Android tree flags: not important for accessibility, and read as one unit by a screen reader.
- A simulator opens, reads and takes touches with no runner: it starts for a system alert, text entry, an image, an audit or a control found at different places.
- A first `launch_app` starts the app alongside the agent or helper. `am start`'s `Status: timeout` is no failure: at load 500 an app still drawing was refused as not started.
- A ref is touched where the screen has it just then, not where the last answer did: an app can move things with no action.
- An answer's image is 800 px at quality 60, and an answer says a row once when a control of its name stands at its place.
- A new Android agent waits out one that was killed, which the system keeps as UI automation's holder for about 2 s: a start in that moment was refused with `AGENT_CONFLICT`.

Still open:

- `simctl pbcopy` writes nothing on Xcode 27.1, even on a new simulator, so a simulator's clipboard depends on the runner, whose call can stall on a loaded Mac: `clipboard` then refuses and says so.
- The gate on a Xiaomi takes no baseline: its device load stays over the limit of 8.
- `network` `packets` records nothing on a Xiaomi with Android 16; why was not looked into. The answer says so.
- `record` on an iPhone 13 Pro Max with iOS 27.0.1: `devicectl` has no such capability. It has not been seen working on any phone.
- HyperOS's install prompt needs a person: see "Reaching a phone".

## 0.5.0

- Packaging: `scripts/install.sh` installs the MCP server and the `appdyno` command from this
  checkout; the package carries the prebuilt Android agent and the iOS runner's sources (built once on
  first use where no build is). One version for every part, checked by a test.
- `appdyno doctor`: Android SDK and adb, Xcode, the runner builds, the iPhone signing, and the
  devices that are connected (adb, booted simulators, iPhones over USB).
- iOS: a system alert or sheet that came up during a settle counts as busy while it animates in; with
  that, the tap through XCTest's event synthesizer is the default (about half the time of XCUI's tap on
  a phone; `APPDYNO_FAST_TAP=0` turns it off).
- The iOS runner shows as "appdyno" with its icon on the simulator and the phone.
- The adb client starts the adb server again after every outage (another tool's `adb kill-server`
  between calls is harmless).

## 0.4.0 — real iPhone

- The runner on an iPhone over USB: re-signed for a development profile (bundle ids from the profile,
  the identity from a keychain that is only unlocked), installed when the phone has another build under
  that id, started by xcodebuild, reached through the Mac's USB multiplexer.
- Apps and links on the phone through devicectl; text as keys (the runner cannot reach the clipboard
  there).
- Animation hitches on the phone through Xcode's trace tool; a memory graph with its leaks on the
  simulator; MCP's perf_trace and perf_heap answer on iOS.

## 0.3.0 — iOS simulator

- The runner: a UI test serving the protocol on a loopback port; public snapshots with XCUI's idle
  waits off (one shim, public fallback); paste-first typing; settle from reads alone.
- Simulator perf from the Mac: memory, CPU, launch, CPU profile (the app's own functions ranked by busy
  time).
- MCP: simulators listed and driven by id.

## 0.2.0 — Android, hardened

- Settle: a tap on something that cannot react settles after 80 ms; the window stretches on a loaded
  device (slow reads, late wake-ups); stillness is proven only up to a read's start.
- Perf tools with accuracy tests: frames, frame timeline, memory, CPU, launch, CPU profile, heap dump.
- Output schemas and annotations on every tool; local CI with a latency history and regression gate.
- Real Android phones: injection permission, typing, mock location (gps, network, fused), reconnect,
  screen off and keyguard.

## 0.1.0 — Android emulator

- The on-device agent (shell user, UI automation), the wire protocol, the host library and the MCP
  server with act-and-read answers and a local policy.
