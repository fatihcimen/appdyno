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

| method                            | params                                                                         | result                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `hello`                           | `token`, `protocol`                                                            | agent and device description                                                     |
| `ping`                            | –                                                                              | `uptimeMs`                                                                       |
| `tree.get`                        | `maxDepth?` (128), `maxNodes?` (5000)                                          | `Tree`                                                                           |
| `act`                             | `action`, `settle?`, `read` (`none`/`hash`/`tree`), `before?`                  | `settle?`, `hash?`, `tree?`                                                      |
| `text.set`                        | `text`, `replace`, `submit`, `at?`, `focusTimeoutMs` (2000), `settle?`, `read` | as `act`, plus `mode` (`setText`/`paste`/`keys`), `verified`, `focusMs`          |
| `screenshot`                      | `format` (`jpeg`/`png`), `quality` (80), `maxPx?`                              | `w`, `h`, `format`, `bytes`, plus the image as an attachment                     |
| `app.foreground`                  | –                                                                              | `pkg?`                                                                           |
| `app.target` (iOS)                | `pkg` (bundle id)                                                              | –                                                                                |
| `clipboard.set` / `clipboard.get` | `text` / –                                                                     | – / `text?`                                                                      |
| `orientation.set`                 | `rotation` 0–3 (frozen)                                                        | –                                                                                |
| `animations.set`                  | `off`                                                                          | –                                                                                |
| `rest.wait`                       | –                                                                              | –                                                                                |
| `audit` (iOS)                     | `types?`, `maxIssues` (50)                                                     | `issues`, `truncated`, `elapsedMs`                                               |
| `a11y.read` (Android)             | `maxNodes` (60)                                                                | `tree`, `clips` (`n`, `chars`, `hidden`), `traversal` (`n`, `before?`, `after?`) |
| `wait` (minor 3)                  | `since?`, `timeoutMs`, `minMs?` (300)                                          | `sig`, `changed`, `reads`, `elapsedMs`, `tree?`                                  |
| `cancel`                          | `id`                                                                           | –                                                                                |
| `shutdown`                        | –                                                                              | – (the agent exits)                                                              |

`action` is one of `tap {x,y}`, `doubleTap {x,y}`, `longPress {x,y,durationMs}`, `swipe {from,to,durationMs}`,
`gesture {pointers}` (1–5 fingers, each a list of `{x,y,t}` samples; fingers go down together at their
first sample and up together at their last) and `key {key}` (`back`, `home`, `enter`, `delete`, `tab`,
`appSwitch`, `volumeUp`, `volumeDown`, `power`, `lock`). Coordinates are device pixels.

### Wait

`wait` reads the screen as the settle does, every 80 ms, and answers when its digest `sig` (every node's
class, id, text, description, bounds and flags, and the windows) differs from `since`, no sooner than
`minMs`, with the `tree`. No `since`: it answers after the first read. At `timeoutMs` it answers
`changed: false` with no tree. The host matches on what comes back, so one matcher serves every
selector, ref and check, and a still screen costs one answer. An endless animation answers every `minMs`,
which is no worse than polling. An agent whose capabilities lack `wait` is polled with `tree.get` every
300 ms, as is one whose `wait` fails.

### iOS

The runner is a UI test (`ios/Runner`) serving one TCP port on the loopback; the simulator shares the
Mac's loopback. Coordinates are points (`screen.density` is the scale). It reads and acts on the
`app.target` app while that app is in front, else on the home screen; a system alert over the app is a
second window (type 3, `com.apple.springboard`). There is no back key. iOS sends no accessibility events to
a test, so the settle decides from reads alone. The screen's size comes from the home screen app's frame:
a runner without a launch screen is told 320 x 480 by `UIScreen` on a bigger screen, which marked everything
below it as not visible.

#### Simulators: direct input and reads

A simulator's touches and reads go around the runner where two small helpers (`ios/SimHelper`, compiled with
clang on first use, private API) prove themselves. The runner stays: for the hello, text, screenshots,
clipboard and every case below. `APPDYNO_SIM_DIRECT=off` turns both off, `read` leaves the input to the runner.
`appdyno doctor --serial <simulator>` says whether both answer.

