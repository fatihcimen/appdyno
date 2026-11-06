# Local CI

`scripts/ci.sh` runs every gate in order and stops nothing early: each step's exit code and duration go to
`.ci/runs/<stamp>.json`, its output to `.ci/logs/`. The script exits 1 when any step failed, and 3 when none did and a
measuring step was postponed, as what never ran is no pass.

| step                                   | what                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| install, format, lint, typecheck, unit | `pnpm install --frozen-lockfile`, prettier, eslint, tsc, vitest (`--maxWorkers=2`)    |
| agent                                  | Gradle: the agent's unit tests, the agent and the fixture app                         |
| build                                  | `pnpm build` (packages the agent)                                                     |
| fixture-install, device-functional     | with `--device <serial>`: the fixture app, then the contract, smoke and stdio suites  |
| device-perf                            | the measurement accuracy suite (a measuring step)                                     |
| latency, regression-gate               | with `--nightly`: the latency suite (`appdyno bench`, n = 30) and the gate            |
| runner-core                            | the iOS runner's Swift core (`swift test`), where Xcode is                            |
| ios-build, ios-functional, ios-perf    | with `--ios <simulator id>`: the runner, the contract and stdio suites, perf accuracy |
| iphone-build, iphone-functional        | with `--iphone <UDID>`: the runner for phones, the iPhone suites (signing variables)  |
| a step for each file                   | with `--all-on <serial>`: every suite that device can take                            |

**Which suites run where.** No device suite runs by itself: each gates on a variable, and every one a run must take has to be named.

