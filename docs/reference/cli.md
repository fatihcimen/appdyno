# Command line

[Türkçe](cli.tr.md)

Every tool is also a command, with dashes:

```sh
appdyno devices
appdyno screen --device emulator-5554
appdyno wait-for --selector '{"text":"Done"}'
appdyno tap --help
appdyno --help
```

A tool that has an `action` takes it as its first word: `appdyno record start`, `appdyno network stop`. Every tool command also takes `--json '{...}'` for its arguments as JSON, `--out <file>` for where an image goes, and `--device <serial>`, which selects the device for this command and the next ones run in the same folder. `appdyno <command> --help` lists a command's flags.

Exit code 0 means done, 1 means the call was refused, and 2 means the arguments were wrong. The message carries the same hint an MCP answer has: `tap --text OK`, for one, is told where a selector's words go. The selected device and the last screen a diff is made against are kept between commands in a small file in the state directory (`~/Library/Caches/appdyno`), one for each working directory, so two terminals in two folders do not share a device.

A command that loses data asks on its terminal first, as [Tools](tools.md#what-asks-the-person-first) lists, and `--yes` answers it. With no terminal and no `--yes` it is refused, unless `APPDYNO_ALLOW_DATA_LOSS` allows it, or `APPDYNO_ALLOW_POWER` for the system's power controls.

## Other commands

| command                                                   | what it does                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `mcp`                                                     | the MCP server: see [Server options](#server-options)                                                                 |
| `install [--dry-run] [--yes] [--remove]`                  | adds appdyno to the MCP clients on this Mac, or takes it out                                                          |
| `update [--check]`                                        | moves to the latest release, verified first: see [Keep appdyno current](../guides/clients.md#keep-appdyno-current)    |
| `doctor [--serial S]`                                     | what this Mac and that device lack, and how to fix it                                                                 |
| `devices`, `version`                                      | the connected devices; which version this is                                                                          |
| `hub`, `mirror`                                           | the live window: see [The window and the hub](mirror.md)                                                              |
| `pair`                                                    | pairs this Mac with a phone for Wi-Fi, once                                                                           |
| `ios build`                                               | builds the iOS runners now, not on first use                                                                          |
| `tools install`                                           | fetches the pinned Perfetto trace processor                                                                           |
| `tools install adb --accept-license`                      | fetches Google's platform-tools, for a Mac with no `adb`, and says you accept Google's terms                          |
| `push setup apns\|fcm [--forget]`                         | stores a push service's credentials: see [Tools](tools.md#push-to-a-phone-and-a-simulator-by-apple-and-google)        |
| `test`                                                    | replays flows: see [Flows](../guides/flows.md)                                                                        |
| `timeline`, `flight`                                      | video, touches, frames, requests, the log and memory on one clock, in one file: see [Evidence](../guides/evidence.md) |
| `perf compare\|baseline\|budget\|why\|reference\|comment` | the performance gate: see [Measuring performance](../guides/performance.md)                                           |
| `perf functions\|prune\|dashboard\|survey`                | kept profiles and traces, and the page of every measure: see [Performance](perf.md)                                   |
| `bench --serial S`                                        | times reads, taps and typing on an Android device                                                                     |
| `path [--remove]`                                         | from the Mac app: puts `appdyno` on every shell's PATH, or takes it off                                               |

## Server options

`appdyno mcp [flags]`. Most flags have an environment variable too, and a few settings have only a variable.

| flag                        | environment                         | what                                                                                                                                                        |
| --------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--device S`                | `APPDYNO_SERIAL`                    | adb serial, simulator id or iPhone UDID                                                                                                                     |
| `--app A`                   | `APPDYNO_APP`                       | default app (bundle or package id)                                                                                                                          |
| `--allow-devices RE`        | `APPDYNO_ALLOW_DEVICES`             | only devices whose serial, UDID or name matches; `simulator` boot and shutdown and `use_device` take a simulator's or emulator's name or a model too        |
| `--allow-apps a,b`          | `APPDYNO_ALLOW_APPS`                | only these apps: a touch, a key or typing that would land in another app, and a link that would open one, is refused                                        |
| `--allow-urls RE`           | `APPDYNO_ALLOW_URLS`                | only links that match                                                                                                                                       |
| `--allow-data-loss V`       | `APPDYNO_ALLOW_DATA_LOSS`           | what loses data goes ahead with nothing asked: `virtual` on simulators and emulators, `all` on every device                                                 |
| `--allow-power V`           | `APPDYNO_ALLOW_POWER`               | an input on the system's own power, emergency or erase controls goes ahead with nothing asked: `virtual` on simulators and emulators, `all` on every device |
| `--no-home`                 |                                     | block the keys that leave the app, and Settings by any tool; a touch by x,y that goes home only `--allow-apps` holds                                        |
| `--silent`                  | `APPDYNO_SILENT=1`                  | `hand_off` plays no sound and posts no macOS notification, for CI and a shared Mac: a window shows its banner with no sound                                 |
| `--measurements dir`        |                                     | where measurements are stored (default: `measurements` in the state directory)                                                                              |
| `--takeover`                |                                     | stop another tool that holds UI automation on Android                                                                                                       |
| `--no-install-consent`      | `APPDYNO_NO_INSTALL_CONSENT=1`      | `app install` touches no prompt on the phone: a person answers them all                                                                                     |
| `--accept-install-warnings` | `APPDYNO_ACCEPT_INSTALL_WARNINGS=1` | `app install` passes a Play Protect warning, and always says so and quotes it                                                                               |
| `--share`                   | `APPDYNO_SHARE=1`                   | use a device another process holds                                                                                                                          |
| `--animations V`            | `APPDYNO_ANIMATIONS`                | `off` sets an Android device's animation scales to 0 while it is driven                                                                                     |
| `--trace-limit-gb N`        | `APPDYNO_TRACE_LIMIT_GB`            | what kept traces and heap dumps may take, 10 by default; older ones go, never what a baseline or a recent run names                                         |
| `--flight-seconds N`        | `APPDYNO_FLIGHT_SECONDS`            | how long the flight recorder keeps, 30 s by default, from 20 to 120                                                                                         |
| `--full-urls`               | `APPDYNO_FULL_URLS=1`               | a timeline keeps a request's query too, where a token can ride; a listed secret and what looks like a credential are still hidden                           |
| `--http 127.0.0.1:PORT`     |                                     | Streamable HTTP on this Mac's loopback, not stdio: see below. Off unless given, and no variable turns it on                                                 |

`virtual` is the value for CI. `all` covers real phones too: with `--allow-power all`, a touch on a phone's power-off, emergency-call or erase screen goes ahead with nobody asked. Give `all` only for a test phone that holds nothing you need.

Settings that have only a variable:

| environment                   | what                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APPDYNO_HTTP_TOKEN`          | the token `--http` asks for, 32 characters or more: generated and printed if not set                                                                                       |
| `APPDYNO_STATE_DIR`           | the state directory: `~/Library/Caches/appdyno` by default                                                                                                                 |
| `APPDYNO_TOOLS_DIR`           | where fetched tools are kept, whatever the state directory: `~/Library/Caches/appdyno/tools` by default                                                                    |
| `APPDYNO_PERF_DIR`            | where baselines and budgets are kept: `.appdyno/perf` in the working directory by default, so they can be committed                                                        |
| `APPDYNO_TRACE_PROCESSOR`     | a `trace_processor_shell` to read Android's traces with, in place of the app's and the pinned one fetched                                                                  |
| `APPDYNO_SECRETS=a,b`         | values never shown back or put on the clipboard                                                                                                                            |
| `APPDYNO_FAST_TAP=0`          | the iOS runner taps by XCUI's own tap, which takes about twice as long, in place of XCTest's event synthesizer                                                             |
| `APPDYNO_ANIMATION_WAIT=0`    | an iOS touch goes out with no wait for the app's animations to end                                                                                                         |
| `APPDYNO_HOST_VIRTUAL=0`      | this Mac is read as no virtual machine, whatever macOS says, for one whose load average does say how busy it is: see [What load keeps out of a baseline](perf.md#the-gate) |
| `APPDYNO_IOS_TEAM`            | the Apple team Xcode provisions the iPhone runner for: see [Let Xcode do it](../guides/clients.md#let-xcode-do-it)                                                         |
| `APPDYNO_IOS_PROFILE`         | a provisioning profile for the iPhone runner, with `APPDYNO_IOS_KEYCHAIN` and `APPDYNO_IOS_KEYCHAIN_PASSWORD`                                                              |
| `APPDYNO_EMULATOR_ARGS`       | the emulator's flags when `simulator` boots one: see [Starting a simulator or emulator](tools.md#starting-a-simulator-or-emulator)                                         |
| `APPDYNO_ANDROID_AGENT`       | an Android agent `.apk` to install, in place of this checkout's build or the package's                                                                                     |
| `APPDYNO_IOS_PRODUCTS`        | a folder with the iOS runner built for a simulator and its `.xctestrun`, in place of this checkout's build or one made on first use                                        |
| `APPDYNO_IOS_DEVICE_PRODUCTS` | the same for a phone                                                                                                                                                       |

`--allow-devices` and `--allow-urls` are JavaScript regular expressions, matched anywhere in the text unless anchored: `--allow-urls 'https://staging.example.com'` lets in `https://staging.example.com.evil.test/` and `evilapp://x?u=https://staging.example.com` too. Anchor it: `--allow-urls '^https://staging\.example\.com/'`, where the `/` ends the host, and `--allow-devices '^emulator-5554$'`; `'^emulator-'` lets in every emulator. A list given empty, by flag or variable, is refused at the start, as it would let in every one, and so is a pattern that matches the empty text, as `"$A|$B"` with one of them unset gives.

Without `--takeover`, a second tool holding UI automation on Android is never stopped. The error names the holder by its pid and command line and gives the exact command to stop it.

The server over stdio ends when its client closes stdin, or at SIGTERM or SIGINT, and what its session changed on a device goes back, as [Tools](tools.md) says of each. A client may kill it half a second after it asks it to end, as `claude -p` does with SIGINT, SIGTERM 0.1 s later and SIGKILL after that, where an emulator's text size takes seconds to go back. So at its end the server starts `appdyno mcp --put-back-after <pid> --device <serial>` (a flag between appdyno's own processes, not one to type) for each device it changed, apart from its own process group: that process waits for the server to be gone, then puts back what it left there, as any session's start does, lets an Android device's settings reach its disk, logs a `putBackAfter` line to stderr and exits. A check right after the client exits can still read the changed value for some 5 s.

`--http` is for a client that cannot start a program on this Mac. It listens on loopback and refuses any other address, and it reaches further only through a tunnel you run: there is no service of ours. **Whoever has the address and the token drives your devices**, and reads and writes files here where a tool takes a path. See [Clients in a browser](../guides/clients.md#clients-in-a-browser) before you open one.

A request needs the token, as `Authorization: Bearer <token>` on `/mcp`, or as `/mcp/<token>` for a client with no field for a header, and a token in an address shows in a tunnel's logs. A request with an `Origin` other than the server's own is refused with 403. There is a server per POST and no MCP session, because such a client may open one for each tool call and never say it is done. A client is known by the name it gives: once it has called a tool it holds the context of a stdio session until 10 minutes after its last call, when its conditions go back, and another client is refused with a 409 that names it. A broken connection stops its call. A variable sets the token and no flag does, because a flag would show in `ps`.
