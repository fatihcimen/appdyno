# CI and releases

[Türkçe](ci.tr.md)

`scripts/ci.sh` runs every gate in order and stops nothing early: each step's exit code and duration go to
`.ci/runs/<stamp>.json`, its output to `.ci/logs/`. The script exits 1 when any step failed, and 3 when none did and a
measuring step was postponed, as what never ran is no pass.

| step                                   | what                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| install, format, lint, typecheck, unit | `pnpm install --frozen-lockfile`, prettier, eslint, tsc, vitest (`--maxWorkers=2`)    |
| agent                                  | Gradle: the agent's unit tests, the agent and the fixture app                         |
| build                                  | `pnpm build` (packages the agent when it was built)                                   |
| fixture-install, device-functional     | with `--device <serial>`: the fixture app, then the contract, smoke and stdio suites  |
| device-perf                            | the measurement accuracy suite (a measuring step)                                     |
| latency, regression-gate               | with `--nightly`: the latency suite (`appdyno bench`, n = 30) and the gate            |
| runner-core                            | the iOS runner's Swift core (`swift test`), where Xcode is                            |
| ios-build, ios-functional, ios-perf    | with `--ios <simulator id>`: the runner, the contract and stdio suites, perf accuracy |
| iphone-build, iphone-functional        | with `--iphone <UDID>`: the runner for phones, the iPhone suites (signing variables)  |
| a step for each file                   | with `--all-on <serial>`: every suite that device can take                            |

**Which suites run where.** No device suite runs by itself: each gates on a variable, and every one a run must take has to be named.

| where                                 | what runs                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`, each push | lint, types, unit tests, the agent's unit tests and build, the runner's core. **No device suite**, so a device suite's own rot is seen only below                   |
| `scripts/ci.sh`, no option            | the same, on this Mac                                                                                                                                               |
| `--device <serial>`                   | `android`, `smoke`, `mcp-stdio`, then `perf`                                                                                                                        |
| `--ios <simulator id>`                | `ios`, `mcp-stdio`, then `ios-perf`                                                                                                                                 |
| `--iphone <UDID>`                     | `iphone`, `iphone-mcp`. Needs `APPDYNO_IPHONE_FIXTURE_APP` and refuses to start without it: with no fixture its measures would skip and the step read ok            |
| `--all-on <serial>`                   | every file that reads that device's variable, one step each, so that nobody has to remember them: 47 on Android, 38 on a simulator, 19 on an iPhone                 |
| only when named, each by its own gate | `hub.clients`, `hub.connect`, `hub.connect.sim`, `hub.driving`, `hub.room`, `hub.shared`, `mirror.pair`, `trace-temp`: their variables are at the head of each file |

`--all-on` takes the kind of device from the id it is given, and asks nothing else of it. It runs what can reach a device you own, so give it no other: its suites install, crash and reset the fixture, and some change settings and put them back.

A vitest run that skips every test exits 0, so a step reads what the run reports. A suite named by `--device`, `--ios` or `--iphone` that ran nothing is a failure, with exit 3 in its step. Under `--all-on` such a file reads `none` and fails nothing, as a sweep takes files with a further gate of their own, and the log names what skipped; a file that ran and failed still fails the run.

**Mirror.** `device-tests/mirror.simulator.test.ts` and `mirror.android.test.ts`, with the same variables, are
headless. `APPDYNO_MIRROR_WINDOW=1` adds the one real window, closed right after. `APPDYNO_MIRROR_RESTART=1` shuts the named simulator down under its window and boots it, and `APPDYNO_MIRROR_RESTART_AVD=<avd>` kills the named emulator under its stream and boots that AVD by `simulator`'s path: each costs a whole boot of a device you own. A person is needed for these,
and no suite does them: unplug a phone during a stream; unlock a phone with a passcode; an Android phone locked behind a PIN, where `DEVICE_LOCKED` was proved on an emulator only, as no suite sets a PIN on a person's phone; sleep and wake the Mac;
a `hand_off` with no window, which sounds and sends a notification; a `hand_off` on a window, with its sound; on an
iPhone, the camera or a call during a stream, Device Hub holding a stream, and a passcode-locked phone; typing into a
window a person has clicked, as a test's window never holds the keyboard.

`device-tests/mirror.iphone.test.ts` (`APPDYNO_IPHONE_UDID`) runs from what is built, as the stream's thread cannot start
from sources: `pnpm build` first. It reads the screen before each touch.

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

A tag publishes, and nothing else does. `.github/workflows/release.yml` runs on `v1.2.3`: `ci.yml` as its gate, then a check that the tag is the version in `packages/appdyno/package.json`, the agent and the package built, the Mac app, `npm publish --provenance --access public`, and a GitHub release with the disk image, the cask and the appcast.

Before the first release:

- The repository must be public. npm generates no provenance for a private one, even for a public package, and `appdyno update` refuses a release with none.
- `repository` in `packages/appdyno/package.json` must match it, case included. npm checks this when it publishes, and `update` holds every release to that address, so a release built elsewhere is refused.
- The first publish needs an `NPM_TOKEN` secret, as a package must exist before it can have a trusted publisher. After it, add `release.yml` as the trusted publisher on npmjs.com and remove the secret. The publish job's Node 26 has an npm that can do this.

Before a tag, from a node whose folder has no pnpm, `node scripts/check-package.mjs` installs the tarball on an empty home. It stays out of the workflow, as it refuses to run where a JDK is on its path.

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

**The hardened runtime.** Every binary is signed with it, and one holds an entitlement: Node has `com.apple.security.cs.allow-jit`, because V8 writes the code it runs. Nothing else needs one. A build signed with the Developer ID and not notarized was run on macOS 27, on a simulator: Node's JIT, WebAssembly and a worker; the viewer loading CoreSimulator by path, which library validation allows because Apple signed it; `TextScan`; the server driving Settings over MCP with its helpers; and `adb` as a child. Loading a library signed by anyone else would need `disable-library-validation`.

`openssl genpkey -algorithm ed25519` makes an update key. Keep it: an app can only ever verify releases signed by the key it was built with, so losing it means people reinstall by hand. An identity is only ever taken from these variables, never found on the machine.

`scripts/check-app.mjs` meets the app as a stranger does: a clean home and a PATH with no Node and no developer tools, where each would-be tool is a decoy that tells if it was reached. It downloads adb, opens the hub, updates from a real disk image, refuses a tampered one, and moves the app. `--android <serial>` adds a window on that device, with frames recorded. It needs the network, and windows stay behind.