`text.set` goes in as keys on iOS (`mode: keys`): a paste the user did not make brings up the "Allow Paste" alert, which holds it up.
`clipboard.get` answers only what the runner wrote itself, as reading another app's text asks the user; a simulator's is read with
`simctl pbpaste` instead.

iOS has no key to close a keyboard or to open the app switcher. `dismissKeyboard` taps the keyboard's hide key where it
shows one, else a place with no control; the host then reads whether it went and refuses if it did not. `appSwitch` is the home
indicator's slow drag up. The volume, lock and power keys go through direct input on a simulator and through
`XCUIDevice` on a phone, where lock and power use the private `pressLockButton`.

- **Input**, `SimHID` on the Mac: XPC to the simulator's `dtuhidd` (`com.apple.coredevice.feature.remote.hid.digitizer`).
  Tap, long press, swipe, one- and two-finger gestures, and the home, enter, delete and tab keys. A barrier
  after the last event proves a daemon received them; text stays with the runner for Unicode. A touch that
  changed nothing, and that the app has not reported finished (`TouchEventsCompleted`), never got there (a
  Device Hub in Resize Mode swallows touches and reports success): the runner does it again and takes
  over for the session. Portrait only, as that is what was verified; other orientations go to the runner.
- **Reads**, `SimAX` inside the simulator through `simctl spawn`: one request of `XCTAccessibilityFramework`
  `userTestingSnapshotForElement:options:error:` per tree (a rejected depth is halved; children withheld at the
  boundary are read again). The nodes are built as the runner builds them, so refs, hashes and diffs do not depend
  on who read. An answer on a layout not seen yet is compared with the runner's read of it (about 100 ms, once
  per layout): XCUI leaves out what a modal covers, and alone tells which copy of a repeated control a tap
  reaches. Where they differ the runner's is the answer; three differences before a first agreement turn the
  helper off for the session. The helper needs the automation mode a runner leaves
  on: on a boot where no runner ever ran it answers `no-foreground`, after 3-13 s, and the doctor says so. The runner
  is always started first, and a helper read works after it has stopped. `IgnoreAXServerEntitlements` was not needed.
- **The runner answers a read** when the app named is not the primary app (a system alert over it, the home
  screen, the app's launch), when the app shows an alert, when another process's content reaches the screen
  (`AXRemoteElement`: a web page, an extension), when the window does not fill the screen, or when the helper fails.
- **Settle on the host:** as below, each 20 ms and comparing what can be named or acted on, in any order, not the
  system's nameless views: on iOS 26 a glass bar and scroll edge effects come and go for 200 ms after a
  transition. A direct touch is over in 50 ms where XCTest's took 300-600 ms, in which the app had reacted
  before the window began: while nothing has reacted, the window is 500 ms (an alert on screen: 1 s), and once
  something has, 150 ms (120 ms answered with a search bar a push leaves for a moment; 150 and 200 ms did not). Nodes that
  have newly come to stick out over the side of the screen count as busy (at most 1.2 s): a push leaves the old
  page there with no change in the tree until it goes. An alert going away counts as busy for 600 ms, as one
  coming up does for 450 ms. Before a touch the runner still answers `animations.wait`. The app's accessibility reports are
  no settle signal: `RunLoopIsIdle` and `AnimationsNonActive` both answer within 3 ms during a push.
- **`launch`** brings a running app forward as it is (`simctl launch`; `LSApplicationWorkspace` from inside the
  simulator took 800 ms against about 180), and does nothing if it is in front; terminate it first for a fresh start.

### Tree

`windows[]`: `type` (accessibility window type: 1 application, 2 input method, 3 system, 4 overlay),
`pkg`, `layer`, `b` (`[left, top, right, bottom]`), `active`, `focused`.

`nodes[]` in breadth-first order: `p` (parent index, −1 for a window root), `w` (window index), `c`
(class), `id` (resource id; on Android a Compose `testTag` from the node's extras when it has none, no app
change needed), `t` (text; absent while a field shows its hint), `d` (content
description), `h` (hint), `b` (bounds on screen), `f` (flags: visible 1, clickable 2, focusable 4,
focused 8, enabled 16, checked 32, selected 64, editable 128, scrollable 256, password 512, checkable
1024, long-clickable 2048).

Android adds flag 4096 (not important for accessibility: a screen reader skips the node) and 8192 (a
screen reader reads the node with its children as one unit, Android 9+); both are local fields of the node.

`truncated` is true when a limit (depth, nodes, 8 s) or an unreadable node cut the walk short;
`elapsedMs` is the agent's own time; `hash` is the layout digest (class, id and bounds of the visible
nodes of the app's and the system dialogs' windows; text left out, a plain text node vertically only).

