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

| purpose | tools                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------- |
| devices | `list_devices`, `use_device`, `device_info`, `set_orientation`, `set_clipboard`, `set_location` |
| read    | `screen`, `find`, `wait_for`, `screenshot`                                                      |
| act     | `tap`, `long_press`, `swipe`, `pinch`, `type_text`, `press_key`, `steps`, `dismiss_alert`       |
| apps    | `open_link`, `launch_app`, `terminate_app`                                                      |
| check   | `audit` (accessibility), `logs`, `crashes`                                                      |
| measure | `perf_snapshot`, `perf_scroll`, `perf_launch`, `perf_profile`, `perf_heap`, `perf_trace`        |

An action answers with the settled screen. `settled` means the screen was still for the window.
`changed` means the screen differs from before the action, in layout or text; it does not say the action
caused it. If nothing changed the answer says "no change seen in N ms; if a slow reaction is expected,
use wait_for". A failed call is an `isError` answer with a `code` and a `hint`. Cancelling a request
reaches the device, and long operations report progress.

`logs` reads logcat for the app on Android and the simulator log on a simulator. For an iPhone,
`devicectl` cannot read the log of a running app, and the answer says so. `crashes` collects the
system's crash records for the app (Android exit info and dropbox, the simulator's DiagnosticReports,
an iPhone's system crash logs) as a bounded summary and a file path. Secrets are redacted.

## Command line

Every tool is also a command, with dashes:

```sh
appdyno devices
appdyno screen --device emulator-5554
appdyno wait-for --text Done
appdyno tap --help
appdyno --help
```

Other commands: `doctor [--serial S]`, `ios build`, `tools install` (fetches the pinned Perfetto trace
processor), `bench`. Exit code 1 means the call was refused, 2 means wrong arguments. A diff baseline
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
|                      | `APPDYNO_SECRETS=a,b`   | values never shown back or put on the clipboard              |

Without `--takeover`, a second tool holding UI automation on Android (`another-server`, `another-tool`,
Appium, `uiautomator`) is never stopped. The error names the holder and gives the exact command to stop it.

## Reaching a phone

- Android: turn on USB debugging, connect, and check `adb devices`.
- iPhone: turn on developer mode. A phone needs a development signing identity and a provisioning profile that names it. An
  installed profile for a wildcard app id, with its identity in the unlocked login keychain, is found by itself. To choose another,
  set `APPDYNO_IOS_PROFILE=<profile.mobileprovision>`, `APPDYNO_IOS_KEYCHAIN=<keychain-db>` and
  `APPDYNO_IOS_KEYCHAIN_PASSWORD=<password>`. Run `appdyno doctor` to see what it found. The phone is
  reached over USB, never the network. On a phone the runner cannot reach the clipboard, so text goes in as keys.

## Speed

How appdyno compares with other servers on the same device is measured, not claimed. The table is filled
by `scripts/compare.mjs`. It writes JSON and a Markdown table under `.compare/`, and it refuses a device
you did not name:

```sh
node scripts/compare.mjs --device <id> --tools appdyno,another-tool,another-server --runs 3
```

| scenario        | appdyno             | another-tool        | another-server          |
| --------------- | ------------------- | ------------------- | ------------------- |
| read the screen | run scripts/compare | run scripts/compare | run scripts/compare |
| tap and settle  | run scripts/compare | run scripts/compare | run scripts/compare |
| type text       | run scripts/compare | run scripts/compare | run scripts/compare |
| answer size     | run scripts/compare | run scripts/compare | run scripts/compare |

Measurement methods and raw outputs are described in `docs/perf.md`.

## Security

Local only: no network listener, no telemetry, and you decide which devices, apps and links it may touch.
See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `CHANGELOG.md` lists the releases.

## License

The license is to be chosen by the owner. Until then no license is granted.
