# Local CI

`scripts/ci.sh` runs every gate in order and stops nothing early: each step's exit code and duration go to
`.ci/runs/<stamp>.json`, its output to `.ci/logs/`. The script exits 1 when any step failed.

| step                                   | what                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| install, format, lint, typecheck, unit | `pnpm install --frozen-lockfile`, prettier, eslint, tsc, vitest (`--maxWorkers=2`)   |
| agent                                  | Gradle: the agent's unit tests, the agent and the fixture app                        |
| build                                  | `pnpm build` (packages the agent)                                                    |
| fixture-install, device-functional     | with `--device <serial>`: the fixture app, then the contract, smoke and stdio suites |
| device-perf                            | the measurement accuracy suite (a measuring step)                                    |
| latency, regression-gate               | with `--nightly`: the latency suite (`appdyno bench`, n = 30) and the gate      |

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
```
