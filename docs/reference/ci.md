# CI and releases

[Türkçe](ci.tr.md)

`scripts/ci.sh` runs every check in order and does not stop at the first failure: each step's exit code and duration go to
`.ci/runs/<stamp>.json`, its output to `.ci/logs/`. The script exits 1 when any step failed, and 3 when none did and a
measuring step was postponed, as what never ran is no pass. It needs `mise` and zsh: each step runs under `mise exec`.

| step                                                | what                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| install, format, lint, lint-native, typecheck, unit | `pnpm install --frozen-lockfile`, prettier, eslint, the native linters (`scripts/lint-native.sh`), tsc, vitest (`--maxWorkers=2`) |
| agent                                               | Gradle: the agent's unit tests, the agent, the fixture app and the push fixture                                                   |
| build                                               | `pnpm build` (packages the agent when it was built)                                                                               |
| fixture-install, device-functional                  | with `--device <serial>`: the fixture app, then the contract, smoke and stdio suites                                              |
| device-perf                                         | the measurement accuracy suite (a measuring step)                                                                                 |
| latency, regression-gate                            | with `--nightly`: the latency suite (`appdyno bench`, n = 30) and the gate                                                        |
| runner-core                                         | the iOS runner's Swift core (`swift test`), where Xcode is                                                                        |
| ios-build, ios-functional, ios-perf                 | with `--ios <simulator id>`: the runner, the contract and stdio suites, perf accuracy                                             |
| iphone-build, iphone-functional                     | with `--iphone <UDID>`: the runner for phones, the iPhone suites (signing variables)                                              |
| a step for each file                                | with `--all-on <serial>`: every suite that device can take                                                                        |

**Which suites run where.** No device suite runs by itself: each gates on a variable, and every one a run must take has to be named.

