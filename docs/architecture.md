# Architecture

[Türkçe](architecture.tr.md)

This page is for someone about to change appdyno. It says how the parts fit, and why they are shaped this way. Once you have read it, the folder you need should be easy to find.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/overview.dark.svg">
  <img src="images/overview.svg" alt="An AI agent, a person or a script asks; appdyno on your Mac drives, shows, measures and keeps; it reaches simulators, emulators and phones">
</picture>

appdyno runs on your Mac and nowhere else. There is no service, no daemon and no telemetry. Each command, MCP server or window is a process of its own, and processes share a device through a small file that says who holds it.

## The packages

Everything in TypeScript lives in `packages/`. A package may import only what lies below it here.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/package-map.dark.svg">
  <img src="images/package-map.svg" alt="The package map: appdyno on top; mcp, cli and hub above ops; ops above flows and perf; core and protocol at the bottom; the two drivers named only by the top package">
</picture>

| package          | what it holds                                                                 |
| ---------------- | ----------------------------------------------------------------------------- |
| `protocol`       | Every message between the host and a device, as a schema. Depends on nothing. |
| `core`           | The `Device` port, reading a screen, the mirror session, state files.         |
| `driver-android` | adb, the Android agent, Android's measures.                                   |
| `driver-apple`   | Simulators and iPhones, the runner, the helpers, Apple's measures.            |
| `flows`          | The `.flow` format: parse, record, replay, export.                            |
| `perf`           | Records of a measurement, the gate, the dashboard. No device.                 |
| `ops`            | The tools. Each one is an `Op`: a name, a schema, a handler.                  |
| `mcp`            | The MCP server, over stdio or Streamable HTTP.                                |
| `cli`            | Command-line parsing, `install`, `update`.                                    |
| `hub`            | Controls windows: the hub's list, recording, measures, a person's input.      |
| `appdyno`        | The one published package. It wires the rest and holds the entry points.      |

Three decisions shape this.

**A tool is written once.** An `Op` in `packages/ops` is a tool to an MCP client, a command on the command line, a step in a flow and a call in the library. So a fix reaches all four, and none of them can drift from the others.

