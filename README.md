# appdyno

appdyno drives and measures iOS and Android devices: simulators, emulators and phones. It is an MCP
server (stdio), a command line and a TypeScript library, on macOS. It talks to the device through its
own on-device agents, and it reads performance numbers (frames, memory, CPU, launch time) from the
device itself.

## Install

```sh
claude mcp add appdyno -- npx -y appdyno mcp
```

You need Node 22+, and `adb` for Android or Xcode for iOS. No JDK, no pnpm. The package is one
download with no runtime dependencies.

appdyno is not published to the registry yet. Until it is, install from a checkout (needs pnpm and a
JDK for the Android agent):

```sh
sh scripts/install.sh      # npm pack, then npm install -g of the tarball
appdyno doctor             # what is installed, what is missing, which devices are connected
```

The first use of a simulator builds the iOS runner once. It takes a few minutes and shows progress.
The result is cached under `~/Library/Caches/appdyno` (the state directory, `APPDYNO_STATE_DIR`).

Cursor or any client with a JSON server list:

```json
{
  "mcpServers": {
    "appdyno": { "command": "npx", "args": ["-y", "appdyno", "mcp", "--device", "emulator-5554"] }
  }
}
```

## Tools

Tools take no `device` parameter. The device is the server's `--device`, else the only connected one,
else the one `use_device` selected.

| purpose  | tools                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| devices  | `list_devices`, `use_device`, `device_info`, `set_orientation`, `set_location`, `clipboard`, `device_setting`, `simulator` |
| read     | `screen`, `find`, `wait_for`, `assert`, `screenshot`                                                                       |
| act      | `tap`, `gesture`, `swipe`, `scroll_to`, `type_text`, `press_key`, `keyboard`, `steps`, `alert`                             |
| apps     | `open_link`, `launch_app`, `terminate_app`, `app`                                                                          |
| check    | `audit` (accessibility), `logs`, `crashes`, `visual`                                                                       |
| evidence | `record`, `report`, `network`                                                                                              |
| inside   | `webview`, `react_native`                                                                                                  |
| measure  | `perf_snapshot`, `perf_scroll`, `perf_launch`, `perf_profile`, `perf_heap`, `perf_trace`, `perf_compare`, `perf_query`     |
| replay   | `flow`                                                                                                                     |

A target is a `ref`, `x` and `y`, or a `selector` `{ text, id, role, index }`, resolved on a fresh read
just before the action. Text matches as `find` does, without case or accents ("İstanbul", "istanbul"),
and an exact match beats a partial one. Several matches refuse and list them with their refs; no match
waits a moment, then refuses with the nearest labels.

`steps` runs up to 20 steps across screens. A ref or selector need exist only when its step runs. It
stops at the first failure, says which step and why, and shows the screen. `wait_for` and selectors
wait on the device, so the tree crosses the wire only when the screen changed.

`gesture` holds `double_tap`, `long_press`, `drag`, `pinch` and a free `plan`. `press_key` holds the
hardware buttons. `app` holds `list`, `state`, `install`, `uninstall`, `clear`, `grant`, `revoke` and
`launch` with arguments and environment. `device_setting` holds `dark_mode`, `text_size`,
`reduce_motion`, `animations`, `locale`, `network`, `proxy`, `battery`, `push`, `biometric`, `fold`, `call` and `sms`.

What a platform cannot do is refused with the reason (`UNSUPPORTED`):

