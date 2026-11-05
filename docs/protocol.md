# Host ↔ agent protocol (v2)

The host library talks to an on-device agent over one byte stream: on Android an abstract unix socket
of the agent opened through the adb server (`localabstract:<name>`), later on iOS a TCP connection
(simulator loopback, or a usbmux connection to a phone). The source of truth for message shapes is
`packages/protocol/src/messages.ts`. The host parses a request's params by it, so a default there is what goes on
the wire and an agent has none of its own: a value missing is `INVALID_ARGUMENT`. `packages/protocol/fixtures` has
every request, result and error as canonical JSON, which the protocol's tests hold to the schemas and the Android
agent's and the iOS runner's tests read through their own code; `packages/protocol/test/native.test.ts` compares the
error codes, node flags and version the three of them write down.

## Frames

```
[u32 BE payload length][u8 type][payload]
```

| type | payload                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------- |
| 0    | one JSON-RPC 2.0 message, UTF-8                                                                     |
| 1    | a binary attachment: `[u32 BE request id][bytes]`, sent right before the JSON response with that id |
| 2    | a video frame, device to host only: `[u64 BE capture us][u64 BE sent ns][u32 BE flags][bytes]`      |

A frame larger than 64 MiB, an unknown type or a JSON frame that does not parse ends the connection.

## Handshake

The first request on a connection must be `hello` with the launch token the agent was started with
(`--token`, at least 16 characters, compared in constant time). Anything else closes the connection.

```json
{ "jsonrpc": "2.0", "id": 1, "method": "hello", "params": { "token": "…", "protocol": 2 } }
```