| where                                 | what runs                                                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`, each push | lint, types, unit tests, the agent's unit tests and build, the runner's core. **No device suite**, so a device suite's own rot is seen only below        |
| `scripts/ci.sh`, no option            | the same, on this Mac                                                                                                                                    |
| `--device <serial>`                   | `android`, `smoke`, `mcp-stdio`, then `perf`                                                                                                             |
| `--ios <simulator id>`                | `ios`, `mcp-stdio`, then `ios-perf`                                                                                                                      |
| `--iphone <UDID>`                     | `iphone`, `iphone-mcp`. Needs `APPDYNO_IPHONE_FIXTURE_APP` and refuses to start without it: with no fixture its measures would skip and the step read ok |
| `--all-on <serial>`                   | every file that reads that device's variable, one step each, so that nobody has to remember them: 42 on Android, 32 on a simulator, 17 on an iPhone      |
| only when named, each by its own gate | `hub.clients`, `hub.connect`, `hub.connect.sim`, `hub.driving`, `hub.room`, `mirror.pair`, `trace-temp`: their variables are at the head of each file    |

`--all-on` takes the kind of device from the id it is given, and asks nothing else of it. It runs what can reach a device you own, so give it no other: its suites install, crash and reset the fixture, and some change settings and put them back.

A vitest run that skips every test exits 0, so a step reads what the run reports. A suite named by `--device`, `--ios` or `--iphone` that ran nothing is a failure, with exit 3 in its step. Under `--all-on` such a file reads `none` and fails nothing, as a sweep takes files with a further gate of their own, and the log names what skipped; a file that ran and failed still fails the run.

**Mirror.** `test-device/mirror.simulator.test.ts` and `mirror.android.test.ts`, with the same variables, are
headless. `APPDYNO_MIRROR_WINDOW=1` adds the one real window, closed right after. `APPDYNO_MIRROR_RESTART=1` shuts the named simulator down under its window and boots it, and `APPDYNO_MIRROR_RESTART_AVD=<avd>` kills the named emulator under its stream and boots that AVD by `simulator`'s path: each costs a whole boot of a device you own. A person is needed for these,
and no suite does them: unplug a phone during a stream; unlock a phone with a passcode; an Android phone locked behind a PIN, where `DEVICE_LOCKED` was proved on an emulator only, as no suite sets a PIN on a person's phone; sleep and wake the Mac;
a `hand_off` with no window, which sounds and sends a notification; a `hand_off` on a window, with its sound; on an
iPhone, the camera or a call during a stream, Device Hub holding a stream, and a passcode-locked phone; typing into a
window a person has clicked, as a test's window never holds the keyboard.

`test-device/mirror.iphone.test.ts` (`APPDYNO_IPHONE_UDID`) runs from what is built, as the stream's thread cannot start
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
- The first publish needs an `NPM_TOKEN` secret, as a package must exist before it can have a trusted publisher. After it, add `release.yml` as the trusted publisher on npmjs.com and remove the secret. The publish job's Node 24 has an npm that can do this.

Before a tag, from a node whose folder has no pnpm, `node scripts/check-package.mjs` installs the tarball on an empty home. It stays out of the workflow, as it refuses to run where a JDK is on its path.

`scripts/check-update.mjs` runs `update` and its verification for real, on public packages in a temporary folder, with no change to this machine: a release with provenance, one without, one whose dependency alone has it, a tampered registry, and a failed install under npm and under pnpm. It needs the network and npm 11.12 or newer.

## The performance gate on a pull request

[`perf-gate.yml`](perf-gate.yml) is a job to copy to `.github/workflows/perf-gate.yml`. Set the values under its `env`: the app, the flow, the simulator and how the app builds.

**Real measurement needs a real device.** The job runs on a macOS runner with a simulator, so its numbers are relative to that runner, and real frame rates, frozen frames, hitches and energy need a phone. What it does is catch a change between two builds on one machine, and say why.

It measures the pull request's base and head in one job, as a baseline from another machine does not compare:

1. builds the base, measures the flow until three runs are in the baseline, and takes the [reference](perf.md#why-it-got-worse);
2. builds the head and measures the flow;
3. `appdyno perf why`, which fails the job at its end on a regression, a broken budget or a change it could not judge (`few-samples`, `noisy`, `refused`);
4. `appdyno perf comment --out perf-comment.md`, whatever the gate said;
5. uploads that file, and posts it with `gh pr comment` and the repository's own token.

appdyno has no service and no token, and posts nothing: it writes a file, and your job posts it. A pull request from a fork gets a token that cannot comment, so there the comment is only in the job's artifacts. A new comment is written each time, as `gh pr comment --edit-last` edits the token's last comment, which may be another workflow's.

**What to expect of a runner.** A change seen under load says `noisy` and fails the job, with the words to measure again, and a run under load is refused as a baseline. GitHub's arm64 runners have 3 cores, so that is a load over 2.4, as a build leaves behind, which is why the job measures until three are in. A new simulator works by itself at first too: about 3 minutes and 7 cores on an M5 Pro, with iOS 27.2, so the job waits for the load first, and again after each build it measures in. `macos-latest` is an arm64 runner, and [those have no nested virtualization](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), so an Android emulator needs an Intel label or a Mac of your own. The job's simulator is new, and a new simulator asks once whether a link may open the app, which stops a flow at its first `open_link`: answer that once before the first measured run, or reach the screen by its buttons.

### The Mac app

`scripts/build-app.mjs` makes `Appdyno.app`, its disk image and a cask in `.app-build`, and prints what each part weighs. With no secrets it signs ad hoc. These turn on the rest, as secrets of the repository of the same name:

| secret                                                                      | what it does                                                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `APPDYNO_CERTIFICATE`, `APPDYNO_CERTIFICATE_PASSWORD`                       | a Developer ID Application certificate, a base64 `.p12`, for the release's keychain |
| `APPDYNO_SIGN_IDENTITY`                                                     | that identity's name: signs for release, and then needs the three below             |
| `APPDYNO_NOTARY_APPLE_ID`, `APPDYNO_NOTARY_PASSWORD`, `APPDYNO_NOTARY_TEAM` | notarizes and staples the disk image                                                |
| `APPDYNO_UPDATE_KEY`                                                        | an Ed25519 private key, PEM: signs the appcast, and its public half goes in the app |

`openssl genpkey -algorithm ed25519` makes an update key. Keep it: an app can only ever verify releases signed by the key it was built with, so losing it means people reinstall by hand. An identity is only ever taken from these variables, never found on the machine.

`scripts/check-app.mjs` meets the app as a stranger does: a clean home and a PATH with no Node and no developer tools, where each would-be tool is a decoy that tells if it was reached. It downloads adb, opens the hub, updates from a real disk image, refuses a tampered one, and moves the app. `--android <serial>` adds a window on that device, with frames recorded. It needs the network, and windows stay behind.
