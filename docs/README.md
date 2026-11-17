# Documentation

[Türkçe](README.tr.md)

appdyno drives and measures iOS and Android apps from your Mac. The [README](../README.md) says what it is and shows it at work.

## Start here

New to appdyno? Three pages, in this order:

1. [Connecting a client](guides/clients.md): install appdyno, join it to your MCP client, and get a simulator, an emulator or a phone ready.
2. [Tools, at a glance](reference/tools.md#at-a-glance): the 28 tools on one screen, and where each one's details are.
3. [Flows](guides/flows.md): save what an agent did, replay it with no model, and run it in CI.

After those, a guide takes you through a task, the reference is for looking things up, and an example runs as it is.

## Guides

Each one takes you through a task.

| guide                                              | read it to                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Connecting a client](guides/clients.md)           | join appdyno to your MCP client and get a phone ready, signing included       |
| [Flows](guides/flows.md)                           | record what an agent did, replay it with no model, run it in CI               |
| [Evidence](guides/evidence.md)                     | leave a video, a report, a network log or a visual diff behind                |
| [Measuring performance](guides/performance.md)     | measure an app, keep a baseline, and fail a pull request that makes it slower |
| [Upgrading from 1.2 to 1.3](guides/upgrade-1.3.md) | move a client, a script or a program to the tool names of 1.3                 |

## Reference

Look things up here.

| reference                                                     | what it holds                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Tools](reference/tools.md)                                   | every tool and its inputs, and what each platform can and cannot do            |
| [How the tools were tested](reference/tools-tested.md)        | what each tool was run on, and what the runs showed                            |
| [Command line](reference/cli.md)                              | every command, and the server's flags and variables                            |
| [Library](reference/library.md)                               | driving a device from TypeScript                                               |
| [The window and the hub](reference/mirror.md)                 | the live window and the hub: every control, pane and state, and their limits   |
| [How the window works](reference/mirror-internals.md)         | how the picture and input travel, the wire, and what was run on which device   |
| [Performance](reference/perf.md)                              | what each measure reads on each device, the gate, and how fast each call is    |
| [How the measures were validated](reference/perf-evidence.md) | each measure against a known cost: on which device, on which day, at what load |
| [Protocol](reference/protocol.md)                             | the bytes between the host and a device's agent                                |
| [CI and releases](reference/ci.md)                            | every check, the device suites, how a release is made                          |
| [The strict lint](reference/lint.md)                          | how the code meets a type-checked rule that leaves a choice                    |

## Examples

Each one runs as it is.

| example                                   | try it to                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| [Shop](examples/shop/README.md)           | find the crash in a checkout with an agent, then keep it fixed with a flow |
| [`perf-gate.yml`](examples/perf-gate.yml) | fail a pull request that makes the app slower, on a GitHub runner          |

## How it works

[Architecture](architecture.md) says how the parts fit and why, for someone about to change them.

[CONTRIBUTING](../CONTRIBUTING.md) says how to set up, run the checks and send a change. [SECURITY](../SECURITY.md) says what appdyno can reach, and how to report a problem.
