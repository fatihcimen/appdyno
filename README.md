# appdyno

A local device automation server for mobile QA: one MCP stdio server (`appdyno-mcp`) and a
TypeScript host library (`appdyno`) that drive devices through our own on-device agents and
measure them.

Status: Android (emulators and phones) and iOS (simulators and iPhones) work end to end, with performance measurement.

- Runs only on the machine it is started on: the MCP client starts it over stdio; it opens no network
  listener. The Android agent listens on an abstract unix socket on the device, reached through adb,
  and accepts a connection only with its launch token.
- Android: a Kotlin agent started with `app_process` as the shell user (nothing is installed) on the
  platform's UI automation: screen trees, touch and key input, Turkish text, screenshots, an on-device
  settle after every action.
- Performance: frames (gfxinfo, Perfetto frame timeline), memory, CPU, cold and warm launch and the
  device's own state, each stored with its raw output — see `docs/perf.md`. `appdyno tools install`
  fetches the pinned Perfetto trace processor.

## Layout

| path                      | what                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/protocol`       | wire format (frames, JSON-RPC messages, error codes) — see `docs/protocol.md`                               |
| `packages/core`           | device ports, screen model (stable refs, diffs), the agent connection; no platform knowledge                |
| `packages/driver-android` | adb protocol client, agent launcher, Android device and measures, the audit                                 |
| `packages/driver-apple`   | simctl, usbmux, runner, signing, simulator and iPhone devices and measures                                  |
| `packages/ops`            | the operations (one definition each): act-and-read answers, measures, the local policy                      |
| `packages/cli`            | one command per operation                                                                                   |
| `packages/mcp`            | the MCP server: one tool per operation                                                                      |
| `packages/appdyno`        | the composition root: the `appdyno` and `appdyno-mcp` commands, doctor, bench, the library                  |
| `android/agent`           | the on-device agent (Kotlin)                                                                                |
| `android/fixture`         | a deterministic test app (Views and Compose)                                                                |
| `ios/Runner`              | the iOS runner: a UI test serving the protocol on a loopback port (Swift); `ios/RunnerCore` its tested core |
| `ios/Fixture`             | the iOS test app (SwiftUI)                                                                                  |
| `test-device`             | tests on a real emulator or device (`APPDYNO_ANDROID_SERIAL`) or simulator (`APPDYNO_IOS_UDID`)             |

## Build and test

```sh
mise install                                   # Node 22, pnpm, JDK 21
(cd android && ./gradlew :agent:assembleDebug :agent:testDebugUnitTest :fixture:assembleDebug)
pnpm install
pnpm lint && pnpm typecheck && pnpm test       # unit tests, no device
pnpm build

# on an emulator or device you name (never a default: other devices may be attached)
adb -s <serial> install -r -g android/fixture/build/outputs/apk/debug/fixture-debug.apk
APPDYNO_ANDROID_SERIAL=<serial> pnpm test:device
node packages/appdyno/dist/main.js doctor --serial <serial>
node packages/appdyno/dist/main.js bench --serial <serial> --n 50 --out bench.json

# iOS: the runner core on the Mac, then the runner and fixture for the simulator (Xcode 27)
(cd ios/RunnerCore && swift test)
(cd ios && xcodebuild build-for-testing -project Appdyno.xcodeproj -scheme Runner \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath .derived)
# on a booted simulator you name by its id (never "booted": other simulators may run)
APPDYNO_IOS_UDID=<udid> pnpm test:device test-device/ios.test.ts

# iPhone: the runner built unsigned, then re-signed at first use for a development profile whose app
# id is a UI test runner (*.xctrunner), with that profile's identity from a keychain (only unlocked)
(cd ios && xcodebuild build-for-testing -project Appdyno.xcodeproj -scheme Runner \
  -destination 'generic/platform=iOS' -derivedDataPath .derived-device CODE_SIGNING_ALLOWED=NO)
# signing is found by itself: an installed development profile that names the phone, for a wildcard app id, with
# its identity in the unlocked login keychain. Else name it (a keychain and its password only if locked):
# export APPDYNO_IOS_PROFILE=<profile.mobileprovision> APPDYNO_IOS_KEYCHAIN=<keychain-db> APPDYNO_IOS_KEYCHAIN_PASSWORD=<password>
# or let Xcode provision the runner from its account: export APPDYNO_IOS_TEAM=<team id>
node packages/appdyno/dist/main.js doctor   # Xcode, runner builds, signing, connected iPhones in the profile
APPDYNO_IPHONE_UDID=<udid> pnpm test:device test-device/iphone.test.ts test-device/iphone-mcp.test.ts
```

The phone is reached over USB (the Mac's USB multiplexer), never the network. The runner is installed
when the phone has another build under the profile's id (stamped in `CFBundleVersion`); another tool
using the same id finds a different version and installs its own again. On a phone the runner cannot
reach the clipboard (only the app in front can), so text goes in as keys there.

## Install

```sh
scripts/install.sh      # builds this checkout, installs appdyno-mcp and appdyno
appdyno doctor     # Android SDK and adb, Xcode, runner builds, iPhone signing, connected devices
```

The package is self-contained (`~/.local/share/appdyno`, or `APPDYNO_HOME`): the Android
agent is prebuilt; `install.sh` builds both iOS runners where Xcode is (`appdyno ios build`;
they are otherwise built once on first use, a few minutes); an iPhone finds its signing by itself where a wildcard profile and its identity are installed (above). `CHANGELOG.md` lists the releases.

## Command line

`appdyno` runs the server (`appdyno mcp [flags]`, the same as `appdyno-mcp`), `devices`, `doctor`, `bench`,
`tools install`, `ios build`, and every MCP tool as a command, its name with dashes:

```sh
appdyno screen --device emulator-5554
appdyno long-press --x 100 --y 350 --duration-ms 500
appdyno steps --json '{"steps":[{"action":"tap","x":100,"y":350}]}'
appdyno screenshot --out shot.jpg   # without --out: a temporary file, its path printed
```

`APPDYNO_SERIAL` and `APPDYNO_APP` set the default device and app; a device is not kept between commands.

## MCP client configuration

Claude Code:

```sh
claude mcp add appdyno -- appdyno-mcp --device emulator-5554 --app com.example.app
```

Cursor (`~/.cursor/mcp.json`) or any client that takes a JSON server list:

```json
{
  "mcpServers": {
    "appdyno": {
      "command": "appdyno-mcp",
      "args": ["--device", "emulator-5554", "--app", "com.example.app"]
    }
  }
}
```

`--device` takes an adb serial, a simulator id or an iPhone's UDID; without it the server drives the
only connected device it is allowed. From a checkout without installing, the command is
`node /path/to/appdyno/packages/appdyno/dist/mcp-bin.js`.

Options (or environment variables): `--device` (`APPDYNO_SERIAL`), `--app` (`APPDYNO_APP`),
`--allow-devices <regex>` (`APPDYNO_ALLOW_DEVICES`), `--allow-apps a,b`
(`APPDYNO_ALLOW_APPS`), `--allow-urls <regex>` (`APPDYNO_ALLOW_URLS`), `--no-home`;
`--measurements <dir>` (`APPDYNO_MEASUREMENTS`; default `~/Library/Caches/appdyno/measurements`);
`APPDYNO_SECRETS=a,b` are never shown back or put on the clipboard.
