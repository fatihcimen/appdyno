# Measuring performance

appdyno reads performance numbers from the device itself, keeps them, and tells you when an app got slower. This guide goes from a first number to a gate on your pull requests.

**Real measurement needs a real device.** An emulator's or a simulator's numbers are relative to your Mac. Real frame rates, frozen frames, hitches and energy need a phone. A simulator is still good for catching a change between two builds on one machine.

## A first number

Ask your agent, or use the command line. `A` is your app's id: `com.example.app`.

```sh
appdyno perf-launch --app A --mode cold --repeats 6     # launch time, with repeats
appdyno perf-snapshot --app A                           # CPU, memory, frames, the device's load
appdyno perf survey --app A                             # every measure on this device, then a page
```

Each run is kept with the raw output it came from. Nothing leaves your Mac.

`perf survey` ends by writing [the dashboard](../reference/perf.md#the-dashboard), one page of an app's numbers on all your devices. `appdyno perf dashboard --open` opens it again.

## A baseline and a gate

A gate compares a run against what you kept before. It needs three runs to know how far your app moves by itself.

```sh
appdyno perf-launch --app A --mode cold --repeats 6     # three times, then:
appdyno perf baseline --app A --last 3
appdyno perf-launch --app A --mode cold --repeats 6     # after your change
appdyno perf compare --app A                            # exit 1 on a regression
```

The baseline goes to `.appdyno/perf/baselines/`. Commit it. Limits of your own go in `.appdyno/perf/budgets.json`:

```json
[{ "kind": "launch.ttid_ms", "max": 2000 }]
```

## How the gate decides

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../images/perf-gate.dark.svg">
  <img src="../images/perf-gate.svg" alt="How the gate decides: seven questions in order, each ending in a verdict: new, refused, ok, few-samples, improvement, noisy or regression">
</picture>

A gate that cannot judge does not pass. `few-samples`, `noisy` and `refused` all exit 1, each with what to do. [The gate](../reference/perf.md#the-gate) has the method, and why it needs all three tests.

## Why it got worse

`appdyno perf why --app A` is `compare`, and on a regression it finds the cause. See [Why it got worse](../reference/perf.md#why-it-got-worse).

## A journey

To measure a whole path through your app, record a [flow](flows.md) and [run it with `--measure`](flows.md#a-journey-measured-and-gated). Each step gets its own time, so the gate can name the step that got slower.

```sh
appdyno test flows/login.flow --measure --device <id>       # three times, then:
appdyno perf baseline --app A --scenario journey-login --last 3
appdyno test flows/login.flow --measure --device <id>
appdyno perf compare --app A --scenario journey-login       # exit 1, naming the step
```

## On a pull request

[`perf-gate.yml`](../examples/perf-gate.yml) is a job to copy to `.github/workflows/perf-gate.yml`. Set the values under its `env`: the app, the flow, the simulator and how the app builds.

The job runs on a macOS runner with a simulator, so its numbers are relative to that runner. What it does is catch a change between two builds on one machine, and say why.

It measures the pull request's base and head in one job, because a baseline from another machine does not compare:

1. builds the base, measures the flow until three runs are in the baseline, and takes the [reference](../reference/perf.md#why-it-got-worse);
2. builds the head and measures the flow;
3. `appdyno perf why`, which fails the job at its end on a regression, a broken budget or a change it could not judge (`few-samples`, `noisy`, `refused`);
4. `appdyno perf comment --out perf-comment.md`, whatever the gate said;
5. uploads that file, and posts it with `gh pr comment` and the repository's own token.

appdyno has no service and no token, and posts nothing. It writes a file, and your job posts it. A pull request from a fork gets a token that cannot comment, so there the comment is only in the job's artifacts. Each run writes a new comment, because `gh pr comment --edit-last` edits the token's last comment, which may belong to another workflow.

### What to expect of a runner

- A change seen under load says `noisy` and fails the job, and tells you to measure again. A run under load is refused as a baseline.
- GitHub's arm64 runners have 3 cores, which makes the limit a load of 2.4, and a build leaves more than that behind. That is why the job measures until three runs are in.
- A new simulator is busy by itself at first: about 3 minutes and 7 cores on an M5 Pro with iOS 27.2. So the job waits for the load to fall first, and again after each build.
- `macos-latest` is an arm64 runner, and [those have no nested virtualization](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). An Android emulator needs an Intel label or a Mac of your own.
- A new simulator asks once whether a link may open the app, and that stops a flow at its first `open_link`. Answer it once before the first measured run, or reach the screen by its buttons.
