# Changelog

## Unreleased

- `perf_snapshot` `also: surface`: an Android `SurfaceView` or game's frames from `dumpsys SurfaceFlinger --latency`, where `gfxinfo` has none, with its frame rate and Play's slow sessions, read in whole refreshes of the display.
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
