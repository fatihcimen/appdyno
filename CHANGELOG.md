# Changelog

## Unreleased

- Phase 6, evidence and reach, with no new dependency. Each answer says what a device cannot do and why.
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

## Unreleased

- Phase 5, flows. `flow` records what a session does to a readable file (`start`, `stop`, `save`), replays it with no model (`run`, `--from`, `--param`) and exports it to Maestro YAML, refusing what has no form there. `appdyno test` runs flows on each `--device` in turn: JUnit, a failure's screenshot and tree, exit code 1. A miss or several matches stop the run with the nearest candidates, the step and the file's line; nothing is guessed. Passwords and `APPDYNO_SECRETS` become named parameters and are in no file. New package `flows`. `flowsFor(ctx).replay` takes `onStep`, for measuring each step.
- `scroll_to` answers once the list has stopped: on a simulator a tap right after it was often lost, as the settle does not see a list coasting and UIKit takes a touch on one as "stop". Measured: 3 of 6 lost before.
- `ActionOut.settleMs`: from the action to the settled screen, as the device timed it.
- The nearest elements of a refusal are also judged by their ids, so a mistyped id finds its neighbour.

## Unreleased

- Phase 4, driving. Every action takes a ref, coordinates or a selector; `steps` runs across screens with `wait_for`,
  `assert` and `scroll_to`; `scroll_to`, `assert`, `gesture` (double tap, long press, drag, pinch, free plan), `keyboard`,
  `alert` (any system alert), hardware buttons in `press_key`, `app`, `simulator`, `device_setting`, `clipboard`.
- Device claims for parallel agents, with no daemon. Conditions the tool changed are put back.
- Protocol 1.3: the agent's `wait`.
- `long_press` and `pinch` are now kinds of `gesture`, `dismiss_alert` is `alert`, `set_clipboard` is `clipboard`.

## Unreleased

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
