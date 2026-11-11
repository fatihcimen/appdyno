# The window and the hub

[Türkçe](mirror.tr.md)

`appdyno mirror` opens one native window per device, driven by mouse, trackpad and keyboard, while an agent
may drive the same device. A window is a small Objective-C program, compiled by `clang` on first use as the
simulator helpers are: Command Line Tools are enough. Node is the control plane: it starts and stops streams,
carries input, names what is wrong, and reconnects. There is no server, no daemon and no listener of ours.
How a window works inside, and what was run to hold each claim, is in [How the window works](mirror-internals.md).

```sh
appdyno mirror                     # open this device's window and stay
appdyno mirror --all [--watch]     # every device, and new ones as they come; at most --max, default 8
appdyno mirror open --detach       # a window that outlives this command
appdyno mirror --device A --device B --pair   # two devices side by side, a touch going to both
appdyno mirror close | status | stats
  --quality auto|high|standard  --codec h264|hevc  --wifi  --max N  --no-input  --headless
  --seconds N  --takeover  --record file.mp4  --focus  --allow-devices RE
```

With `--detach` the window takes `--quality` and `--wifi`, and none of `--codec`, `--no-input`, `--headless`, `--seconds`, `--record` and `--focus`, which are for a window this command stays with. `--pair` takes exactly two `--device` and no `--detach`.

The `mirror` tool has `open`, `close`, `status` and `stats`. No frames pass over MCP: an agent has `screenshot`
and `record`. `hand_off` asks a person for what an agent cannot do.

## Where the picture comes from

| device    | how                                                                                         | what to know                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| simulator | CoreSimulator's own surface, no encode: the framebuffer itself, called back on each present | a still screen costs nothing. Private API, loaded at run time; what fails says so                                                                                                                                                                                 |
| phone     | the agent's stream on a connection of its own: nothing passes through Node                  | H.264 by default, HEVC at your word. Android 10 and up. A secure window is black, as in `screencap` (seen on Android 16)                                                                                                                                          |
| iPhone    | iOS 27's display service over a tunnel of this process's own, by USB, nothing on the phone  | undocumented, and may change. 4:4:4 at the phone's own size, up to its screen's rate. A still screen keeps sending, about 20 frames a second, so its window is not free as the others are. A held stream kept a phone lit for 30 minutes with nothing touching it |
| emulator  | the emulator's own gRPC port, its screen in a shared file, nothing in the guest             | the emulator's port, not ours. Where it has none, the guest encodes, which lags by seconds, and it says so                                                                                                                                                        |

## States of a window

`connecting`, `live`, `waiting {need}`, `reconnecting {attempt}`, `stopped {why}`. What a window waits for is said alike in its banner, by `mirror status` and in a refusal, each time with its words and its fix. A wait asks again each second and goes on by itself when it clears.

| what happens                  | what it does                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| device gone mid-stream        | last picture dimmed, banner, `waiting not-connected`; back: live again                                                   |
| simulator shut down           | `waiting simulator-off`; booted: live again                                                                              |
| screen off                    | `waiting asleep`, and on when a person wakes it                                                                          |
| encoder fails                 | restart 3 times, 500 ms apart; smaller; the other codec; software; then `stopped` with the reason                        |
| decoder fails                 | a keyframe is asked for and the picture held; three in a row, a new stream; then `stopped`                               |
| viewer dies                   | restarted at once, same zoom; twice in a minute, `stopped` with what it said                                             |
| parent dies                   | the viewer's stdin ends, so it ends; the agent sees that and releases the display and codec                              |
| agent stops                   | `reconnecting`, and the agent starts by the path every driver uses                                                       |
| Mac sleeps, wakes             | the stream ends, and comes back on wake                                                                                  |
| window covered                | frames are read and not decoded or drawn; back with a keyframe                                                           |
| rotation, fold                | a new size with no new session: the agent's encoder restarts, an emulator's picture is stood up, and so is a simulator's |
| second window on a device     | the first comes forward, and the refusal says who has it                                                                 |
| several devices               | one viewer each, `--max`; one failing leaves the others                                                                  |
| no compiler, no window server | `stopped` by its need, before anything opens                                                                             |

## The window

The device is drawn on a coloured background under the system's toolbar. Nothing is laid over the picture and nothing tints it. One capsule there says everything a device is at: "Live · Picture 60 fps · USB", "Reconnecting", what holds it up, "Measuring launch 3 of 6" with a bar along its foot, or that an AI client is driving. A click on it shows the stream's numbers. A state is never a colour alone: each has a symbol and words. Its rate is the picture's as it reaches this Mac: the Performance pane's **App frame rate** is what the app drew, and the two need not agree, as a still app is drawn once and a stream sends what changed.

