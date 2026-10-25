# Host ↔ agent protocol (v1)

The host library talks to an on-device agent over one byte stream: on Android an abstract unix socket
of the agent opened through the adb server (`localabstract:<name>`), later on iOS a TCP connection
(simulator loopback, or a usbmux connection to a phone). The source of truth for message shapes is
`packages/protocol/src/messages.ts`; the Android agent implements the same names in
`android/agent/src/main/kotlin/dev/appdyno/agent/`.

## Frames

```
[u32 BE payload length][u8 type][payload]
```

| type | payload                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------- |
| 0    | one JSON-RPC 2.0 message, UTF-8                                                                     |
| 1    | a binary attachment: `[u32 BE request id][bytes]`, sent right before the JSON response with that id |

A frame larger than 64 MiB, an unknown type or a JSON frame that does not parse ends the connection.

## Handshake

The first request on a connection must be `hello` with the launch token the agent was started with
(`--token`, at least 16 characters, compared in constant time). Anything else closes the connection.

```json
{ "jsonrpc": "2.0", "id": 1, "method": "hello", "params": { "token": "…", "protocol": 1 } }
```

The result names the agent build, the protocol version (`major` must equal the host's; `minor` grows
with additive changes), the platform, OS, model, screen (`w`, `h` in device pixels, `density`,
`rotation`) and `capabilities`. The host only uses what `capabilities` lists.

## Deadlines and cancellation

Every request carries `params._deadlineMs`. The agent answers `TIMEOUT` when the work takes longer and
tells the work to stop (long loops poll a cancel flag; a call blocked inside the framework still returns
when the framework gives up). The host waits one second longer than the deadline, then fails the call
itself and sends `cancel {id}`. Device work runs on one thread in arrival order; `hello`, `ping` and
`cancel` are answered at once.

## Methods

| method                            | params                                                                         | result                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `hello`                           | `token`, `protocol`                                                            | agent and device description                                            |
| `ping`                            | –                                                                              | `uptimeMs`                                                              |
| `tree.get`                        | `maxDepth?` (128), `maxNodes?` (5000)                                          | `Tree`                                                                  |
| `act`                             | `action`, `settle?`, `read` (`none`/`hash`/`tree`), `before?`                  | `settle?`, `hash?`, `tree?`                                             |
| `text.set`                        | `text`, `replace`, `submit`, `at?`, `focusTimeoutMs` (2000), `settle?`, `read` | as `act`, plus `mode` (`setText`/`paste`/`keys`), `verified`, `focusMs` |
| `screenshot`                      | `format` (`jpeg`/`png`), `quality` (80), `maxPx?`                              | `w`, `h`, `format`, `bytes`, plus the image as an attachment            |
| `app.foreground`                  | –                                                                              | `pkg?`                                                                  |
| `clipboard.set` / `clipboard.get` | `text` / –                                                                     | – / `text?`                                                             |
| `orientation.set`                 | `rotation` 0–3 (frozen)                                                        | –                                                                       |
| `cancel`                          | `id`                                                                           | –                                                                       |
| `shutdown`                        | –                                                                              | – (the agent exits)                                                     |

`action` is one of `tap {x,y}`, `longPress {x,y,durationMs}`, `swipe {from,to,durationMs}`,
`gesture {pointers}` (1–5 fingers, each a list of `{x,y,t}` samples; fingers go down together at their
first sample and up together at their last) and `key {key}` (`back`, `home`, `enter`, `delete`, `tab`,
`appSwitch`). Coordinates are device pixels.

### Tree

`windows[]`: `type` (accessibility window type: 1 application, 2 input method, 3 system, 4 overlay),
`pkg`, `layer`, `b` (`[left, top, right, bottom]`), `active`, `focused`.

`nodes[]` in breadth-first order: `p` (parent index, −1 for a window root), `w` (window index), `c`
(class), `id` (resource id), `t` (text; absent while a field shows its hint), `d` (content
description), `h` (hint), `b` (bounds on screen), `f` (flags: visible 1, clickable 2, focusable 4,
focused 8, enabled 16, checked 32, selected 64, editable 128, scrollable 256, password 512, checkable
1024, long-clickable 2048).

`truncated` is true when a limit (depth, nodes, 8 s) or an unreadable node cut the walk short;
`elapsedMs` is the agent's own time; `hash` is the layout digest (class, id and bounds of the visible
nodes of the app's and the system dialogs' windows; text left out, a plain text node vertically only).

### Settle

With `settle {quietMs (200), maxMs (3000)}` the agent, after the action, reads the layout every 80 ms
and calls the screen settled once it has been still for `quietMs`:

- no layout change between two reads ("the same layout": the same visible nodes, class and id, in the
  same order, each within 8 pixels of its place; a plain text node vertically only);
- no layout-moving accessibility event for `quietMs` (focus and text-only events do not count; events
  alone hold the settle for at most twice `quietMs`, as an endless animation never goes quiet);
- nothing busy: no visible progress indicator, and no application window sticking out of the display (a
  window sliding in is reported frozen at a midway place until its animation ends).

On a loaded device the window stretches (up to 4×) by how much slower the agent's own reads are than
their recent best, per node read: a slow device also starts its reaction later.

The first read is compared with `before` when it names a layout the agent sent recently (else the first
read counts as a change), so an action that changed nothing ends after `quietMs`. The settle stops at
`maxMs` after the action; the result says `settled`, the time and the number of reads.

## Errors

```json
{ "code": -32008, "message": "…", "data": { "code": "NOT_FOUND", "hint": "…" } }
```

`data.code` is one of `TIMEOUT`, `CANCELLED`, `DEVICE_GONE`, `AGENT_UNAVAILABLE`, `AGENT_CONFLICT`,
`AGENT_VERSION_MISMATCH`, `UNSUPPORTED`, `PERMISSION_REQUIRED`, `NOT_FOUND`, `NO_FOCUS`,
`APP_NOT_RUNNING`, `POLICY_DENIED`, `INVALID_ARGUMENT`, `INTERNAL`; the JSON-RPC code is −32000 minus its
index in that list. `TIMEOUT`, `DEVICE_GONE` and `AGENT_UNAVAILABLE` are worth one retry; the host
retries read-only requests itself once on a fresh connection, never an action (it may have happened).

## Android agent lifecycle

The host pushes the agent APK (`/data/local/tmp/appdyno/agent-<sha256 prefix>.apk`, only when that
build is not there) and starts it as the shell user:

```
CLASSPATH=<apk> app_process / dev.appdyno.agent.Main --socket appdyno_<random> --token <random>
```

The socket name and token are kept in a state file readable only by the user
(`~/Library/Caches/appdyno/android-<serial>.json`, or `APPDYNO_STATE_DIR`), so the next host
process reconnects in one round trip. A different build on the device is stopped (by its process id,
only when its command line is the agent's) and replaced. The agent exits after 30 minutes without a
connection. Exit code 3 with `AGENT_CONFLICT` on stderr: another UI automation client holds the device
(a device has exactly one).