**Only the top package names a driver.** `ops` works against the `Device` port in `core`. `appdyno/src/providers.ts` is the one place that hands it the Android and Apple drivers. That keeps the two platforms from leaning on each other, and it is why a new platform is one package. [CONTRIBUTING](../CONTRIBUTING.md#a-new-platform) lists what else it touches.

**One package ships.** `packages/appdyno/scripts/bundle.mjs` inlines the workspace and every dependency into `dist`, so an install needs no other package. The rest are `private`. You import across packages by name, and the rules below hold those imports to the map.

## A tool call

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/tool-call.dark.svg">
  <img src="images/tool-call.svg" alt="A tool call: the client calls tap; mcp passes it to the tool in ops; the tool reads the screen, then sends one act request through the driver to the agent; the agent waits for the screen to settle and answers">
</picture>

What an agent does most is look, act, and look again. Most of the design serves that loop.

**The answer holds the screen.** An action returns the settled screen, as a diff of what changed, so a client needs no second call to see what happened. `settled` says the screen went still. `changed` says it differs from before.

**The side nearest the screen decides when it is still.** The agent or runner watches the screen and answers once it has been quiet for 200 ms, within 3 s. Doing that on the device needs no round trips, and the wire stays quiet while nothing moves. A simulator with no runner does the same on the Mac, in `simsettle.ts`, with timings of its own: a read costs about 30 ms there, so it can look more often. [The protocol](reference/protocol.md#settle) has the rules and what the window catches.

**A selector is resolved late.** A target is found on a fresh read, just before the touch. A screen that moved in between cannot send it to the wrong place. Several matches are refused, with their refs. A guess would look like success.

**A refusal teaches.** A failed call is an `isError` answer with a `code` and a `hint`, and a failed action says whether its touch went out. Arguments are checked strictly when they arrive, and what a server may touch is set by its flags, never by a tool call.

Each platform has its own way in. All of them speak the same protocol, except where a simulator needs no agent at all.

| device    | what runs there                                       | how the Mac reaches it                                   |
| --------- | ----------------------------------------------------- | -------------------------------------------------------- |
| Android   | the agent, an `app_process` running as the shell user | an abstract socket, through the adb server, with a token |
| simulator | nothing at first: helpers on the Mac read and touch   | helpers; the runner starts behind them once it is chosen |
| iPhone    | the runner, an XCTest bundle                          | `usbmuxd`                                                |

## A window

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/touch-and-frame.dark.svg">
  <img src="images/touch-and-frame.svg" alt="A touch and a picture: each device feeds the window its own way; a touch always goes from the window to Node, then to the device">
</picture>

A window has to feel like the device. That sets its shape.

**The window is native, and Node is the control plane.** The viewer in `mac/Viewer` is Objective-C, one process per window, compiled by `clang` on first use. It decodes and draws. Node starts and stops streams, carries input, and names what is wrong. They speak one line of JSON at a time, on the viewer's stdin and stdout. [The wire](reference/mirror.md#the-wire) lists every message.

**A picture takes the shortest way there is.** On an Android phone the viewer connects to the agent by itself, so Node never sees a frame. A simulator shares its surface, and an emulator fills a file. Node has a part in those only to say a new frame is there. An iPhone is the exception: its stream is held by a worker thread of the Node process, which writes to a named pipe.

**A touch takes one path, and a person's input never waits.** Every touch goes through `MirrorSession` and the device's `Mirror.input`. On Android that is a connection of its own, so a finger does not queue behind what a driver is doing.

A person and an agent can use a device at once. An agent's calls go through the driver, and a person's input through the window's session. What the hub adds is in `packages/hub`, and it only queues work beside a touch, never in front of one.

## Measuring

Every measure is read from the platform's own tools, and kept with the raw output it came from. A number that cannot be read is refused by name, never reported as zero. [What works where](reference/perf.md#what-works-where) says what each device can read.

A run becomes a set of records in `packages/perf`, and a baseline is a set of runs. The gate compares them in one function, `compareMetric`, in this order.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/perf-gate.dark.svg">
  <img src="images/perf-gate.svg" alt="How the gate decides: seven questions in order, each ending in a verdict: new, refused, ok, few-samples, improvement, noisy or regression">
</picture>

The order is the point. A change must pass a floor, and a rank test, and the baseline's own run-to-run movement. Samples of one run share its load and heat, so two runs of an unchanged app often differ significantly by a rank test alone. [The gate](reference/perf.md#the-gate) has the rates with and without each part.

A gate that cannot judge must not pass. So `few-samples`, `noisy` and `refused` all exit 1.

## Native code

| folder           | language    | what it is                                                        |
| ---------------- | ----------- | ----------------------------------------------------------------- |
| `android/agent`  | Kotlin      | The on-device agent: the tree, input, settling, the video stream. |
| `ios/Runner`     | Swift       | The XCTest runner, on a simulator or a phone.                     |
| `ios/RunnerCore` | Swift       | What the runner decides with no device, tested with `swift test`. |
| `ios/SimHelper`  | Objective-C | Helpers a simulator needs: touch, accessibility, launch, probes.  |
| `mac/Viewer`     | Objective-C | The window and the hub.                                           |
| `mac/App`        | mixed       | The Mac app's shell: menu bar, launcher, icon, cask.              |
| `mac/TextScan`   | Objective-C | `TextScan`, which reads the words of a screen with no tree.       |

`android/fixture` and `ios/Fixture` are test apps. Each has known costs built in, so a measure can be checked against a truth: a screen that draws for 40 ms, a 50 MB allocation, a 500 ms stall.

## State

| what                                | where                                              |
| ----------------------------------- | -------------------------------------------------- |
| who holds a device, agent addresses | `~/Library/Caches/appdyno`, or `APPDYNO_STATE_DIR` |
| runs, traces                        | under the same folder, or `--measurements`         |
| baselines and budgets               | `.appdyno/perf/` in your project, to commit        |

A claim on a device holds a pid and a start time, so a dead owner's claim is no claim, and there is nothing to clean up after a crash. Each unit-test run gets a folder of its own, and cannot reach your real state.

## What the tests hold

Rules that matter are tests, so they cannot go stale in silence.

| test                                          | it holds                                                            |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `packages/appdyno/test/boundaries.test.ts`    | The package map: what each package may import.                      |
| `packages/appdyno/test/structure.test.ts`     | 450 lines to a file, and no run of 8 lines twice.                   |
| `packages/appdyno/test/function-size.test.ts` | 200 lines to a function.                                            |
| `packages/mcp/test/catalog.test.ts`           | The catalog's size, and that the docs list every tool.              |
| `packages/protocol/test/native.test.ts`       | The Kotlin, Swift and TypeScript sides agree on the protocol.       |
| `packages/appdyno/test/docs.test.ts`          | Every link in the docs resolves, and these diagrams match the code. |

Device suites live in `device-tests`. They need a device you name, and CI runs none of them: see [the CI page](reference/ci.md).

**How the diagrams stay true.** Each is hand-written SVG in `docs/images`, with no generator, in four files: `X.svg` light and `X.dark.svg` dark, and `X.tr.svg` and `X.tr.dark.svg` for the Turkish pages. A page shows the light one and the dark one in a `<picture>`, which picks by GitHub's theme. `docs.test.ts` fails when one drifts: a dark file must be its light one in the dark colours and nothing else, the gate's picture must say the gate's constants and a tool call's the settle's times, and any path a diagram names must exist. `boundaries.test.ts` checks the rows of the English package map against the import rules. A route or a layout that changes without a test seeing it is still yours to redraw.
