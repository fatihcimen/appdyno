# Documentation

appdyno drives and measures iOS and Android apps from your Mac. New here? Start with the [README](../README.md).

## Guides

Each one takes you through a task.

| guide                                          | read it to                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| [Connecting a client](guides/clients.md)       | join appdyno to your MCP client and get a phone ready, signing included       |
| [İstemci bağlama](guides/clients.tr.md)        | aynı rehber, Türkçe                                                           |
| [Flows](guides/flows.md)                       | record what an agent did, replay it with no model, run it in CI               |
| [Evidence](guides/evidence.md)                 | leave a video, a report, a network log or a visual diff behind                |
| [Measuring performance](guides/performance.md) | measure an app, keep a baseline, and fail a pull request that makes it slower |

## Reference

Look things up here.

| reference                                     | what it holds                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| [Tools](reference/tools.md)                   | every tool, and what each platform can and cannot do                   |
| [Command line](reference/cli.md)              | every command, and the server's flags and variables                    |
| [Library](reference/library.md)               | driving a device from TypeScript                                       |
| [The window and the hub](reference/mirror.md) | the live window: what feeds it, its states, its wire, its limits       |
| [Performance](reference/perf.md)              | what each measure reads on each device, and how each number was proved |
| [Protocol](reference/protocol.md)             | the bytes between the host and a device's agent                        |
| [CI and releases](reference/ci.md)            | every gate, the device suites, how a release is made                   |

## How it works

[Architecture](architecture.md) says how the parts fit and why, for someone about to change them.

[CONTRIBUTING](../CONTRIBUTING.md) says how to set up, run the checks and send a change. [SECURITY](../SECURITY.md) says what appdyno can reach, and how to report a problem.