### Settle

With `settle {quietMs (200), maxMs (3000)}` the agent, after the action, calls the screen settled once it
has been still for `quietMs`:

- no layout change between two reads ("the same layout": the same visible nodes, class and id, in the
  same order, each within 8 pixels of its place; a plain text node vertically only);
- no layout-moving accessibility event for `quietMs` (focus and text-only events do not count; events
  alone hold the settle for at most twice `quietMs`, as an endless animation never goes quiet);
- nothing busy: there is a screen (between two screens only the status bar exists, for 100 to 500 ms), no
  visible progress indicator, and no application window off the display whose resting place is not known.

Reads load the app, so one happens only when it can decide something. On Android: while there is no screen,
or a window transition runs and has not shown its new window, none at all (the transition comes from WMS,
`syncInputTransactions(true)`, API 31+, asked before a read and again after one that would end the settle, as
a read runs on the app's UI thread after a click it was busy with; this keeps an old window that has no events
yet from passing for a still screen); after a read that saw a change another 40 ms later, as a move without
events shows only in reads; else when the window would be over, or sooner if a layout-moving event arrives.
With `before` known the first read is at the end of the window; after a hold it comes 90 ms later, as a new
window's first layout passes are still landing. A window only changing its bounds is not a layout-moving event
on API 34+.

**Answers during a slide.** On API 34+ an application window of the display's size comes to rest filling the
display, so its nodes' places are given from `getBoundsInWindow`, wherever the window is at the moment: the
answer's content and places are those of the screen at rest. Its visibility is that of the rest as well: a
node wholly past the display's edge counts as visible, one under a window above as not. `settled` keeps its
meaning (the content has been still for the window). `settle.moving` (and `moving` on a tree) says a transition
is still running. Every action and screenshot waits on the device for a running transition to end. Any other window shape, a
visible virtual node on the sliding window (Compose, a web view: no place in the window) and API 33 and below
get no such answer: the agent waits for the end of the slide, then for the window.

On a loaded device the window stretches (up to 4×) by how much slower the agent's own reads are than
their recent best, per node read: a slow device also starts its reaction later.

An answer never shows an empty screen: a read asked for between two screens waits for the next one (2 s on a
display that is on), else the request fails with `NOT_FOUND`, after an action as well.

The window counts from the end of the action, not its start: on iOS a synthesized tap alone takes
300–600 ms, and a window counted from its start was spent before the app had the touch (reactions 300 ms
late were missed 10 of 10 times). The first read is compared with `before` when it names a layout the
agent sent recently (else the first read counts as a change), so an action that changed nothing ends
`quietMs` after it returned. On iOS an actionable tap that changed nothing then watches up to 0.8 s for a
system alert, and the screen is read again after that watch. The settle stops at
`maxMs` after the action; the result says `settled`, the time, the number of reads and the window used.

A tap whose point hits nothing that can react on the screen named by `before` (plain text, an image,
empty space; not a clickable, long-clickable, editable or checkable node or anything inside one, not a
web, map or surface view, not a point over the keyboard or another window) uses an 80 ms window.