| what                       | Android                    | simulator                 | iPhone                      |
| -------------------------- | -------------------------- | ------------------------- | --------------------------- |
| volume buttons             | yes                        | yes (no way to read back) | the runner                  |
| clear an app's data        | `pm clear`                 | empties its container     | no: uninstall and install   |
| grant, revoke a permission | `pm grant`, `pm revoke`    | `simctl privacy`          | no: answer with `alert`     |
| launch environment         | no: args are intent extras | yes                       | yes                         |
| dark mode, text, motion    | yes                        | yes                       | `devicectl`                 |
| animations                 | yes                        | no: use `reduce_motion`   | no                          |
| locale                     | per app, API 33+           | whole simulator           | no                          |
| slow network               | emulator only              | no                        | no                          |
| push                       | a shell notification       | to the app                | no: needs Apple credentials |
| biometrics                 | no                         | yes                       | no                          |
| fold pose                  | a foldable emulator        | no: `simctl` has none     | no                          |
| incoming call, SMS         | emulator only              | no: no telephony          | no                          |
| battery level              | yes                        | no: it only draws one     | no                          |
| proxy                      | yes, put back              | follows the Mac's         | no: its Wi-Fi settings      |

Changing a condition writes the old value down first. It goes back when the session ends, or with
`device_setting` name `restore`. A session that died leaves the file, and the next one on that device
puts it back and says so; what cannot be put back is reported. A command line is one process per
command, so its changes stay until `restore`.

## Parallel agents

A process that drives a device holds it: a file in the state directory with its pid and start time.
A dead owner's claim is free. A second process is refused with the owner's pid and name unless it asks
to share: `use_device` with `share: true`, `--share` on either command line, or `APPDYNO_SHARE=1`.
`list_devices` shows who holds what. There is no daemon.

`simulator` boots and shuts down simulators and emulators, on request only. With no name, shutdown
touches only what this tool started. `APPDYNO_EMULATOR_ARGS` replaces the emulator's default flags, and `APPDYNO_EMULATOR_FIRST_PORT` is where the search for a free port starts.

An action answers with the settled screen. `settled` means the screen was still for the window.
`changed` means the screen differs from before the action, in layout or text; it does not say the action
caused it. If nothing changed the answer says "no change seen in N ms; if a slow reaction is expected,
use wait_for". A failed call is an `isError` answer with a `code` and a `hint`. Cancelling a request
reaches the device, and long operations report progress.

`logs` reads logcat for the app on Android and the simulator log on a simulator. For an iPhone,
`devicectl` cannot read the log of a running app, and the answer says so. `crashes` collects the
system's crash records for the app (Android exit info and dropbox, the simulator's DiagnosticReports,
an iPhone's system crash logs) as a bounded summary and a file path. Secrets are redacted.

## Evidence

### Video

`record` with `action` `start` (`file`, `maxSeconds`, default 1,800) and `stop`, one recording per device. It
outlives the process that started it, so `appdyno record start` and `appdyno record stop` work as two commands. A session's
end stops a recording it left running.

`stop` reads the file, and a file that does not play is a refusal saying why (a recorder killed before it ended leaves no
index). The answer gives the length, frames and size.

|           | how                                                      | what to know                                                                                                                                                                                                  |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android   | `screenrecord` on the device, 3 minutes a run, 4 Mbps    | runs are joined into one video by copying their frames, with no dependency; a moment is lost at each join. Runs an encoder change makes unjoinable stay as `name-1.mp4`, `name-2.mp4`, and the answer says so |
| simulator | `simctl io recordVideo --codec=h264`, a QuickTime `.mov` | a frame is written only when the screen changes, so a still screen gives a very short video, and the answer says so                                                                                           |
| iPhone    | `devicectl device capture screen-record`                 | not every phone offers it: an iPhone 13 Pro Max on iOS 27.0.1 has no such capability, and `record` refuses and says what to do. It has not been seen working on a phone                                       |

### Report

`report` `start` (`dir`) keeps every call from then on: its arguments, its answer and, after anything that is not a plain read,
the screen and an image of it. `stop` writes `index.html` in that folder, with the video recorded meanwhile, the app's log, its
crashes and the measurements taken. So does the end of a session. `write` writes it at any moment, and with no `start` it is a report
of the screen as it is.

The page loads nothing: it has no script, and its content policy allows only its own folder. Listed secrets and what looks
like a credential are hidden in all text. Typed text is shown by its length. An image is painted over where an
element holds a secret or is a password field, and left out if it cannot be painted over. Text drawn with no element behind it cannot be told, and a video is not painted over.

