# Local CI

`scripts/ci.sh` runs every gate in order and stops nothing early: each step's exit code and duration go to
`.ci/runs/<stamp>.json`, its output to `.ci/logs/`. The script exits 1 when any step failed.

| step                                   | what                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| install, format, lint, typecheck, unit | `pnpm install --frozen-lockfile`, prettier, eslint, tsc, vitest (`--maxWorkers=2`)    |
| agent                                  | Gradle: the agent's unit tests, the agent and the fixture app                         |
| build                                  | `pnpm build` (packages the agent)                                                     |
| fixture-install, device-functional     | with `--device <serial>`: the fixture app, then the contract, smoke and stdio suites  |
| device-perf                            | the measurement accuracy suite (a measuring step)                                     |
| latency, regression-gate               | with `--nightly`: the latency suite (`appdyno bench`, n = 30) and the gate       |
| runner-core                            | the iOS runner's Swift core (`swift test`), where Xcode is                            |
| ios-build, ios-functional, ios-perf    | with `--ios <simulator id>`: the runner, the contract and stdio suites, perf accuracy |
| iphone-build, iphone-functional        | with `--iphone <UDID>`: the runner for phones, the iPhone suites (signing variables)  |

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
scripts/ci.sh --ios <simulator id>                 # + iOS simulator (a shared one: APPDYNO_WATCH_SIM in the session guard)
scripts/ci.sh --iphone <UDID>                      # + iPhone (APPDYNO_IOS_PROFILE, _KEYCHAIN, _KEYCHAIN_PASSWORD)
```