Its words are in Turkish or English, by the Mac's language. The device's frame is drawn in code, and **Show Device Frame** (⌥⌘F) takes it away, a setting that stays. Only what changes a state moves, and nothing moves on a window at rest. The window follows Reduce Transparency, Increase Contrast, Differentiate Without Color and Reduce Motion, and VoiceOver hears a device arriving or leaving and a regression found.

The buttons on the frame work: a click presses them, and holding the side button is Siri. A window keeps its size and place per device. It can be any size: the device takes the room there is, and zoom sets the window to fit it.

The window shows what is pressed most, and the rest is a click away in **More Controls** and in the menu bar. Both come from one table, so that no control is in one and missing from the other. What a device has not got, it does not show: Android has Back and Quick Settings, and no Siri.

| control                                                                          | shortcut        | on a device                                                                                                                                        |
| -------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home, Lock, Volume Up, Volume Down                                               | ⇧⌘H, ⌘L, ⌘↑, ⌘↓ | its own buttons                                                                                                                                    |
| Back                                                                             | ⌘[              | Android only                                                                                                                                       |
| App Switcher                                                                     | ⇧⌘A             | iOS: Home twice. Android: its own key                                                                                                              |
| Siri                                                                             | ⇧⌘K             | iOS: the side button held                                                                                                                          |
| Control Center (iOS) or Quick Settings (Android), Notifications, Spotlight (iOS) | ⌃⌘C, ⌃⌘N, ⌃⌘F   | a finger's drag                                                                                                                                    |
| Rotate Left, Rotate Right                                                        | ⌘←, ⌘→          | the device's own orientation: the first turn starts the agent, which a simulator may first have to build                                           |
| Save Screenshot, Copy Screen                                                     | ⌘S, ⌘C          | the device's own lossless picture, to the Desktop and the pasteboard, or to the pasteboard. No agent needed where the device has a way without one |
| Record Screen                                                                    | ⌥⌘R             | to Movies: a stream's own frames, or the device's recorder where its picture is no stream                                                          |
| Record Flow                                                                      | ⌥⌘T             | what a person does, as a flow: see [Recording a flow](#recording-a-flow)                                                                           |
| Open Link…                                                                       | ⌘O              | the Links pane, below                                                                                                                              |
| Send Push…                                                                       | ⇧⌘P             | the Push pane, below                                                                                                                               |
| Zoom to Fit, Actual Size, Zoom In, Zoom Out                                      | ⌘9, ⌘0, ⌘=, ⌘-  | Actual Size is one device point to one Mac point                                                                                                   |
| Reconnect                                                                        | ⇧⌘R             | a new stream                                                                                                                                       |
| Show Inspector, Show Performance, Show Device Frame                              | ⌥⌘I, ⌥⌘P, ⌥⌘F   | the window only                                                                                                                                    |
| Paste                                                                            | ⌘V              | the Mac's text, typed into the device                                                                                                              |

While an agent drives, a purple ring runs around the screen, the capsule says so, naming the client where it says who it is, and a dot fades where each tap landed. A request for a person turns the ring orange.

What stands between a device and its picture is said in words with a next step. Asleep or locked, a card stands over the dimmed picture with what to do and **Try Again**, and a click beside its button still goes to the device. On a dark screen either lights it, as a person who asks wants it back. A device held up before its first picture has none to dim, so the room says it in the same words. A phone that is unplugged stays the one chosen under **Needs You**, as "Unplugged", and comes back by itself; it is not swapped for another device. A cable that only charges looks like no phone at all, as nothing reaches this Mac to tell them apart, so what a person reads names that too.

### The Inspector

The Inspector (⌥⌘I) is the system's own, 320 points wide and edge to edge, and gives way by itself under 1,100 points wide, and the sidebar under 860, each back when the window is wide again. Its panes stand as symbols in a row of their own across its top, each named under the pointer and to a screen reader, and the chosen one's name stands on a line under them. It stands open in the hub, and closed in a window of its own, which grows to take it.

#### Performance

- It says in one sentence how the screen is, then shows the frame rate, CPU and memory with a minute of each, and the measures: see [Live numbers](#live-numbers).
- **Results** lists what was measured on this device before, for the app in front, each judged by the gate's method against the clean runs before it of the same kind of build: "Regression +553 ms" or "Could not judge: 3 of 5 samples".
- A run taken from a window has its encoder at work on the device, so it enters no reference, and one that reads worse says "Could not judge: measured with a mirror running". A regression is found in runs with no window open.
- It reads files only, so a phone is not touched for it.

#### Flows

- It records what a person does, as a flow: see [Recording a flow](#recording-a-flow).
- It says what is under the pointer, and what a click there would write.

#### Apps

- It lists, launches, quits and removes apps, and removes one only after a sheet that says what goes with it.
- On iOS the list holds the system's apps too, as a new simulator has no other; on Android, only what was installed.

#### Activity

- It tells what an agent did as runs of work, such as "Worked for 40 s · 23 calls", each opening to its calls, such as "Tapped Sign in".
- A link or a push a person sends from the window is no agent's, and is not listed.

#### Logs and Crashes

- **Logs** shows the log of the app in front as it comes: the lines `logs` reads, with the same redaction, so a token, a password or a key in a line is hidden.
- It follows the app in front as Performance does, asking every 5 s, and starts over for another app. An app that is not a person's own, or not on the server's list of apps, is named and nothing is read.
- It has a level from Verbose to Errors, a search, Pause and Resume, which reads on from where it stopped, Copy, which takes the whole lines a selection touches, and Clear, which empties the view and never the device's log.
- **Crashes**, beside it, lists the app's last 5 reports as `crashes` gives them, each opening to its first lines and the path of the whole report on this Mac.
- The log is read every 2 s only while the pane shows and is not paused, and nothing is left running. An iPhone's running app has no log this Mac can read, and the pane says so, with what can.

#### Network

- It shows the app's requests as `network` gives them, from the capture that tool keeps for the device: a capture an agent started shows here, and one started here shows to an agent, redacted alike. Each request has its method, address, status, time and size, and the one chosen shows whole.
- It offers only the ways this device has: on a simulator the probe, which restarts the app and so is refused while a recording or a measure runs; on Android bytes, and packets from Android 14 where the build registers them, both counting with no addresses.
- A proxy is offered only where the device already goes through one, and its list is read where this tool can read the proxy's own export. No window sets a proxy, on any device.
- Where nothing lists requests, on an iPhone or an Android with no proxy, the pane says what a person needs.
- A probe's list is read every 3 s while the pane shows, and any other on Read Again. A capture started here stops as the window closes.

#### Accessibility

- It shows what `audit` finds on the screen shown, by kind, each kind counted. It is the same audit that names the contrast of the element under the pointer: one audit, never two.
- The screen is read while the pane shows, and audited once it has stayed the same for a second, as an audit holds the device's queue for seconds. A new screen is audited again, and **Check Again** audits the one shown.
- No audit runs during a recording, as a click would then be named by the screen it made, and the pane says so.
- An issue chosen is marked on the device's picture, as the element under the pointer is.

#### Links

- It opens a link on the device by `open_link`, the tool an agent calls, under the same policy: a web link, a universal link or App Link, or an app's own scheme. **Open Link…** (⌘O), in the File menu and in More Controls, shows it with its field ready, and Return sends.
- A second field names the app to open it in, filled with the app in front where the device says it is a person's own, and checked against the server's list of apps. An iPhone opens a link only in a named app; elsewhere an empty field leaves the choice to the system, which under `--allow-apps` must pick an allowed app, as `open_link` holds it.
- A call's link a person sends, `tel:` or `facetime:`, is theirs and asks nothing, where an agent's asks the person. A link a person sends is no agent's: the capsule does not say an AI client drives, and Activity does not list it. The first one opens a session on the device, as an agent's first call does.
- Its answer comes as it goes, and a refusal is shown whole, with what to do in a person's words where the hub has them, in English and Turkish. A hint the tool gives an agent, to change a call and make it again, is not shown.
- The links opened stay for that device, the last eight, newest first. Under them stand the links the app in the app field opens, as `open_link` `links` lists them, with each kind and a domain's state. One chosen stands in the field, a filter's `*` left for a person to fill.
- A simulator asks before an app's scheme first opens it, and the answer says so, as nothing has opened until a person answers it in the window.

#### Push

- It sends a push to an app by `push`, the tool an agent calls. **Send Push…** (⇧⌘P), in the File menu and in More Controls, shows it, and it asks the tool each time what this device takes.
- Each type the tool lists is offered; one the device does not take stands with why, and cannot be chosen. The fields follow the type, and **Payload** starts from the tool's own template for it, sent in place of the fields.
- The app is the one in front where the device says it is a person's own, or the one typed. Its types are asked again once a person is done typing one, as an Android app's build may take another route.
- Return in a field sends, and the answer comes as a link's does, a refusal whole.
- After `appdyno push setup` has stored APNs or FCM credentials, a route through them can take a token the app does not print: a field under the route, with the kinds of token the routes use, the chosen type's first. It is hidden as you type and kept for that app for this session only, as the pane says. Nothing shows it again, logs it or writes it down, and no tool an agent calls can reach it. A push of that kind then uses it.

#### Device

- It sets the device's conditions by `device_setting`, the tool an agent calls: dark mode, text size, the language, reduce motion, increase contrast, reduce transparency, animations, the network's speed, Wi-Fi, mobile data, airplane mode, a proxy, the battery level, the thermal state and the fold; a location, as `set_location` sets it; and Face ID or a fingerprint, an incoming call and a text message where the device takes them. A message with no words of its own says "Sent from the window", in the window's language.
- Each control shows what the device reads, asked again each time the pane shows. What this device cannot do stands disabled with a short reason in a person's words, such as "This device does not fold.", where an agent is told the driver's; a reason the window has no words for is shown as the driver gives it.
- On a phone, Wi-Fi, airplane mode, mobile data and the proxy stand disabled as well, as each can cut the hub's link to it, over Wi-Fi or by adb over Wi-Fi.
- A change goes into the one record an agent's changes go into, and a dot marks what was changed here. **Put Back All** puts back what `device_setting` `restore` puts back, and leaves what a running agent changed to that agent.
- What the window changed goes back when its device leaves it, the window closed or another device chosen in the hub, and the hub ends only after that.

## Live numbers

**Show Performance** (⌥⌘P) opens a card for each measure beside the device: frame rate, jank, frozen frames, CPU, memory and network, each with its last minute as a line, and a state in words and a symbol as well as a colour. Nothing is read until it is open, and nothing after it closes. They are the app in front, named beneath them, and are marked as read with a stream running, as `perf_*` marks a mirrored device.

A device gives each second what its own measures read, by the same readers `perf_*` uses, and its memory every five seconds, as that is the heaviest of them. A reading only looks: a screen a person turned off stays off. What it cannot give is a dash with the reason, and never a 0. Where a device counts no frames, the frame rate is what the window itself shows, and a still screen says Still. A frame rate has no right value, as a screen draws what it has to: it is judged only by the share of its frames that came late, and where late frames are not counted it stands with no verdict.

| device           | frame rate    | jank, frozen               | CPU, memory, network |
| ---------------- | ------------- | -------------------------- | -------------------- |
| simulator        | the window's  | only under the frame probe | read                 |
| Android emulator | the device's  | read                       | read                 |
| Android phone    | the device's  | read                       | read                 |
| iPhone           | the display's | no                         | CPU and memory       |

An iPhone's frame rate is its display's, with a mirror alone keeping it near 20, and says so beside the number. Its runner can tell only of the app it was given, so a window asks it of each of a person's apps, and asks again every five seconds to follow them: one call while the same app stays in front.

A simulator needs no runner for any of this: it reads the app in front by its read helper, and the home screen is measured as any app is. A device that cannot say what is in front without its agent starts it when the cards open, and they say so until it is up.

**Performance**, in the Inspector, keeps the same readings for as long as ten minutes of being shown, and takes a real measure of the app in front. **Measure Launch** is `perf_launch` and **Measure Scroll** is `perf_scroll`, as an agent calls them, with their defaults: the app restarts, and the run is kept with every other, marked as read with a stream running. **Open Dashboard** writes the page of every kept run and opens it. Readings stop while a measure runs, as they would reset what it counts. A measure holds the device as an agent's session does, and is refused by name while something else holds it. What is the system's, such as a home screen, is not measured.

## Recording a flow

**Record Flow** (⌥⌘T) writes what a person does on the window as a flow, the file `flow run` replays. The **Flows** pane opens beside the device and lists each step as it is written. A second press stops it and saves it to the Desktop as `<device> <date>.flow`, and closing the window does the same, as it does for a movie.

It writes what a person meant, by the element and not the place. Each click is named by the selector a tool would use on the screen that click landed on, by the rule of `flow start`, so that a flow made on one device runs on another of the same app wherever the selector holds.

| on the window                       | in the file                                                                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a click                             | `tap id=submit`                                                                                                                                                                                                                   |
| a double click                      | `double_tap id=submit`                                                                                                                                                                                                            |
| a hold, a right click               | `long_press id=submit`, with `durationMs` if it is not the usual 0.8 s                                                                                                                                                            |
| a drag, a wheel, two fingers        | `swipe up`, with a target only where one from the middle of the screen would move something else. A wheel's notches are one swipe. Swipes that reached what is clicked next become `scroll_to`, which holds on any size of screen |
| typing, a paste                     | `type "Ada"`, with `replace` if the field was empty, as what was meant is that it says this, and `submit` if Return ended it. Delete takes back a letter                                                                          |
| typing into a password field        | `type "${PASSWORD_INPUT}"` and `secret PASSWORD_INPUT`: the text reaches neither the file nor the recording on disk                                                                                                               |
| typing where no read shows a field  | `type "${TYPED}"`, and the window says so: such a field may be a password's                                                                                                                                                       |
| clicks on the device's own keyboard | no taps: a `type` of what the field came to, read from the field, or for a password its name                                                                                                                                      |
| Home, Back, a button, a key         | `press_key home`, and a key held down is `count`                                                                                                                                                                                  |
| Launch and Quit in the Apps pane    | `launch`, `stop`                                                                                                                                                                                                                  |

A flow starts with `launch` when a person's own app is in front, which brings it forward and restarts nothing, so that another device has a way there. A recording starts where the app is: on a screen deep in it, a replay must start there too.

A recording drops nothing without saying so. What has no step (a pinch, a rotation, Quick Settings, a drag along no axis or after a long press, Page Up and its kind, an app removed) is said in the window at that moment and written as `unrecorded`, which stops a replay there rather than go on without it. A place nothing names, or a finger coming on from the edge, is written as coordinates, marked `!coordinates` with the size of screen it holds for, and the window says so. Both stand in the pane's list with why. A measure restarts the app, so it is refused by name while a recording runs.

**Which screen a click means.** A click is named by the screen as it was just before the click. By the time the window hears of a click, the device has already begun to react. So while a recording runs or the pane is open, the screen is read all the time, beside touches: a touch has left for the device before anything here hears of it, no read starts with a finger down or for 100 ms after, and a read takes at most half of the time. A click takes the newest read since the last input, else the one under way. A hover asks the device nothing. Nothing is read with neither in use, nor while the stream is down or a measure runs. Such a read is a look: it wakes no dark screen and opens no lock, as `tree` does for a tool.

**Under the pointer.** With the Flows pane open, the pointer over the device shows the element under it, marked on the picture: its role, words, ref and id, what a click there would write, and what `audit` says of its contrast, read once per screen. An audit waits for the pointer to rest, may start a simulator's runner, and the pane says it is reading until it is done. No audit runs during a recording, as a read waiting behind one would come after the click it was to name, and the pane says so. What a click on the device does is chosen there: it **Touches** the device, **Copies** the element's selector, or **Asserts**, which adds a check to the recording and touches nothing: `assert id=result check=text equals="Sent: Ada"`, or `assert text="Bilgiler"` where its words are what names it.

The recording is the one `flow` keeps, a file per device. So `flow start` from an agent or the command line takes a person's clicks too, and a window's recording takes an agent's calls, each in the order they came. A flow's `stop` and `save` work on either.

## The hub

`appdyno hub` is one window: every device this Mac can reach in a sidebar, phones first, then what runs, with what is shut down folded away, and the one chosen live beside it, controlled right there. Only what stands in the window streams, and a phone starts only when a person chooses it: a simulator or emulator already running may show at once, and no choice is kept from one launch to the next. The toolbar is the system's, with the same controls as a window of its own, and only what that device has. The Inspector is a click away, Performance first. Search takes what is folded too. The hub starts and stops what is virtual, and makes a new simulator or emulator from what this Mac has installed. Where nothing can be shown, it says what to do next.

**AI Clients**, under the devices, lists every MCP client `appdyno install` knows, each as it truly stands. Connected is earned only by a real call: the server keeps each client's name, version, way in and last call, and nothing it sent. Add and Remove show the exact lines first and take a second click, and Undo takes back that one entry. Test runs what an entry runs, as far as its list of tools, and says what to do when it fails; it calls no tool. For a client in a browser it starts and stops `appdyno mcp --http`, in a process that ends with the hub, with the token hidden until asked. See [Connecting a client](../guides/clients.md).

**Help**, under AI Clients, or command-?, needs no network. It says what appdyno is, gives prompts by goal filled with the device and the app last in front, each saying what it does to the device, says what each panel and number means, and runs `doctor`. The app is the one the Performance pane last named, so a system app, or on a simulator an app opened after its stream began, leaves a prompt saying `my app`. A place stands where a device would, so its stream ends, and the Inspector closes until a device is chosen. While it shows, the list of clients is read every 2 s, and nothing runs when it does not.

**Open in New Window**, in the More Controls menu, in a row's menu, or by shift-command-N, gives a device a window of its own, which is what `appdyno mirror` opens, by the same code: the hub shows that it is there, and can close it. A viewer that dies takes what stands in it, and the hub brings it back with the device it had. After three in a minute it stops.

### Connect a Phone

Where the hub has nothing to show, Connect a Phone stands in its place, and its sidebar row keeps it reachable later. It holds nothing up: every other part of the hub stays open while it shows.

It finds the phone in your hand by itself. The Mac's USB registry names who made what is plugged in, whatever the phone allows, and asks the phone nothing: an Android with USB debugging off is there before adb has heard of it. So adb is asked for only with an Android in hand, after showing Google's terms, and Xcode only with an iPhone. With nothing on USB it says so plainly, and that a cable that only charges shows nothing, so to try another.

The current step is one short sentence and a diagram, and it moves on as the phone's state changes:

| Phone   | Steps                                              | How it ticks                                                                                                                     |
| ------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Android | Get adb                                            | `doctor` finds adb                                                                                                               |
|         | Developer options, USB debugging                   | adb hears of the phone. From a Mac these two are one state, so a person moves between them with Next                             |
|         | Allow USB debugging                                | adb's state goes from `unauthorized` to `device`                                                                                 |
| Xiaomi  | USB debugging (Security settings), Install via USB | `persist.security.adbinput` and `adbinstall` read `1`. Neither holds the phone up: a person moves on with Next where they do not |
| iPhone  | Get Xcode, Trust, Developer Mode                   | `devicectl`'s pairing and Developer Mode state                                                                                   |

Build number's place is named for Samsung, Xiaomi and Pixel, and any other maker is told where it may be. Developer Mode says before it that the phone restarts. A lock or a dark screen is said only when the phone can be read. On a phone that has not allowed this Mac nothing can be, so that step says to wake it. What a runner needs comes from `doctor`, with Build Runner beside it.

A phone that gets ready while this place is on show, with no device on the stage, opens by itself. The stage makes room for one sentence on what to try, with AI Clients a click away, and the sentence goes by itself after 12 s. A phone that gets ready while a person is elsewhere gets its row and nothing moves, and of two phones the first opens and the second gets its row. A phone that was ready all along waits for its row or for Open, as any other does: a phone is touched only when a person works on it or chooses it. A phone under Needs You opens here, on its step. While this place shows, the phone is read every 3 s, and nothing is read when it does not.

### Tools in the hub

Tools runs what appdyno does at a terminal, each row the very command, run by the hub as a terminal would run it, with no second implementation. Nothing a window sends becomes a command by itself. A row ends in a person's sentence, with its device, how long it took and its page. The command and all it said stay behind Show Details, so that no device id or temporary path stands in the way. A row that lacks an app, a device or a folder stands dimmed, and what is missing is said once, at the top. Stop is Ctrl-C to all the command started, so a flight recorder saves what it holds. The gate's row goes by what the gate printed and not by its exit code, which is 1 for a regression and for a change it could not judge alike, and 0 for too few samples: a regression is red, what it could not judge is orange, and only a clear answer is green. A baseline short of runs is saved and says so.

| In the hub                                            | Command                                               |
| ----------------------------------------------------- | ----------------------------------------------------- |
| Save as Baseline, Compare with Baseline, Find Out Why | `perf baseline`, `perf compare`, `perf why`           |
| Measure Everything                                    | `perf survey`                                         |
| Run Flows                                             | `test`, with its artifacts in the folder chosen       |
| Timeline, Flight Recorder                             | `timeline`, `flight`                                  |
| Dashboard                                             | `perf dashboard`, and it opens                        |
| Get Trace Tools, outside the app, Get adb             | `tools install`, `tools install adb --accept-license` |
| Pair for Wi-Fi, Forget Pairing, in Connect a Phone    | `pair`, `pair --forget`                               |
| Add to All AI Clients                                 | `install --dry-run` first, then `install --yes`       |
| Add to PATH, Take off PATH                            | `path`, `path --remove`, from the app only            |
| Check for Updates, Update                             | `update --check`, `update`                            |
| Build Runner, in Connect a Phone                      | `ios build`                                           |

Elsewhere in the hub: Doctor is in Help, the sidebar has `devices`, making a new simulator or emulator, and starting and shutting one down, and AI Clients has `mcp --http` and each client's `install`.

Left out on purpose, as they are for CI or scripts, or belong to a session:

| Left out                                                                                                                        | Why                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `bench`                                                                                                                         | Times a driver against others on a quiet machine: for this project's own numbers                                                 |
| `perf comment`                                                                                                                  | Writes Markdown for a CI to post                                                                                                 |
| `perf budget`                                                                                                                   | Budgets are a file kept with the code, read by `perf compare`                                                                    |
| `perf reference`                                                                                                                | Needs the baseline's build put back on the device: a step of a script                                                            |
| `perf functions`                                                                                                                | Takes two kept profile ids, which a person has no list of here                                                                   |
| `perf prune`                                                                                                                    | Kept traces are pruned by themselves                                                                                             |
| `report`                                                                                                                        | Written from a session's own steps, so it belongs to an agent. Timeline, Flight Recorder and Dashboard each write their own page |
| `mcp` over stdio                                                                                                                | What a client starts for itself                                                                                                  |
| `version`                                                                                                                       | `update --check` says it                                                                                                         |
| Flags such as `--junit`, `--format`, `--retries`, `--tag`, `--env-file`, `--param`, `--share`, `--measurements` and `--allow-*` | For a pipeline, and each has one sensible default here                                                                           |
| Single operations such as `tap` or `screen`                                                                                     | The device's window does these by hand, and a client by its tools                                                                |

## Two devices

**Show Beside This One**, on a row of the hub's sidebar, splits its window between two devices: an iPhone and an Android phone, or one build on each of two devices. `appdyno mirror --device A --device B --pair` opens the same as two windows side by side from one process. Closing one leaves the other on its own. A window already open on either closes first.

A touch on either window goes to both. It waits for both screens to be read, so that what it means is read as it was before it landed, and then goes to both at once. That wait is what **To both** costs: a read took 30 to 60 ms on a simulator and an Android emulator, and on two phones the wait comes to 150 to 250 ms. On the other device it goes to the same thing, by id or by words, and to the same one among those called alike, as two devices rarely have a thing in the same place. A finger on nothing with a name goes to the same place, and a drag keeps its length from where it landed. Keys, text and the window's device controls go to both.

Each device says where a touch goes, and what became of it. The subtitle says **To both** with an edge of the accent's colour around the device, or **Here only** once the link control is off, and a ring shows where a touch landed on each screen. Where it failed the device's edge goes red and the subtitle says why, until a touch lands: "No Send here" where that device has no such thing, and nothing else is touched, "iPhone 17 Pro is not live", "That did not land". A drag that begins on such a thing goes on from the same place, as it means no one thing. In the hub's window, whose bar speaks of one side, each picture says under it whose it is and where a touch goes, or what failed, in red, and the sidebar chooses the device whose bar is up.

**Measure Journey…** in Performance measures a flow as `flow` `run` with `iterations` does, a first run left out and five kept, in the same store: `perf_compare` gates it, and the dashboard has it beside every other device. A flow that names no app takes your app in front, so builds under two ids can run one file. On two windows it runs on one device and then the other, as two at once would load each other, and touches stay on their own window meanwhile. Each window then says how it stands: "97 % slower, 1641 ms there", and the step that moved most, by the rank test and the floor the gate uses for two conditions measured in turns, or "No clear difference". Every step's numbers are in the row's tooltip. A window where the journey failed says so in red, and the other has nothing to compare.

## Pointer and trackpad

| on the window             | on the device                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| click, drag, double click | a tap, a swipe, a double tap                                                                           |
| hold                      | a long press, for as long as it is held                                                                |
| right click               | a long press of 0.8 s, as an agent's is; on the frame or beside it, the Device menu                    |
| scroll wheel, two fingers | a one-finger drag: the device scrolls as it does for a finger, and the coasting is the device's own    |
| pinch on a trackpad       | two fingers either side of the pointer                                                                 |
| a drag from the bezel     | starts at the screen's edge, as a finger coming on from outside does: the edge gestures of each system |

A dot shows where the pointer touches, and two for a pinch. With no frame, a drag from the outermost pixel of the picture does the same as one from the bezel.

## The keyboard

A window never takes the keyboard by itself: not when it opens, reconnects or restarts, and not when an agent opens it.
A person's click gives it, or `--focus` at the first opening. A key that reaches a window without the keyboard goes
nowhere. A window an agent opened also holds all input until a person's click, and that click goes no further. What
is typed reaches the device and nothing else: no log, the Activity pane or `report` holds it. On an iPhone the runner turns off what XCTest would keep of each key, so that holds there too.

Typing goes through the system's own text input, so a dead key, an accent held down and an input method all work. ⌘V sends the Mac's text the same way, 4,096 characters at most, and the window says when it cut one short, as a long text goes one key at a time. A simulator types what a US keyboard has as keys and anything else by its pasteboard and command V, so an app may ask Allow Paste.

On an iPhone, typed text is sent by the runner as a string, so the phone's keyboard layout does not change it. The first letters start the runner, which takes about 3 s. Letters typed after a tap on a text field go once that field has the focus; if no field takes them within 6 s they are dropped, and the window says so.

A window takes its menu bar and Dock icon at a person's first click, not before: an agent's window changes nothing on a Mac until someone uses it.

## Sharing a device

A window does not claim the device, so it opens while an agent holds it. Its capsule says who is driving.
`--no-input` makes it a window to look at only, and `--allow-devices` applies.

The hub and any client on this Mac meet on one agent, whichever came first, and a client that asks for the window of a
device standing in the hub is told it is open. That holds across builds too: a hub left open through an update keeps the
agent it started, and what starts later uses that one until the hub has closed.

A person's input always goes through, on a connection of its own, and it does not queue behind what an agent
does. `mirror status` tells an agent when a person last touched the window. While calls come, the window says an agent is driving. Its Activity pane lists each call: time, tool, how long, its result, with
typed text by its length and secrets hidden, by the code `report` uses. It reads
`activity/<serial>.jsonl` in the state directory: no socket, across processes.

An alert that only a person can answer (Face ID, Touch ID, a passcode, an Apple Account, Allow Paste, a VPN, a profile, a
purchase) is said in the answer that read the screen: `needs a person: Face ID`. `hand_off {reason, timeoutS}` puts a banner on the window with a sound, a Dock bounce and "I'm Done", with no sound or bounce on a server run with `--silent`. With no
window, a sound and a best-effort notification of the reason, neither on such a server, and it waits for the screen to change. It answers who ended the
wait, or that no one did. It waits 300 s by default, and at most 3,600.

`perf_*` on a mirrored device gets the noise mark `mirrored`, which holds a run out of a gate as high load does:
a stream runs an encoder on the device.

## Privacy: a window shows the whole screen

A mirror shows what the screen shows: `report` paints over secrets, and a window does not. Neither do **Save Screenshot** and **Record Screen**: what they save is the screen as it was, passwords in plain fields included. The agent's token goes to a viewer by its stdin, never by its arguments.

## The size of a phone's picture

`--quality auto`, the default, takes the largest size that keeps up with a person, judged by how long the encoder takes on each run of motion. A phone whose encoder keeps up stays at its display's size; one that falls behind goes to a smaller size, and the next stream starts there. It stops at the smallest size a person can read, 1.12 pixels of picture for each dp of the screen, and says the device cannot keep up. A size can go back up: after 30 s, three runs fast enough for the next size up take it there. `--quality high` and `standard` keep the display's size, and a size asked for is that size.

## Stated limits

- An iPhone is experimental: it rests on undocumented services, which may change.
- An iPhone's lock screen: a swipe sent to it does not open it. Home does, from the window's controls.
- The window does not yet show a secure Android window's content, as no shell can have it from Android 12: it is black, with the status bar still there. Not run on Android 12 and 13, or on 10, for which no image is here.
- The frame's Action button and Camera Control are drawn and do nothing: no input is known that presses them.
- `auto` on a phone starts at its display's size and changes it, once, on the first motion that shows the encoder falling behind, so a person may see the picture restart on their first touches. `--quality high` and `standard` keep the display's size.

Recording a flow:

- A swipe keeps its direction and not its length: a replay's goes 40 % of the screen. What it reached is kept, as `scroll_to`, where a click or an assertion came next.
- A step is written when input leaves for the device, so what a device then refuses, such as a paste into an iPhone's secure field, is in the file as though it landed. The window says the refusal.
- A flow goes to the Desktop under the device's name: rename it there. Steps cannot be taken back in the pane: a flow is a text file, so edit it.

## Wi-Fi

A cable stays the default. The network is a person's choice, made once for each phone.

| device  | pairing                                                                                      | a window                                                     |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Android | Wireless debugging, Pair device with pairing code: `appdyno pair <address> <code>`, as shown | a device like any other: `appdyno mirror --device <ip:port>` |
| iPhone  | on its cable, unlocked: `appdyno pair --device <udid>`, and a person accepts on it           | `appdyno mirror --device <udid> --wifi`                      |

The window's title says it is on Wi-Fi, and a note says what that costs. An iPhone takes the lower mode unless
`--quality high` asks for the other.

`appdyno pair` run again for an iPhone goes by its cable too: a phone that proves it still knows this Mac is left as it
is with nothing asked, as an iPhone 13 Pro Max was, and one that forgot this Mac, or a pairing here that cannot be read,
is paired anew, with a person accepting. That second way is held by unit tests, and no phone has shown it.

All of it is in the hub too. Connect a Phone has a card, Without a Cable, for a phone on a cable: Pair for Wi-Fi runs the
same `appdyno pair`, for an iPhone at a click and for an Android phone with the address and code it shows. Forget Pairing
runs `appdyno pair --forget`, which takes this Mac's half of an iPhone's pairing; the phone keeps its half until its
trusted computers are cleared, and an Android phone's pairing is forgotten under Wireless debugging on the phone.

One phone is one row, as it has one encoder. On a cable it goes by the cable, and a name adb found on the network is left
out while that phone has its cable. Without one the same phone stands in the list by Wi-Fi, and the bar over it says so:
"Live · Picture 60 fps · Wi-Fi". An address says nothing of whose it is, so a phone reached by `adb connect` keeps a row of its
own. An iPhone paired for Wi-Fi stands in the list with no cable, from what is on this Mac and with no look at the
network, and its window says if the phone is not there. It goes by the network with no `--wifi`, as it has nothing else.

A network that goes leaves no end to read, so silence is what tells: past it the last picture dims and the window
says `waiting not-connected`, as for a pulled cable. Measured on an emulator reached by address through a relay that
goes silent: said within 7 s of 20 s of silence, live within 1 s of the return, by itself.

Wi-Fi costs time: on an Android phone a touch takes about twice as long to show as by cable, and an iPhone's picture is less steady. [Wi-Fi, as run](mirror-internals.md#wi-fi-as-run) has the measures.

A window on Wi-Fi does not do these:

- An iPhone's pairing cannot be made there: on the network a phone refuses to start one, so it takes a cable, once.
- A phone must share this Mac's network: an iPhone is found by what it advertises there, and an Android phone needs Wireless debugging left on, which its Wi-Fi going turns off.
- An iPhone by Wi-Fi takes the lower mode unless asked.

## Left out, for now

Audio.