### Network

`network` `paths` says what each way sees on this device, and why not. `start` picks one, `read` and `stop` give a bounded list.

| way       | where                                                                                                                                                                                                 | sees                                                                                                              | bodies                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `proxy`   | Android: `settings put global http_proxy`, through `adb reverse` for one on this Mac, put back at `stop` or the session's end. Simulator: follows the Mac's proxy, and this tool does not change that | every HTTP request of an app that keeps the system proxy; for HTTPS only the host unless your proxy decrypts it   | only in the proxy's export, only where it decrypted |
| `probe`   | simulator: an `NSURLProtocol` injected into the app, which restarts                                                                                                                                   | URLSession requests: method, URL, status, time, size. Not background sessions, `WKWebView` or `Network.framework` | no                                                  |
| `bytes`   | Android: `dumpsys netstats`                                                                                                                                                                           | an app's bytes and packets; not the loopback                                                                      | no                                                  |
| `packets` | Android 14+: Perfetto's `android.network_packets`                                                                                                                                                     | an app's packets by remote port and direction, read at `stop`                                                     | no                                                  |

The proxy is one you run. `read` lists a running Proxyman by its own export, and any proxy from a file: `har`, from Charles (File,
Export Session) or mitmproxy (`--set hardump=file`). A list holds what went through the proxy from any client, since `start`. No
certificate is ever installed: to see HTTPS through a proxy, install its certificate yourself. An iPhone has only `read` with `har`: its proxy is in its Wi-Fi settings.

### Web views

`webview`: `pages`, `elements` (the DOM at tap coordinates, to read where the accessibility tree does not), `click` (a CSS
selector), `eval` (a script). On Android it speaks the DevTools protocol to the `webview_devtools_remote_<pid>` socket of a debuggable
app, through `adb forward`. On a simulator it speaks to the socket Safari's Web Inspector uses, and from iOS 16.4 a page shows only if the app set
`isInspectable`. An iPhone is not reached this way.

`screen` marks what a web view shows as `web`, and adds what the page holds and the accessibility tree does not, by coordinates and
selector. An app that is not debuggable still shows what its web view tells accessibility.

### Flutter

A Flutter app's semantics are in the accessibility tree, so `screen`, selectors and taps work on it. The richer tree of the Dart VM
service is not built: this tool's rule is to test what it ships, and the Mac this was written on has no Flutter SDK to build a test app with.
It would go as `webview` does: find the `Observatory` or `Dart VM service` line in the log of a debug build, forward its
port, and call `ext.flutter.inspector.getRootWidgetSummaryTree` over its WebSocket.

### React Native