| where                                                          | what runs                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`, a push to `main` or a pull request | lint, types, unit tests, the agent's unit tests and build, the runner's core, and the simulator smoke: `ios`, `keys`, `views.simulator`, `flows-ci`. **No Android suite**, and no other suite of a simulator, so their rot is seen only below |
| `scripts/ci.sh`, no option                                     | the same, on this Mac                                                                                                                                                                                                                         |
| `--device <serial>`                                            | `android`, `smoke`, `mcp-stdio`, then `perf`                                                                                                                                                                                                  |
| `--ios <simulator id>`                                         | `ios`, `mcp-stdio`, then `ios-perf`                                                                                                                                                                                                           |
| `--iphone <UDID>`                                              | `iphone`, `iphone-mcp`. Needs `APPDYNO_IPHONE_FIXTURE_APP` and refuses to start without it: with no fixture its measures would skip and the step read ok                                                                                      |
| `--all-on <serial>`                                            | every file that reads that device's variable, one step each, so that nobody has to remember them: 50 on Android, 42 on a simulator, 29 on an iPhone                                                                                           |
| only when named, each by its own gate                          | `hub.clients`, `hub.connect`, `hub.connect.sim`, `hub.driving`, `hub.room`, `hub.shared`, `mirror.pair`, `trace-temp`, `soak`: their variables are at the head of each file                                                                   |

`--all-on` takes the kind of device from the id it is given, and asks nothing else of it. It runs what can reach a device you own, so give it no other: its suites install, crash and reset the fixture, and some change settings and put them back.

A vitest run that skips every test exits 0, so a step reads what the run reports. A suite named by `--device`, `--ios` or `--iphone` that ran nothing is a failure, with exit 3 in its step. Under `--all-on` such a file reads `none` and fails nothing, as a sweep takes files with a further gate of their own, and the log names what skipped; a file that ran and failed still fails the run.

**The simulator smoke.** The `sim-smoke` job of `ci.yml` runs `node scripts/sim-smoke.mjs` on GitHub's hosted macOS runner, with the Xcode its image selects: on a pull request, on a push to `main` or to a `ci-trial/**` branch, by hand from the Actions tab, and in a release's gate. The script makes a simulator of its own, the newest iPhone with a plain name on the iOS runtime of that Xcode's SDK, boots it with no window, builds the runner and the fixture, runs the suites and deletes the simulator, whatever happened: `ios.test.ts`, which reads, taps, types and settles on a screen that keeps moving, `keys.test.ts`, `views.simulator.test.ts`, and `flows-ci.test.ts`, which replays flows by the built command line. A suite that ran nothing fails it, with exit 3. It measures nothing, as a hosted runner's timings say nothing of a Mac's. What it leaves is the run's `sim-smoke` artifact, kept 30 days: `report.json`, as vitest wrote it, and `device-summary.md`, which has the device, its OS, the Xcode and the date, and each suite's counts and seconds. The job asks for a token that only reads, publishes nothing and keeps no cache, and on a `ci-trial/**` branch no other job runs. On a Mac the same command runs it, after `pnpm build`.

**Android is not in it.** GitHub's hosted macOS runners are Apple silicon virtual machines with no nested virtualization, so an Android emulator cannot start on one. The Android suites run on a Mac, by `scripts/ci.sh --device` and `--all-on`.

**Mirror.** `device-tests/mirror.simulator.test.ts` and `mirror.android.test.ts`, with the same variables, are
headless. `APPDYNO_MIRROR_WINDOW=1` adds the one real window, closed right after. `APPDYNO_MIRROR_RESTART=1` shuts the named simulator down under its window and boots it, and `APPDYNO_MIRROR_RESTART_AVD=<avd>` kills the named emulator under its stream and boots that AVD by `simulator`'s path: each costs a whole boot of a device you own. A person is needed for these,
and no suite does them: unplug a phone during a stream; unlock a phone with a passcode; an Android phone locked behind a PIN, where `DEVICE_LOCKED` was proved on an emulator only, as no suite sets a PIN on a person's phone; sleep and wake the Mac;
a `hand_off` with no window, which sounds and sends a notification; a `hand_off` on a window, with its sound; on an
iPhone, the camera or a call during a stream, Device Hub holding a stream, and a passcode-locked phone; typing into a
window a person has clicked, as a test's window never holds the keyboard.

`device-tests/mirror.iphone.test.ts` (`APPDYNO_IPHONE_UDID`) runs from what is built, as the stream's thread cannot start
from sources: `pnpm build` first. It reads the screen before each touch.

**Soak.** `device-tests/soak.test.ts` holds one session on one device for half an hour, through the library as a program drives it. Each cycle takes the fixture's screens in an order its seed shuffles: the screen and its raw tree, a form typed into and sent, a list's taps and `scroll_to`, a dialog answered, a turn to landscape and back, the web view read and a script run in it, on iOS the copies under a moving banner, a crash, which the tap or the next read must report and `launch_app` must undo, and the device's agent ended under the session by the pid appdyno's state file keeps: the iOS runner's xcodebuild, or the agent on an Android device. It touches no other process and no other device. Each call's tool, code and time is kept, and each recovery counted: the agents started, each that took another's place, the launches after a crash and after a failure. On Android a crash the tap reported is undone by the system, which starts the app again with its task, so the next read and `launch_app` find it in front. On 2026-11-15 it ran 30 minutes on each, seed 20261115: an iPhone 17 simulator on iOS 26.5, 1312 calls of which none failed, 41 runners ended and 41 crashes each recovered; a Pixel 8 emulator on Android 15, 2900 calls of which none failed, 100 agents ended and 100 crashes each recovered.

`APPDYNO_SOAK_DEVICE` names a simulator, an emulator or an Android phone with the fixture on it, built as the device suites build it: an iOS build made with `CODE_SIGNING_ALLOWED=NO` has its web view listed under another name, where `webview` finds none. `APPDYNO_SOAK_MINUTES` sets the length (30), `APPDYNO_SOAK_SEED` replays an order, `APPDYNO_SOAK_OUT` is where the report goes (else a temporary folder), and `APPDYNO_SOAK_MIN_RATE` is the share of calls that must succeed (99).

```sh
APPDYNO_SOAK_DEVICE=<id> APPDYNO_SOAK_MINUTES=60 pnpm test:device device-tests/soak.test.ts
```

`soak.json` holds every call, and `soak.md` what to read first: the success rate, p50 and p95 of each tool, each fault put in and whether it was reported, the recoveries, each call slower than 3 times its tool's median, the failures, and the host process's memory at the start and the end. The warm-up and the faults put in stay out of the rate and the times. It fails under that rate, or on a fault that was not reported as it should be.

**Regression gate** (`scripts/ci-gate.mjs`): every operation's p50 against the median p50 of the last five
passing runs in `.ci/history.jsonl`; slower by more than 20 % and 10 ms, or any failed operation, fails
the run. Every run is appended to the history with its commit, its environment (host and device load,
GPU mode) and its numbers; a failing run is kept but never becomes a baseline.

**On a shared machine**: measuring steps (device-perf, latency) are skipped while `APPDYNO_BUSY_FILE` exists
and write `APPDYNO_LOCK_FILE` while they run. A device is never chosen by default: `--device` names it.

```sh
scripts/ci.sh                                      # no device
scripts/ci.sh --device emulator-5580               # + device suites
scripts/ci.sh --device emulator-5580 --nightly     # + latency history and gate
scripts/ci.sh --ios <simulator id>                 # + iOS simulator
scripts/ci.sh --iphone <UDID>                      # + iPhone (APPDYNO_IOS_PROFILE, _KEYCHAIN, _KEYCHAIN_PASSWORD, APPDYNO_IPHONE_FIXTURE_APP)
scripts/ci.sh --all-on <serial>                    # + every suite that device can take
```

## Release

A tag publishes, and nothing else does. `.github/workflows/release.yml` runs on `v1.2.3`: `ci.yml` as its gate, the simulator smoke in it, so a tag whose commit failed a device suite there publishes nothing; then a check that the tag is the version in `packages/appdyno/package.json`, the agent and the package built, the desktop extension built and run, the Mac app, the smoke's `device-summary.md` taken from the gate, `SHA256SUMS`, a build provenance for the disk image and the desktop extension, `npm publish --provenance --access public`, and a GitHub release with the disk image, the desktop extension, the cask, the appcast, `device-summary.md` and `SHA256SUMS`. The release notes are written before anything that cannot be taken back, and a run again after a later step failed finds the version on npm and goes on to the release. Run by hand from the Actions tab, `release.yml` is a rehearsal: the gate, the Mac app, signed and notarized, and the desktop extension, kept with the run for 3 days to open, with nothing published and nothing attested.

What a release depends on:

- The repository is public. npm generates no provenance from a private repository, even for a public package, and `appdyno update` refuses a release with none.
- `repository` in `packages/appdyno/package.json` matches it, case included. npm checks this when it publishes, and `update` holds every release to that address, so a release built elsewhere is refused.
- npm takes the publish from `release.yml` as the package's trusted publisher, and by nothing else: the workflow holds no token. [Contributing](../../CONTRIBUTING.md#releases) says how the publisher is set on npmjs.com. It needs npm 11.5.1 or newer, which the publish job checks of its Node 26's npm.

`SHA256SUMS` names every other file of a release with its SHA-256, and GitHub keeps a build provenance for the disk image and the desktop extension, which says the workflow run that built each. With the files of a release in one folder, as many of them as you took:

```sh
shasum -a 256 --ignore-missing -c SHA256SUMS
gh attestation verify appdyno-<version>.mcpb --repo fatihcimen/appdyno
```

Before a tag, from a node whose folder has no pnpm, `node scripts/check-package.mjs` installs the tarball on an empty home. It stays out of the workflow, as it refuses to run where a JDK is on its path.

`node scripts/build-mcpb.mjs` makes the desktop extension, `.app-build/appdyno-<version>.mcpb`: the package as `npm pack` makes it, `packages/appdyno/mcpb/manifest.json` with the tools the packed server lists, and the Mac app's icon at 512 px, packed by `mcpb pack`, which validates the manifest. `node scripts/check-mcpb.mjs` unpacks it and runs its server over stdio by the manifest's own command, on an empty home, with the install form left empty and filled in, and holds what `tools/list` answers to the manifest's tools. The file is not signed: its build provenance says where it was built.

`scripts/check-update.mjs` runs `update` and its verification for real, on public packages in a temporary folder, with no change to this machine: a release with provenance, one without, one whose dependency alone has it, a tampered registry, and a failed install under npm and under pnpm. It needs the network and npm 11.12 or newer.

### The Mac app

`scripts/build-app.mjs` makes `Appdyno.app`, its disk image and a cask in `.app-build`, and prints what each part weighs. With no secrets it signs ad hoc. These turn on the rest, as secrets of the repository of the same name:

| secret                                                                      | what it does                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `APPDYNO_CERTIFICATE`, `APPDYNO_CERTIFICATE_PASSWORD`                       | a Developer ID Application certificate, a base64 `.p12`, for the release's keychain       |
| `APPDYNO_SIGN_IDENTITY`                                                     | that identity's name, the only one `build-app.mjs` takes: signs with the hardened runtime |
| `APPDYNO_NOTARY_APPLE_ID`, `APPDYNO_NOTARY_PASSWORD`, `APPDYNO_NOTARY_TEAM` | notarize and staple the app and its disk image, so that a double click opens them         |
| `APPDYNO_UPDATE_KEY`                                                        | an Ed25519 private key, PEM: signs the appcast, and its public half goes in the app       |

`release.yml` runs it with `--release`, which refuses a build that is not signed and notarized: a disk image on a release opens with a double click. To notarize from a Mac, `xcrun notarytool store-credentials` keeps the password in the keychain and off the process list, and `APPDYNO_NOTARY_PROFILE` names what it stored.

**The disk image's window.** A double click on the disk image opens a window of its own: its background, drawn by `scripts/icon-art.mjs`, the app and Applications where it puts them, and the app's icon on the volume. dmgbuild writes it, in the image's `.DS_Store`, with no Finder and no AppleScript, so a runner with no one at it builds the same. `uvx` runs it from its wheel and those of the two packages it needs, each held to the digest PyPI publishes, and `build-app.mjs` checks what the image holds before it signs it. uv is in `.mise.toml`, and `release.yml` gets the same version by `setup-uv`, held to its digest.

**The hardened runtime.** Every binary is signed with it, and one holds an entitlement: Node has `com.apple.security.cs.allow-jit`, because V8 writes the code it runs. Nothing else needs one. A build signed with the Developer ID and not notarized was run on macOS 27, on a simulator: Node's JIT, WebAssembly and a worker; the viewer loading CoreSimulator by path, which library validation allows because Apple signed it; `TextScan`; the server driving Settings over MCP with its helpers; and `adb` as a child. Loading a library signed by anyone else would need `disable-library-validation`.

`openssl genpkey -algorithm ed25519` makes an update key. Keep it: an app can only ever verify releases signed by the key it was built with, so losing it means people reinstall by hand. An identity is only ever taken from these variables, never found on the machine.

`scripts/check-app.mjs` meets the app as a stranger does: a clean home and a PATH with no Node and no developer tools, where each would-be tool is a decoy that tells if it was reached. It downloads adb, opens the hub, updates from a real disk image, refuses a tampered one, and moves the app. `--android <serial>` adds a window on that device, with frames recorded, and `--iphone <udid>` the same on an iPhone. `--keep` leaves the temporary folder it made, its clean home and what it installed there, and prints where. It needs the network, and windows stay behind.
