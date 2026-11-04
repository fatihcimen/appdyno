# Changelog

## Unreleased

- Android battery signals with no power model: `perf_snapshot` `also: battery` reads wake locks by tag, the longest one, wakeups and jobs over a window, on a phone on a cable and on an emulator. Nothing is reset and the phone is never told it is unplugged.
- Numbers against Play's definitions, in the answers and on the dashboard: slow frames over 16 ms (a session above 50 %), frozen frames (above 0.1 %, from 1,000 frames), a state's longest start of the day, user-perceived ANRs. A local run says "this session would count", never a rate.
- A journey measured and gated: `appdyno test <flow> --measure [--iterations N]`, or `flow` `run` with `iterations`, keeps a flow as a scenario with a time and what the device reads for each step. `perf compare` names the step that got slower, and the dashboard has a row `Journeys`, with one bar split by step.
- A `perf_*` call during a recording no longer stops a replay: what it did to the screen is written as the plain steps that do the same, and what left the screen alone writes nothing.
- A baseline takes what a run measured clean and names what it left out, rather than refusing the whole run for one number that went through a loaded Mac.

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

Still open:

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