What the window catches, measured on the fixture's late-reaction screen (emulator, host load about 10; the 200 ms
row with today's settle at 15 taps per delay, the others with the earlier settle at 50; the window stretches on a
loaded host):

| window           | reactions caught         | missed          |
| ---------------- | ------------------------ | --------------- |
| 200 ms (default) | every delay up to 250 ms | 15/15 at 300 ms |
| 250 ms           | up to 250 ms             | 10/50 at 300 ms |
| 300 ms           | up to 300 ms             | 49/50 at 350 ms |

A reaction that starts later than the window (a network answer, a timer) is not waited for: wait for
the element instead. A touch listener on a view that is not marked clickable is treated as inert; one
reacting within 80 ms is caught (0/50 missed at 30 ms), a slower one is not.

### Animations

`animations.set {off}` (capability `animations`; host: `--animations off`, `APPDYNO_ANIMATIONS=off`, the
fourth `AndroidDevice` argument) sets the three system animation scales to 0. They come back as they were when
the last connection that asked has gone, and if the agent dies first, by a separate shell process watching
it (within a second). The first performance measurement of a session puts them back for the rest of that
session, as a measurement must see what a user sees. `doctor --serial` warns about scales left at 0 (a reboot
in a session leaves them so).

### Accessibility audit

`audit` (host API `device.audit()`) answers the screen's accessibility issues, each with its `type`, the
engine's `rule`, a `message`, the element's box `b` in tap units and the element (`c`, `id`, `d`, `t`):

- iOS: the platform's own audit of the app in front (`performAccessibilityAudit`, Xcode 15+), types
  `contrast`, `elementDetection`, `hitRegion`, `sufficientElementDescription`, `dynamicType`,
  `textClipped`, `trait` (`types` picks some). The runner takes every issue itself, so none becomes a
  test failure. A runner without the capability, or an audit the platform cannot run, answers
  `UNSUPPORTED`.
- Android: the host's checks of one `a11y.read` (the tree; per text node, how many characters have no
  visible place: cut by the frame or replaced by an ellipsis, one call to the app per node, 1.5 s at
  most; the nodes' traversal hints, resolved after the walk, 300 ms at most) and a PNG screenshot: `hitRegion` (a control under 48×48 dp), `contrast` (text under
  4.5:1, 3:1 for text 28 dp tall, from the screenshot's pixels), `imageContrast` (an icon that is
  tapped or named, 12–96 dp, under 3:1), `sufficientElementDescription` (a control, field or icon a
  screen reader cannot name), `duplicateLabel` (controls read alike), `textClipped`. Elements cut by
  the screen or a scrolling container's edge are not measured; nodes not important for accessibility
  are skipped. Colours are read from the middle half of a text's height, 6 dp in from its sides (a
  button's transparent inset is not its colour), and from an icon's inner 70 %. The result carries that
  read (`read`: the tree and its traversal hints) for a caller that works out the screen reader's
  reading order.
- Limits: Compose's ellipsized text is not found (Compose reports its characters' places at another
  scale, all inside the text);
  colours of text over a picture or a gradient are not measured (no clean sample).

## Errors

```json
{ "code": -32008, "message": "…", "data": { "code": "NOT_FOUND", "hint": "…" } }
```

`data.code` is one of `TIMEOUT`, `CANCELLED`, `DEVICE_GONE`, `AGENT_UNAVAILABLE`, `AGENT_CONFLICT`,
`AGENT_VERSION_MISMATCH`, `UNSUPPORTED`, `PERMISSION_REQUIRED`, `NOT_FOUND`, `NO_FOCUS`,
`APP_NOT_RUNNING`, `POLICY_DENIED`, `INVALID_ARGUMENT`, `STALE`, `INTERNAL`; the JSON-RPC code is −32000 minus its
index in that list. `AMBIGUOUS`, `CHECK_FAILED` and `DEVICE_CLAIMED` come after those and are the host's own, never on the wire. `TIMEOUT`, `DEVICE_GONE` and `AGENT_UNAVAILABLE` are worth one retry; the host
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