The result names the agent build, the protocol version (`major` must equal the host's), the platform, OS,
model and screen (`w`, `h` in device pixels, `density`, `rotation`). A host only ever runs the agent of its own
build, so an agent has no other versions to answer for.

## Deadlines and cancellation

Every request carries `params._deadlineMs`; one that goes to the device's work without it ends the connection. The agent answers `TIMEOUT` when the work takes longer and
tells the work to stop (long loops poll a cancel flag; a call blocked inside the framework still returns
when the framework gives up). The host waits one second longer than the deadline, then fails the call
itself and sends `cancel {id}`. Device work runs on one thread in arrival order; `hello`, `ping` and
`cancel` are answered at once.

## Methods

| method                                                   | params                                                                                                   | result                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `hello`                                                  | `token`, `protocol`                                                                                      | agent and device description                                                     |
| `ping`                                                   | –                                                                                                        | `uptimeMs`                                                                       |
| `tree.get`                                               | `maxDepth` (128), `maxNodes` (5000)                                                                      | `Tree`                                                                           |
| `act`                                                    | `action`, `settle?`, `read` (`none`/`hash`/`tree`), `before?`                                            | `settle?`, `hash?`, `tree?`                                                      |
| `text.set`                                               | `text`, `replace`, `submit`, `at?`, `focusTimeoutMs` (5000; the iOS driver asks 2000), `settle?`, `read` | as `act`, plus `mode` (`setText`/`paste`/`keys`), `verified`, `focusMs`          |
| `screenshot`                                             | `format` (`jpeg`/`png`), `quality` (80), `maxPx?`                                                        | `w`, `h`, `format`, `bytes`, plus the image as an attachment                     |
| `app.foreground`                                         | –                                                                                                        | `pkg?`                                                                           |
| `app.target` (iOS)                                       | `pkg` (bundle id)                                                                                        | –                                                                                |
| `clipboard.set` / `clipboard.get`                        | `text` / –                                                                                               | – / `text?`                                                                      |
| `orientation.set`                                        | `rotation` 0–3 (frozen)                                                                                  | –                                                                                |
| `animations.set`                                         | `off`                                                                                                    | –                                                                                |
| `rest.wait`                                              | –                                                                                                        | –                                                                                |
| `audit` (iOS)                                            | `types?`, `maxIssues` (50)                                                                               | `issues`, `truncated`, `elapsedMs`                                               |
| `a11y.read` (Android)                                    | `maxNodes` (60)                                                                                          | `tree`, `clips` (`n`, `chars`, `hidden`), `traversal` (`n`, `before?`, `after?`) |
| `touch` (Android)                                        | `p` (0 down, 1 moved, 2 up), `x`, `y`, `x2?`, `y2?`: fractions of the screen, no settle                  |
| `stream.start` (Android)                                 | `codec` (`h264`), `quality`, `maxSize?`, `failFirst?`                                                    |
| `stream.clock`, `stream.sync`, `stream.status` (Android) | –                                                                                                        |
| `wait`                                                   | `since?`, `timeoutMs`, `minMs` (300)                                                                     | `sig`, `changed`, `reads`, `elapsedMs`, `tree?`                                  |
| `cancel`                                                 | `id`                                                                                                     | –                                                                                |
| `shutdown`                                               | –                                                                                                        | – (the agent exits)                                                              |

`action` is one of `tap {x,y}`, `doubleTap {x,y}`, `longPress {x,y,durationMs}`, `swipe {from,to,durationMs}`,
`gesture {pointers}` (1–5 fingers, each a list of `{x,y,t}` samples; fingers go down together at their
first sample and up together at their last) and `key {key, modifiers?}` (`back`, `home`, `enter`, `delete`, `tab`,
`appSwitch`, `volumeUp`, `volumeDown`, `power`, `lock`, `escape`, `space`, `arrowUp`, `arrowDown`, `arrowLeft`,
`arrowRight`, or a letter or digit; `modifiers` of `command`, `control`, `option`, `shift` are held during it, and on
Android `command` is Ctrl, which its text fields take). Coordinates are device pixels.

### Wait

`wait` reads the screen as the settle does, every 80 ms, and answers when its digest `sig` (every node's
class, id, text, description, bounds and flags, and the windows) differs from `since`, no sooner than
`minMs`, with the `tree`. No `since`: it answers after the first read. At `timeoutMs` it answers
`changed: false` with no tree. The host matches on what comes back, so one matcher serves every
selector, ref and check, and a still screen costs one answer. An endless animation answers every `minMs`,
which is no worse than polling. A simulator with no runner up is polled with `tree.get` every 300 ms, as is an
agent whose `wait` fails.

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
`simctl pbpaste` instead, and an iPhone's goes both ways by `devicectl device pasteboard`, as the runner has the pasteboard only while it is in front. Where `simctl pbcopy` writes nothing (Xcode 27.1 on a new iOS 26.5 simulator) the runner sets and reads it. That is a known limit: on a loaded Mac the runner's call can stall too (twice at load 138), and `clipboard` then refuses within about 20 s, with `UNSUPPORTED` and the reason, and the runner restarted.

iOS has no key to close a keyboard or to open the app switcher. `dismissKeyboard` taps the keyboard's hide key where it
shows one, else a place with no control; the host then reads whether it went and refuses if it did not. `appSwitch` is the home
indicator's slow drag up. Control Center and Notification Center are the drags a window's controls send, by the mirror's
input on a simulator: `act` would wait for the app under them to report the touch, take it for lost when it does not, and
do it again. Spotlight is Command-Space from the home screen. Each is the home screen app's, so that is what is read until
`home` closes it. The volume, lock and power keys go through direct input on a simulator and through
`XCUIDevice` on a phone, where lock and power use the private `pressLockButton`.

- **Input**, `SimHID` on the Mac: XPC to the simulator's `dtuhidd` (`com.apple.coredevice.feature.remote.hid.digitizer`).
  Tap, long press, swipe, one- and two-finger gestures, and the keys that have a HID usage, with what is held during them. A barrier
  after the last event proves a daemon received them; text stays with the runner for Unicode. A touch that
  changed nothing, and that the app has not reported finished (`TouchEventsCompleted`) within 4 s of the settle, never
  got there (a Device Hub in Resize Mode swallows touches and reports success): the runner does it again and takes
  over for the session. Portrait only, as that is what was verified; other orientations go to the runner.
- **Settings**, `SimOpen` inside the simulator through `simctl spawn`: `prefs:` and `settings-navigation:` are private, and `simctl openurl` is refused them (LaunchServices error 115). It opens them with `com.apple.springboard.opensensitiveurl`, linked in as the `__entitlements` section a simulator reads, as a signature holding it does not start. XCUI's `open` reached the page too, then held the runner up for two minutes. An app's own page has no link: the row on Apps is tapped.
- **Traffic**, `NetProbe` injected into the app with `DYLD_INSERT_LIBRARIES`: an `NSURLProtocol` that writes a JSON line per finished request to the file `APPDYNO_NET_LOG` names. A simulator's app writes to the Mac's files as they are.
- **Web pages**, the socket `simctl getenv <udid> RWI_LISTEN_SOCKET` names: binary property lists, each after its 4-byte length. `_rpc_reportIdentifier:` brings the applications, `_rpc_forwardGetListing:` a page list, `_rpc_forwardSocketSetup:` a `Target.targetCreated`, and `Target.sendMessageToTarget` wraps what goes to the page.
- **Reads**, `SimAX` inside the simulator through `simctl spawn`: one request of `XCTAccessibilityFramework`
  `userTestingSnapshotForElement:options:error:` per tree (a rejected depth is halved; children withheld at the
  boundary are read again), honouring modal views as XCUI does, so that what a sheet covers is not in the answer (215
  nodes against the runner's 49 without). The nodes are built as the runner builds them, by rules both suites read from `packages/driver-apple/test/fixtures/runner-rules.json`, with a test comparing their type tables, so refs, hashes and diffs do not depend
  on who read. Only XCUI tells which copy of a control a tap reaches: a layout with a control found at two or three
  different places goes to the runner once, and its verdict is kept by the layout's digest. Any other layout needs no
  runner. Once one is up for something else, a layout not seen yet is also compared with its read (about 100 ms, once per
  layout): where they differ the runner's is the answer, and three differences before a first agreement turn the helper
  off for the session. An app tells the accessibility server nothing while the switches XCTest turns on for its run are
  off, and XCTest turns them off at its end, so that the helper answered `no-foreground` for as long as it was asked:
  it turns them on (`_AXSApplicationAccessibilitySetEnabled`, `_AXSSetAutomationEnabled`) and, if it was the one to do so
  and no runner stays, off again when it leaves. `IgnoreAXServerEntitlements` was not needed.
- **Hello**, from the same helper: model, OS version, screen and scale, in the same shape. `agentVersion` is `helper`,
  until a runner starts and says its own. The runner
  starts on the first thing only it does: an alert, a system prompt, text entry, an image, an audit, or a read of a control
  found at different places.
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
  coming up does for 450 ms. The app's accessibility reports are no settle signal: `RunLoopIsIdle` and `AnimationsNonActive`
  both answer within 3 ms during a push.
- **Before a touch** the helper asks the app for `AnimationsNonActive`, at most 1 s: UIKit takes no touches while a view
  animates, and the tree shows it where it ends from the start. A report asked for right after a touch comes before the
  animation that touch starts, and once lost the next tap (1 of 3 on the fixture), so it is asked for only once the app has
  reported that touch handled (`TouchEventsCompleted`, two to a tap, at most 300 ms: another process may draw what was
  touched). A read asked for with no settle waits for the same report. No report covers a push or a pop: the tree is final
  and the reports say all is still well before UIKit takes touches again, and a tap under 560 ms after the touch that went
  back was lost, 7 of 30, with the app reporting it handled. So a touch waits until 650 ms after the one that changed the
  screen; an answer does not.
- **`launch`** brings a running app forward as it is (`simctl launch`; `LSApplicationWorkspace` from inside the
  simulator took 800 ms against about 180), and does nothing if it is in front; terminate it first for a fresh start.
  It returns once the app is the primary one. During a launch none is, for seconds on a loaded Mac; the home screen staying
  so for 3 s means a system alert over the app, which only the runner can tell. An app may add content after that: a ref
  from the answer still reaches its element, as a touch aims on a read at most 150 ms old.

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

A tree with no word for a tester is read from the picture on the host: a PNG of the screen goes to `mac/TextScan.m`, compiled on
first use, which answers Vision's lines as fractions of the image, and they join the tree as nodes of class `PictureText`
in the app's window. `hash` stays the agent's. A device's `wait` sees none of this, so `wait_for` then polls the picture. A
screen with any word of its own is never read this way: words on a canvas beside a labelled button stay out.

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

`animations.set {off}` (host: `--animations off`, `APPDYNO_ANIMATIONS=off`, the
fifth `AndroidDevice` argument) sets the three system animation scales to 0. They come back as they were when
the last connection that asked has gone, and if the agent dies first, by a separate shell process watching
it (within a second). The first performance measurement of a session puts them back for the rest of that
session, as a measurement must see what a user sees. `doctor --serial` warns about scales left at 0 (a reboot
in a session leaves them so).

`device_setting` `animations` and `reduce_motion` (Android: the same three scales) change them as well. One holds
the old value at a time: the option lets go first, the agent puts the scales back, and only then is the old
value read and written down, so neither restores over the other.

### Accessibility audit

`audit` (host API `device.audit()`) answers the screen's accessibility issues, each with its `type`, the
engine's `rule`, a `message`, the element's box `b` in tap units and the element (`c`, `id`, `d`, `t`):

- iOS: the platform's own audit of the app in front (`performAccessibilityAudit`, Xcode 15+), types
  `contrast`, `elementDetection`, `hitRegion`, `sufficientElementDescription`, `dynamicType`,
  `textClipped`, `trait` (`types` picks some). The runner takes every issue itself, so none becomes a
  test failure. An audit the platform cannot run answers `UNSUPPORTED`.
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

### A stream (Android)

A connection that asks `stream.start` gets video frames (type 2) until it ends, however it ends: the display and the
codec are released with it. It comes with the same token as any connection, and it counts as a connection for the
agent's idle exit. `touch`, `stream.clock`, `stream.sync` and `stream.status` are answered on the connection's own
thread, not the one lane of device work: a person's finger waits for no settle.

- `stream.info {w, h, codec, mode}` is the agent's own message, with no id, before the first frame of each encoder: its
  size, and in `mode` the encoder and the step of the ladder.
- `stream.end {why}` says it will not go on: every step of the ladder failed.
- Flags: 1 a keyframe, 2 parameter sets. The capture time is the display's own, on `System.nanoTime`'s clock, which
  `stream.clock` answers in `now` for the host to find the offset by its shortest round trip.

**The ladder**, when an encoder fails: the same step again three times, 500 ms apart; each size down from
`{2560, 1920, 1600, 1280, 1024, 800}`; the other codec, at each size; a software encoder of the first codec, at each
size. An encoder that ran 10 s and then failed keeps its step. `failFirst: n` makes the next n fail, for a test.

**Backpressure**: three frames wait at most. With the socket full a frame is dropped, and every frame up to the next
keyframe, which is asked for: the picture freezes for a moment and is never wrong.

An emulator's guest encoder runs as this does, and lags by seconds: see [mirror.md](mirror.md).

### A phone's screen goes off

A touch on a dark screen reaches no window, and nothing says so: the agent refuses it first with `SCREEN_OFF`, and the host wakes
the phone and asks again. Once woken, the app is on the screen before it can take a touch. On a Xiaomi (HyperOS, Android 16), with touches 0 to 4 s after
the read that woke it, 6 of 14 were lost, up to 1.5 s after and none at 4 s, with its focus at times on nothing or its launcher; in 10 more rounds
the button did not show at all. Once the host waited for the focus to hold for 600 ms, 15 of 15 reached the app and every round had its button. These
are small counts. A long measure wakes it too: a dark phone starts no app, and `am start` reads `UNKNOWN (0)`.

A screen that has only dimmed is awake, and no refusal stops a touch there. Yet on that Xiaomi, 42 s after the last touch, with `dumpsys display` reading `policy=DIM`, the touch that brightened the screen reached no window: 3 of 3 were lost with the agent reporting a tap, and with 25 s of quiet none was. The system's focus was the app's and the phone was awake, so nothing on the way said so. The agent now tells the system a person is here just before any finger lands, and the same 3 reached the app. A test that fails only after a quiet stretch is usually this: one failed 4 of 4 in its file's order and passed alone.

### A phone's install prompts

`app install` watches the phone's focused window with a plain `dumpsys` while `adb install` runs, and does nothing else until one of two windows has the
focus, so where no prompt comes it starts no agent and adds no wait. Only during that call, on that device, and only for the app in the file: its names
are read from the `.apk`, and a prompt that names another is left alone. With `--allow-apps` an install stays off altogether, as it always was. Neither option is a
tool argument: only the person who runs the server sets them. Seen on a Xiaomi 25078RA3EY (HyperOS 3, Android 16, tr-TR, Play Store 53.8):

| window                                                                      | what it is                         | what is read                                                                   | answer                                            |
| --------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| `com.miui.securitycenter/...permcenter.install.AdbInstallActivity`          | "install over USB?", no after 10 s | ids: `android:id/button2` accepts, `android:id/button1` denies and counts down | `button2`; never `do_not_ask_checkbox`            |
| `com.android.vending/...protectdialogs.activity.PlayProtectDialogsActivity` | "send app for a security check?"   | no ids: "Don't send", beside "Send this time" and "Always send unknown apps"   | "Don't send", with or without any flag            |
| the same                                                                    | "unsafe app blocked"               | no ids: "More details", then a text whose last line is "Install anyway"        | left alone; `--accept-install-warnings` passes it |

The Xiaomi's prompt is known in any language. Play Protect's dialogs have no ids, so its buttons can only be told apart by their words, and a wrong guess could
send a private build to Google. Its words here are from the Play Store's own resources, in English and Turkish; only the Turkish ones were seen on a screen. A
dialog in another language, or any other dialog of that window, is quoted and left for a person. So an install on, say, a German phone stops at that prompt
when it comes, and says so.

The warning was seen on an app built for `targetSdk` 24 (`-PoldTarget` on the fixture), the only warning this phone could be made to show with a harmless app, and
was passed by the host all the way to an installed app (`test-device/install-consent.test.ts`). Others, such as "harmful app blocked" or "app scan recommended", are in those resources, were not seen, and
their "Install without scanning" is not taken. Any other maker's USB install prompt is left alone: the install then ends as it does on its own.

A Samsung SM-A525F (One UI 6.1, Android 14, en-US) has no USB install prompt of its own: its `persist.security.adbinstall` is empty and installs took 1.1 s with nothing on the screen. Play Protect looked at them only with "Verify apps over USB" on (`verifier_verify_adb_installs`, 0 on this phone as found). With it on, its dialogs were the Xiaomi's, in the same window, in English: the warning, "More details" and "Install anyway" passed with the flag and left alone without it, and "Send app for a security check?" answered "Don't send" by the host itself, by `test-device/install-consent.test.ts`, 3 of 3.

With no person, uninstalling and installing the fixture each round, it took 14 of 14 rounds, 6 of 6 more with a report open, a cold agent or a screen put to sleep as the
prompt opened, and 3 of 3 through the built command line and server. These are small counts on one phone.

What it took on that phone:

- The prompt slides up over 0.3 to 0.7 s, its button already read at its last place. A touch then reached the window and did nothing, and the prompt said no 10 s
  later. A touch above the dialog, where a read's place can fall during the slide, cancels the install at once. The windows must read the same twice, 200 ms
  apart, once the focus has held.
- Its deny button counts down, but accept takes a touch from the start. Injected touches are not blocked here, where `persist.security.adbinput` reads 1. Where
  they are, the answer says so and names "USB debugging (Security settings)", which this tool never changes. That case was not seen.
- `KEYCODE_WAKEUP` does not restart a screen's timeout: the phone slept 5 s after it as the prompt opened, and then said no in the dark. The watcher wakes it
  again whenever it goes dark while the install is pending.
- "Install anyway" took no instant tap the one time that was tried, and has taken a touch held for 150 ms each time since, so all these touches are held. It has no
  node of its own: the touch goes to the last line of its text.
- Play Protect does not always ask to send. It asked on the first two installs each of the fixture and of its old-target build, was told no each time, and on the 50 or
  so installs since has not asked, for new package names either (`upload_requested=false` in its log). So on that phone the host's own answer to that prompt has run only on the
  recorded trees. On the phone, the agent's tap and a held touch by hand both took it. It did not time out in 3 minutes.
- When a person must answer, the host ends `adb install` and answers at once. The prompt stays on the phone, and a person's answer still installs the app (seen once).
- A prompt still open from an earlier call refuses the next install before it starts. A touch on it answers the earlier install, which the verifier then lets through,
  and it holds back the new install's own prompt: in one run that new install waited 77 s for the verifier to reject it.

## Errors

```json
{ "code": -32008, "message": "…", "data": { "code": "NOT_FOUND", "hint": "…" } }
```

`data.code` is one of `TIMEOUT`, `CANCELLED`, `DEVICE_GONE`, `AGENT_UNAVAILABLE`, `AGENT_CONFLICT`,
`AGENT_VERSION_MISMATCH`, `UNSUPPORTED`, `PERMISSION_REQUIRED`, `NOT_FOUND`, `NO_FOCUS`,
`APP_NOT_RUNNING`, `POLICY_DENIED`, `INVALID_ARGUMENT`, `STALE`, `SCREEN_OFF`, `INTERNAL`; the JSON-RPC code is −32000
minus its index in that list. An unknown method answers `UNSUPPORTED` on both platforms. `AMBIGUOUS`, `CHECK_FAILED`, `BUILD_FAILED`, `DEVICE_CLAIMED`, `DEVICE_LOCKED` and `OFFLINE` come after those and are the host's own, never on the wire. `TIMEOUT`, `DEVICE_GONE` and `AGENT_UNAVAILABLE` are worth one retry; the host
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
(a device has exactly one). The agent says so after trying for 4 s, as the system keeps UI automation for a holder that was
killed: held 1.3 s after its process had gone, free at 2.3 s, on an emulator, while after a plain `kill` it was free at once.
