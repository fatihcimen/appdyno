# appdyno

A local device automation server for mobile QA: one MCP stdio server (`appdyno-mcp`) and a
TypeScript host library (`appdyno`) that drive devices through our own on-device agents and
measure them.

Status: Android (emulator) works end to end; iOS is planned.

- Runs only on the machine it is started on: the MCP client starts it over stdio; it opens no network
  listener. The Android agent listens on an abstract unix socket on the device, reached through adb,
  and accepts a connection only with its launch token.
- Android: a Kotlin agent started with `app_process` as the shell user (nothing is installed) on the
  platform's UI automation: screen trees, touch and key input, Turkish text, screenshots, an on-device
  settle after every action.

## Layout

| path                | what                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | wire format (frames, JSON-RPC messages, error codes) — see `docs/protocol.md`                                                                      |
| `packages/host`     | the library: adb protocol client, agent launcher, device API, screen model (stable refs, diffs), `appdyno` CLI (`devices`, `doctor`, `bench`) |
| `packages/mcp`      | the MCP server: device tools with act-and-read answers and a local policy                                                                          |
| `android/agent`     | the on-device agent (Kotlin)                                                                                                                       |
| `android/fixture`   | a deterministic test app (Views and Compose)                                                                                                       |
| `test-device`       | tests on a real emulator or device (`APPDYNO_ANDROID_SERIAL`)                                                                                           |

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
node packages/host/dist/cli.js doctor --serial <serial>
node packages/host/dist/cli.js bench --serial <serial> --n 50 --out bench.json
```

## MCP client configuration

```json
{
  "mcpServers": {
    "appdyno": {
      "command": "node",
      "args": [
        "/path/to/appdyno/packages/mcp/dist/main.js",
        "--device",
        "emulator-5554",
        "--app",
        "com.example.app"
      ]
    }
  }
}
```

Options (or environment variables): `--device` (`APPDYNO_SERIAL`), `--app` (`APPDYNO_APP`),
`--allow-devices <regex>` (`APPDYNO_ALLOW_DEVICES`), `--allow-apps a,b`
(`APPDYNO_ALLOW_APPS`), `--allow-urls <regex>` (`APPDYNO_ALLOW_URLS`), `--no-home`;
`APPDYNO_SECRETS=a,b` are never shown back or put on the clipboard.