`react_native` talks to Metro on this Mac and needs no device: `targets`, `logs` (the JS console over the Hermes
runtime's DevTools protocol, for `ms`, secrets hidden) and `reload` (Metro's route, else the runtime's). Tested against a stand-in for Metro only, not a real app. Left out: the
component tree and JS profiles. On Android, a device reaches Metro through your own `adb reverse tcp:8081 tcp:8081`.

### Visual comparison

`visual` `baseline` saves the screen as `name` under `dir` (default `./appdyno-baselines`, to commit with your project). `compare` refuses
with `CHECK_FAILED` past `tolerance` (percent of pixels, default 0.1; a pixel counts if a channel differs by more than 16), and writes
`name.diff.png` (what differs in red, masks in blue) and `name.actual.png`. `masks` are `x,y,w,h` in tap units or `text`, `id`, `role`; the status bar is always left out.
A baseline holds for one size of screen, and the refusal says so.

## Flows

What an agent does once can run again with no model, on this device or another, and in CI.

```sh
appdyno flow start            # or the flow tool, action start: every action from here on is logged
appdyno tap --json '{"selector":{"text":"Form"}}'
appdyno flow stop             # prints the flow, and any step to look at
appdyno flow save login.flow
appdyno flow run login.flow --param PASSWORD_INPUT=... --from 3
appdyno test flows/ --device emulator-5554 --device <udid> --artifacts out --junit out/junit.xml
appdyno flow export login.flow > login.yaml
```

A flow is a text file, one step per line:

```text
app dev.appdyno.fixture
param NAME
secret PASSWORD_INPUT

stop
launch
tap role=button text="Form"
type "${NAME}" id=name_input replace
type "${PASSWORD_INPUT}" id=password_input
tap id=submit
assert id=result check=text equals="Sent: ${NAME}"
tap id=add_button index=1 !ambiguous
```

| step                                                                        | runs                          |
| --------------------------------------------------------------------------- | ----------------------------- |
| `launch`, `stop`                                                            | `launch_app`, `terminate_app` |
| `tap`, `long_press durationMs=`, `double_tap`                               | `tap`, `gesture`              |
| `type "text" [target] [replace] [submit]`                                   | `type_text`                   |
| `press_key back`, `swipe up [target]`, `scroll_to <selector> [direction=]`  | the tool of that name         |
| `wait_for <selector> [gone] [timeoutMs=]`                                   | `wait_for`                    |
| `assert <selector> [check=] [equals=] [expect=false] [timeoutMs=]`          | `assert`                      |
| `open_link "url"`, `set_location 41.0 29.0`, `alert allow`, `hide_keyboard` | their tools                   |

A selector is any of `id=`, `role=`, `text=`, `index=`; text matches as it does in the tools.

**Recording** logs each action that succeeded, with a selector that finds its target alone on that
screen at that moment: the id, else role and text, else text. Refs never reach the file. What nothing
finds alone keeps its index and is flagged `!ambiguous`. Only a point on no element, a slider or a large
area stays as coordinates, flagged `!coordinates` with the screen size they hold for; a screen of another
size refuses that step. A role is kept when both platforms name it alike (`button`, `textField`...), and
Android's own ids (`android:id/button1`) are not kept. An action with no step (a pinch, a device setting)
is written as `unrecorded "..."`, where a replay stops, so that it cannot pass without it. `flow stop` and
`flow save` list every step to look at.

**Secrets.** Text typed into a password field, and text in `APPDYNO_SECRETS`, become a `secret` by name:
the field's id, or `SECRET_1` for the first of `APPDYNO_SECRETS`. From then on the same text anywhere else,
such as a label that shows it back, becomes that name too. The file never holds a value. Neither does the
recording kept between commands, which holds a salted digest. `param` and `secret` values come from
`--param` (`params` in the tool) or the environment variable of that name; `$${` is a literal `${`. A secret
is hidden from a replay's answers, report and saved tree. A screenshot shows what the screen shows, so a
secret typed into a plain field can be seen in it.

**Replay** runs each step through the same operation an agent calls, with its settle. A target must hold its
place for 300 ms before it is touched, as a list still coasting takes a touch as "stop". A target gets 10 s to
come, an `assert` 10 s to hold (`timeoutMs=` changes it); then the run stops, as a second try or a near match
would be a guess. A failure gives `file:line`, the step number, the nearest candidates and the screen. Several
matches refuse too. A step during which the app died fails with the crash's reason. A flow's lines are all
checked before its first step acts, and a missing value is refused by name before anything runs. Each step's
time from action to settled is in the answer and the report: the device's own time for a tap or a key, all of
the step for `launch`, `open_link` and `scroll_to`.

**`appdyno test`** runs files or directories of `.flow` one at a time on each `--device` in turn. It writes
JUnit (a suite per device, a case per file; default `appdyno-artifacts/junit.xml`), saves `screen.jpg` and
`tree.json` under `<artifacts>/<device>/<file>/` at a failure, goes on to the next file, and exits 1 if any
failed or if there was nothing to run. Assertions are steps.

**Export** writes Maestro YAML, or refuses and names every step it has no form for (an `alert`, `replace`,
coordinates, a role with no id or text). A role beside a text is left out, as Maestro has none, and the YAML
says so in a comment. Maestro's text matches a whole label where ours also takes a part of one. There is no
import.

From code, `flowsFor(ctx).replay(file, { onStep })` calls `onStep` around each step's action, awaited:
`before` once its target is on the screen, `after` with its time once the screen settled.

## Command line

Every tool is also a command, with dashes:

```sh
appdyno devices
appdyno screen --device emulator-5554
appdyno wait-for --text Done
appdyno tap --help
appdyno --help
```

An op with `action` takes it as its first word: `appdyno record start`, `appdyno network stop`. Other commands: `doctor [--serial S]`, `ios build`, `test` (see Flows), `tools install` (fetches the pinned
Perfetto trace processor), `bench`. Exit code 1 means the call was refused, 2 means wrong arguments. A diff baseline
between CLI processes is kept in a small file in the state directory.

## Server options

`appdyno mcp [flags]`. Each flag has an environment variable.

| flag                 | environment             | what                                                         |
| -------------------- | ----------------------- | ------------------------------------------------------------ |
| `--device S`         | `APPDYNO_SERIAL`        | adb serial, simulator id or iPhone UDID                      |
| `--app A`            | `APPDYNO_APP`           | default app (bundle or package id)                           |
| `--allow-devices RE` | `APPDYNO_ALLOW_DEVICES` | only devices whose id matches                                |
| `--allow-apps a,b`   | `APPDYNO_ALLOW_APPS`    | only these apps                                              |
| `--allow-urls RE`    | `APPDYNO_ALLOW_URLS`    | only links that match                                        |
| `--no-home`          |                         | block the home key                                           |
| `--measurements dir` | `APPDYNO_MEASUREMENTS`  | where measurements are stored (default: the state directory) |
| `--takeover`         |                         | stop another tool that holds UI automation on Android        |
| `--share`            | `APPDYNO_SHARE=1`       | use a device another process holds                           |
|                      | `APPDYNO_SECRETS=a,b`   | values never shown back or put on the clipboard              |

Without `--takeover`, a second tool holding UI automation on Android (`another-server`, `another-tool`,
Appium, `uiautomator`) is never stopped. The error names the holder and gives the exact command to stop it.

## Reaching a phone

- Android: turn on USB debugging, connect, and check `adb devices`. A Xiaomi asks on its screen before each new install over USB and
  says no by itself after 10 s: `app install` wakes it and says so if no one answered. Ticking its remember box stops it asking.
- iPhone: turn on developer mode. A phone needs a development signing identity and a provisioning profile that names it. An
  installed profile for a wildcard app id, with its identity in the unlocked login keychain, is found by itself. To choose another,
  set `APPDYNO_IOS_PROFILE=<profile.mobileprovision>`, `APPDYNO_IOS_KEYCHAIN=<keychain-db>` and
  `APPDYNO_IOS_KEYCHAIN_PASSWORD=<password>`. Run `appdyno doctor` to see what it found. The phone is
  reached over USB, never the network. On a phone the runner cannot reach the clipboard or read what another app put there:
  iOS would ask the user. A simulator's clipboard is read from the Mac. Text goes in as keys on iOS: a paste brings up iOS's "Allow Paste" alert.

## Speed

Measured, not claimed: the Settings scenario, one server at a time on one boot, three alternating runs of 10 rounds, by `scripts/compare.mjs`, which
also reads each answer's positions against a read 1.5 s later. Medians in ms, p50 / p90. A number is relative to this Mac at this load.

```sh
node scripts/compare.mjs --device <id> --platform android --tools appdyno,another-tool,another-server --runs 3 --another-tool-bin <path>
```

**Android 14 emulator** (`sdk_gphone64_arm64`), 2026-11-03, appdyno 0.6.0, another-tool 0.21.36, another-server latest, host load 10-11 on 15 cores, device load 1-2:

| tool         | read      | tap and see   | back and see  | screenshot | read answer, chars | catalog chars (tools) | first open | position error, px, median / p95 / max | stale | errors |
| ------------ | --------- | ------------- | ------------- | ---------- | ------------------ | --------------------- | ---------- | -------------------------------------- | ----- | ------ |
| appdyno      | 64 / 82   | 819 / 948     | 550 / 577     | 50 / 71    | 1,405              | 26,587 (44)           | 1,922      | 0 / 0 / 0                              | 0     | 0      |
| another-tool | 63 / 66   | 1,079 / 1,401 | 978 / 999     | 76 / 92    | 808 (rows folded)  | 263,519 (62)          | 1,693      | 0 / 40 / 79                            | 0     | 0      |
| another-server   | 243 / 388 | 2,005 / 2,100 | 1,194 / 1,271 | 106 / 179  | 6,997              | 30,276 (34)           | 593        | 0 / 0 / 0                              | 0     | 0      |

**iOS 26.5 simulator** (iPhone 17 Pro), same date and versions, host load 6-8:

| tool         | read      | tap and see   | back and see  | screenshot | read answer, chars | catalog chars (tools) | first open | position error, points, median / p95 / max; missing | stale | errors |
| ------------ | --------- | ------------- | ------------- | ---------- | ------------------ | --------------------- | ---------- | --------------------------------------------------- | ----- | ------ |
| appdyno      | 57 / 64   | 909 / 1,073   | 674 / 713     | 85 / 97    | 2,050              | 26,587 (44)           | 7,428      | 0 / 0 / 1; 4                                        | 0     | 0      |
| another-tool | 63 / 78   | 1,154 / 1,481 | 1,509 / 1,624 | 597 / 644  | 689 (rows folded)  | 263,519 (62)          | 2,099      | 0 / 0 / 0; 0                                        | 0     | 0      |
| another-server   | 241 / 266 | 878 / 953     | 870 / 954     | 348 / 442  | 4,306              | 30,276 (34)           | 876        | 0 / 0 / 1; 1,470                                    | 2     | 1      |

**Phones, appdyno alone: no competitor was run on them.** The same 10 rounds on each phone's own Settings through the MCP server, p50 / p90 in ms, the same date, host load 12-36 with other work on the Mac:

| phone                                 | read      | tap and see   | back and see  | screenshot | read answer, chars |
| ------------------------------------- | --------- | ------------- | ------------- | ---------- | ------------------ |
| Xiaomi 25078RA3EY, Android 16 (tr-TR) | 105 / 121 | 896 / 941     | 739 / 980     | 111 / 134  | 1,438              |
| iPhone 13 Pro Max, iOS 27.0.1 (tr-TR) | 308 / 313 | 2,017 / 2,025 | 1,988 / 2,089 | 189 / 199  | 2,272              |

**Where appdyno loses.**

- Simulator tap: `another-server` is 31 ms faster, by answering during the push: 1,470 elements of its answers were gone 1.5 s later, and 2 answers were stale.
- First open: slowest on the simulator by far (7.4 s against 0.9-2.1 s) as it starts its runner, and on the emulator behind both, which answer with less: `another-server` before the app's first screen.
- Read answer size: `another-tool`'s is smaller on both, with list rows folded.
- Emulator read: `another-tool` 63 ms against 64, which is no difference.
- Screenshot size: `another-server`'s is smaller on both (33,172 against 39,344 characters on the emulator; 49,900 against 82,466 on the simulator), and `another-tool`'s on the simulator (70,776).
- Catalog: 26,587 characters, over this project's own aim of 25,000, though under both of theirs.

Measurement methods and raw outputs are described in `docs/perf.md`.

## Security

Local only: no network listener, no telemetry, and you decide which devices, apps and links it may touch.
See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `CHANGELOG.md` lists the releases.

## License

The license is to be chosen by the owner. Until then no license is granted.
