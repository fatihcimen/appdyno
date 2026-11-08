# Mirror

[Türkçe](mirror.tr.md)

`appdyno mirror` opens one native window per device, driven by mouse, trackpad and keyboard, while an agent
may drive the same device. A window is a small Objective-C program, compiled by `clang` on first use as the
simulator helpers are: Command Line Tools are enough. Node is the control plane: it starts and stops streams,
carries input, names what is wrong, and reconnects. There is no server, no daemon and no listener of ours.

```sh
appdyno mirror                     # open this device's window and stay
appdyno mirror --all [--watch]     # every device, and new ones as they come; at most --max, default 8
appdyno mirror open --detach       # a window that outlives this command
appdyno mirror --device A --device B --pair   # two devices side by side, a touch going to both
appdyno mirror close | status | stats
  --quality auto|high|standard  --codec h264|hevc  --no-input  --headless  --seconds N  --takeover
  --record file.mp4  --focus
```

The `mirror` tool has `open`, `close`, `status` and `stats`. No frames pass over MCP: an agent has `screenshot`
and `record`. `hand_off` asks a person for what an agent cannot do.

## What feeds it

| device    | how                                                                                         | what to know                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| simulator | CoreSimulator's own surface, no encode: the framebuffer itself, called back on each present | a still screen costs nothing. Private API, loaded at run time; what fails says so                                                                                                                                                                                 |
| phone     | the agent's stream on a connection of its own: nothing passes through Node                  | H.264 by default, HEVC at your word. Android 10 and up. A secure window is black, as in `screencap` (seen on Android 16)                                                                                                                                          |
| iPhone    | iOS 27's display service over a tunnel of this process's own, by USB, nothing on the phone  | undocumented, and may change. 4:4:4 at the phone's own size, up to its screen's rate. A still screen keeps sending, about 20 frames a second, so its window is not free as the others are. A held stream kept a phone lit for 30 minutes with nothing touching it |
| emulator  | the emulator's own gRPC port, its screen in a shared file, nothing in the guest             | the emulator's port, not ours. Where it has none, the guest encodes, which lags by seconds, and it says so                                                                                                                                                        |

The emulator's frame is RGBA in a file of exactly its size, top row first (the proto's comment says bottom up, and
a frame compared with `screencap` says not). Asked with no size or into a larger file, it answers every frame and writes
nothing. A guest that rotates draws sideways in a frame of the same shape, so the picture is stood up in the
viewer, with no new session. A simulator does the same in its surface, with no callback: its read helper says how the app in front is drawn, four times a second, so an app that does not turn stays upright on a turned device, and a touch is turned back on its way down. An emulator booted by `simulator` gets `-grpc <free port> -grpc-use-token` beside `APPDYNO_EMULATOR_ARGS` (unless
those name `-grpc`). The port is the emulator's own, as adb's is adb's. The picture's file is `0600` in the state
directory and goes with the session.

## Its states

`connecting`, `live`, `waiting {need}`, `reconnecting {attempt}`, `stopped {why}`. What it waits for is one table,
`NEEDS` in `packages/core/src/mirror/need.ts`, used by the window's banner, `mirror status` and a refusal, each with
its words and its fix. A wait asks again each second and goes on by itself when it clears.

| what happens                  | what it does                                                                                                             | tested by                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| device gone mid-stream        | last picture dimmed, banner, `waiting not-connected`; back: live again                                                   | an emulator killed under its stream; hand-run for a cable |
| simulator shut down           | `waiting simulator-off`; booted: live again                                                                              | a simulator shut down under its window                    |
| screen off                    | `waiting asleep`, and on when a person wakes it                                                                          | emulators and the Xiaomi                                  |
| encoder fails                 | restart 3 times, 500 ms apart; smaller; the other codec; software; then `stopped` with the reason                        | agent unit; `failFirst` on emulators and the Xiaomi       |
| decoder fails                 | a keyframe is asked for and the picture held; three in a row, a new stream; then `stopped`                               | viewer self test; session unit                            |
| viewer dies                   | restarted at once, same zoom; twice in a minute, `stopped` with what it said                                             | SIGKILL on each kind; session unit                        |
| parent dies                   | the viewer's stdin ends, so it ends; the agent sees that and releases the display and codec                              | SIGKILL of `appdyno mirror`, then `dumpsys`               |
| agent stops                   | `reconnecting`, and the agent starts by the path every driver uses                                                       | `shutdown` on emulators and the Xiaomi                    |
| Mac sleeps, wakes             | the stream ends, and comes back on wake                                                                                  | session unit; hand-run                                    |
| window covered                | frames are read and not decoded or drawn; back with a keyframe                                                           | viewer self test                                          |
| rotation, fold                | a new size with no new session: the agent's encoder restarts, an emulator's picture is stood up, and so is a simulator's | emulators; a simulator's by a suite, touches included     |
| second window on a device     | the first comes forward, and the refusal says who has it                                                                 | parent unit; two runs on the Xiaomi                       |
| several devices               | one viewer each, `--max`; one failing leaves the others                                                                  | parent unit; three devices with one killed                |
| no compiler, no window server | `stopped` by its need, before anything opens                                                                             | session unit                                              |

## An iPhone

Everything that speaks to a phone's services is in `packages/driver-apple/src/phone-stream/`, with one way in: delete
that folder and the rest builds and passes its tests, an iPhone keeps its runner, and its mirror is refused as
`no-phone-stream`. A test holds that nothing else reaches into it.

It makes its own tunnel: `usbmuxd`, lockdown with this Mac's pair record, `CoreDeviceProxy`, then IPv6, TCP and UDP in a
thread of this process. It never connects to the discovery port of Apple's own tunnel, which takes one client and
would throw `remoted` off it; a test holds that too. The pair record is read and never written; by cable pairing is
never asked for, and any refusal stops with what a person must do. No socket opens on this Mac for any of it, so the
README's line on listeners stands.

With `--wifi` the same tunnel runs over TCP and TLS on the network. What gets there is `wifi.ts`, the one file here
that opens a socket, and only to a phone: `dns-sd` finds what it advertises, and the phone proves itself with the key
it gave at pairing, before a key for the tunnel is made. It listens for nothing. That pairing is `appdyno pair`'s, a
person's word on the phone, an identity of its own in `wifi-pairing/` of the state directory, `0600`. It is made once,
on the cable: on the network a phone says `allowsPairSetup: false` and names no udid, and inside the cable's tunnel it
offers a service that takes a pairing, so that too comes nowhere near the discovery port. The pair record opens that
tunnel, as it does every other, and plays no part in a window by the network, which a test holds too.

The stream asks for the remote desktop profile first, 20 to 60 Mbit/s as configured, in 4:4:4, and takes the lower one,
in 4:2:0, if a phone refuses it or `--quality standard` asks. Pictures go to the viewer by a named pipe, `0600`, off the
disk as soon as both ends hold it. A gap in the packets holds the picture until a key picture comes: a freeze, never
garbage. Three pictures wait at most, and past them one is dropped, which also holds the picture until a key.
`mirror stats` has `lostPackets`, `latePackets`, `heldPictures` and `droppedPictures`, since the stream began.

A stream's offer asks the phone to end it after 30 s with no report from us, in place of its default hour: a process killed
outright left the phone's stream for 28 to 30 s, one run, and its indicator with it. Streams we started are remembered,
so a start stops one that was left over; any other client's reads as `taken-over`, and is never stopped.

A phone turned dark by its side button keeps its stream at a picture a second, and the mirror says `waiting asleep`
while it stays: a new stream would light the screen and undo what a person did. It comes back with the pictures. A
press of `home` on a dark phone lights its lock screen, and a second opens a phone with no passcode. A click on the window, or its Try Again, is the one thing that presses it, on a dark phone only. Input is opened anew after a dark screen, as a finger sent on a connection from before it goes nowhere; a swipe sent to
a phone does not open a lock screen.

A phone that turns keeps sending a picture of the same shape with the app on its side. SpringBoard says how the app in front is drawn, four times a second, over a lockdown service of its own, so the window stands the picture up and a touch is turned back on its way down.

## The window

The device stands on a ground painted from the hub's palette, under the system's toolbar. The system's glass has no colour of its own, so a window is as rich as what stands behind it. Nothing is laid over the picture, and nothing tints it: colour lives around it. One capsule there says everything a device is at: `Live · 60 fps · USB`, `Reconnecting`, what holds it up, `Measuring launch 3 of 6` with a bar along its foot, or that an AI client is driving. A click on it shows the stream's numbers. A state is never a colour alone: each has a symbol and words.

The window is usually behind the one a person types in, so what it says is built to hold its strength there. AppKit fades the system's colours and every image in the bar of a window that is not key: its own title to 2:1. So the name in the bar is a label of ours, colours are resolved to plain ones, and symbols are drawn by a view of ours. Read off the pixels of the real window, dark and light, on a simulator, in each place of the hub, drawn as in use and as behind others: of 854 words and symbols each way, every word is at 4.5:1 or more and every symbol at 3:1, as they are with Reduce Transparency, Increase Contrast and Differentiate Without Color, and at both ends of the Liquid Glass setting. A window kept behind cannot be made key, so in use is how it is drawn, and no real key window was read.

Its words are in Turkish or English by the Mac's language, from one table, `mac/Viewer/WordsTable.m`. English is the key, so what the parent sends for a command line needs no second name: a label looks up whatever it is given, and what the table has not got, such as a tool's own error, stands in English.

The frame is drawn in code from a small table by model: its corners, its island or notch, its buttons. Nothing of it is artwork, and it is drawn once per size, so a still window costs nothing for having it. A simulator's picture holds its own island, so the frame adds one only where a picture has none. **Show Device Frame** (⌥⌘F) takes it away, and the setting stays. The ground is a small picture mixed from the palette and stretched by the layer, with no blur pass, and its colours move round with the place on show. A device's colours reach it as hue only, each on its own side when two stand together, read at most every 2 s and once more as a screen stops. Below macOS 26 a sidebar and an Inspector are the system's older material, and the ground does not show through them. Reduce Transparency gives a plain ground and solid cards, Increase Contrast stronger lines and words, and Differentiate Without Color a shape for each state.

Only what changes a state moves, and it comes to rest within 300 ms: a place's ground crosses over, a step passes with one ring, a run lands with its mark, a result arrives in its list, and the capsule crosses over for a state. What a person repeats, a row, a tab or a button, happens at once, and a reading changes without a fade. Two things take longer because they explain, the rings on the step to do and the beats in its picture, three times each, and then they stop. A spinner runs only while a run does. Nothing moves on a window at rest, and with Reduce Motion a move is a cut.

The buttons on the frame work: a click presses them, and holding the side button is Siri. A window keeps its size and place per device. It can be any size: the device takes the room there is, and zoom sets the window to fit it.

The window shows what is pressed most, and the rest is a click away in **More Controls** and in the menu bar. Both come from one table, so that no control is in one and missing from the other. What a device has not got, it does not show: Android has Back and Quick Settings, and no Siri.

| control                                                  | shortcut        | on a device                                                                                                                                        |
| -------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home, Lock, Volume Up, Volume Down                       | ⇧⌘H, ⌘L, ⌘↑, ⌘↓ | its own buttons                                                                                                                                    |
| Back                                                     | ⌘[              | Android only                                                                                                                                       |
| App Switcher                                             | ⇧⌘A             | iOS: Home twice. Android: its own key                                                                                                              |
| Siri                                                     | ⇧⌘K             | iOS: the side button held                                                                                                                          |
| Control Center, Quick Settings, Notifications, Spotlight | ⌃⌘C, ⌃⌘N, ⌃⌘F   | a finger's drag                                                                                                                                    |
| Rotate Left, Rotate Right                                | ⌘←, ⌘→          | the device's own orientation: the first turn starts the agent, which a simulator may first have to build                                           |
| Save Screenshot, Copy Screen                             | ⌘S, ⌘C          | the device's own lossless picture, to the Desktop and the pasteboard, or to the pasteboard. No agent needed where the device has a way without one |
| Record Screen                                            | ⌥⌘R             | to Movies: a stream's own frames, or the device's recorder where its picture is no stream                                                          |
| Record Flow                                              | ⌥⌘T             | what a person does, as a flow: see [Recording a flow](#recording-a-flow)                                                                           |
| Open Link…                                               | ⌘O              | the Links pane, below                                                                                                                              |
| Send Push…                                               | ⇧⌘P             | the Push pane, below                                                                                                                               |
| Zoom to Fit, Actual Size, Zoom In, Zoom Out              | ⌘9, ⌘0, ⌘=, ⌘-  | Actual Size is one device point to one Mac point                                                                                                   |
| Reconnect                                                | ⇧⌘R             | a new stream                                                                                                                                       |

The Inspector (⌥⌘I) is the system's own, 320 points wide and edge to edge, and gives way by itself under 1,100 points wide, and the sidebar under 860, each back when the window is wide again. It stands open in the hub, and closed in a window of its own, which grows to take it. **Performance** says in one sentence how the screen is, then the frame rate, CPU and memory with a minute of each, the measures, and **Results**: what was measured on this device before, for the app in front, each judged by the gate's method against what the gate would hold as a reference: the clean runs before it, of the same kind of build. It reads as `Regression +553 ms` or `Could not judge: 3 of 5 samples`. A run taken from a window has its encoder at work on the device, so it enters no reference, and one that reads worse says `Could not judge: measured with a mirror running`; a regression is found in runs with no window open. It reads files only, so a phone is not touched for it. **Flows** records what a person does, and says what is under the pointer. **Apps** lists, launches, quits and removes, the last after a sheet that says what goes with it. On iOS the list holds the system's apps, as a new simulator has no other; on Android, only what was installed. **Activity** tells what an agent did as runs of work, `Worked for 40 s · 23 calls`, opening to `Tapped Sign in`.

**Links** opens a link on the device by `open_link`, the tool an agent calls, under the same policy: a web link, a universal link or App Link, or an app's own scheme. **Open Link…** (⌘O), in the File menu and in More Controls, shows it with its field ready, and Return sends. A second field names the app to open it in, filled with the app in front where the device says it is a person's own, and checked against the server's list of apps: an iPhone opens a link only in a named app, and elsewhere an empty field leaves the choice to the system. Its answer comes as it goes, and a refusal is shown whole, with what to do. The links opened stay for that device, the last eight, newest first, and under them stand the links the app in the app field opens, as `open_link` `links` lists them, with each kind and a domain's state. One chosen stands in the field, a filter's `*` left for a person to fill. A link a person sends is no agent's: the capsule does not say an AI client drives, and Activity does not list it. The first one opens a session on the device, as an agent's first call does. A simulator asks before an app's scheme first opens it, and the answer says so, as nothing has opened until a person answers it in the window. Run from a window kept behind on an iPhone 17 Pro simulator with iOS 27.2 and an API 34 emulator, at loads of 7 to 57: `appdyno-fixture://open/form` opened the fixture at its form, and `javascript:alert(1)` was refused, with nothing opened. The same on an iPhone 13 Pro Max with iOS 27.2, the fixture named in the app field, and on a Samsung Galaxy A52 with Android 14 over USB, at loads of 6 to 11.

**Push** sends a push to an app by `push`, the tool an agent calls. **Send Push…** (⇧⌘P), in the File menu and in More Controls, shows it, and it asks the op each time what this device takes. Each type the op lists is offered, and one the device does not take stands with why, and cannot be chosen. The fields follow the type, as the op lists them, and **Payload** starts from the op's own template for it, sent in place of the fields. The app is the one in front where the device says it is a person's own, or the one typed, and the types are those of that app, asked again once a person is done typing one, as an Android app's build may take another route. Return in a field sends, and the answer comes as a link's does, a refusal whole. Once a person has set APNs or FCM up with `appdyno push setup`, a route by it takes a token the app does not print: a field under the route, unseen as it is typed, with the kinds of token the routes go by, the kind of the chosen type first, keeps one for the app in the pane for this session only, as the pane says, by no tool an agent calls, and nothing says it back, logs it or writes it down; a push of that kind then goes by it. Run from a window kept behind on an iPhone 17 Pro simulator with iOS 27.2 at loads of 5 to 12, with made-up APNs credentials and the push sent to the test in Apple's place: the field stood with them and was gone without, and a rich push went by the token typed. Run from a window kept behind at loads of 40 to 52: on an iPhone 17 Pro simulator with iOS 27.2, just erased, an alert with a title and one data key reached the fixture's code once a person had allowed its notifications in the window; on an API 34 emulator and on the Samsung a tapped push opened the fixture with its two data keys as extras, which it showed. On the iPhone the pane listed each type with the iPhone's own reason, and so offered none to send.

While an agent drives, a purple ring runs around the screen, the capsule says so, naming the client where it says who it is, and a dot fades where each tap landed. A request for a person turns the ring orange.

What stands between a device and its picture is said in words with a next step. Asleep or locked, a card stands over the dimmed picture with what to do and **Try Again**, and a click beside its button still goes to the device. On a dark screen either lights it, as a person who asks wants it back. A device held up before its first picture has none to dim, so the room says it in the same words. A phone that is unplugged stays the one chosen under **Needs You**, as `Unplugged`, and comes back by itself; it is not swapped for another device. A cable that only charges looks like no phone at all, as nothing reaches this Mac to tell them apart, so what a person reads names that too.

Motion is for what changes: a device coming or going in the sidebar, 200 ms; the first frame fading into a bezel that stands at once, 200 ms; the ring, 240 ms; a dot, 300 ms; a step of a measure's bar, 150 ms; one small spring for a regression. Nothing moves at rest, and with Reduce Motion set each is a plain cut. VoiceOver hears a device arriving or leaving and a regression found.

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

**Which screen a click means.** It is the one before it, and when a click is known its effect has begun. So while a recording runs or the pane is open, the screen is read all the time, beside touches: a touch has left for the device before anything here hears of it, no read starts with a finger down or for 100 ms after, and a read takes at most half of the time. A click takes the newest read since the last input, else the one under way. A hover asks the device nothing. Nothing is read with neither in use, nor while the stream is down or a measure runs. Such a read is a look: it wakes no dark screen and opens no lock, as `tree` does for a tool.

A click to the first picture it changed, 15 clicks each way, each from a still screen, through a window kept behind. On a simulator the click is on a list's first Add, and on Android on the fixture's frames button, as the bench's is, which draws each frame for 2 s. A window with no recording holds no UI automation on Android, and these start without it. On an iPhone a flick along the list stands in for the click, as a small change is lost in what its stream keeps sending.

| device               | no recording, p50, ms | recording, p50, ms | Mac's load |
| -------------------- | --------------------- | ------------------ | ---------- |
| simulator, iOS 27.2  | 102.3                 | 109.8              | 4          |
| emulator, Android 14 | 33.2                  | 35.1               | 3          |
| Xiaomi, Android 16   | 68.2                  | 67.1               | 3          |
| iPhone 13 Pro Max    | 110.7                 | 109.0              | 10         |

**Under the pointer.** With the Flows pane open, the pointer over the device shows the element under it, marked on the picture: its role, words, ref and id, what a click there would write, and what `audit` says of its contrast, read once per screen. An audit waits for the pointer to rest, may start a simulator's runner, and the pane says it is reading until it is done. No audit runs during a recording, as a read waiting behind one would come after the click it was to name, and the pane says so. What a click on the device does is chosen there: it **Touches** the device, **Copies** the element's selector, or **Asserts**, which adds a check to the recording and touches nothing: `assert id=result check=text equals="Sent: Ada"`, or `assert text="Bilgiler"` where its words are what names it.

The recording is the one `flow` keeps, a file per device. So `flow start` from an agent or the command line takes a person's clicks too, and a window's recording takes an agent's calls, each in the order they came. A flow's `stop` and `save` work on either.

## The hub

`appdyno hub` is one window: every device this Mac can reach in a sidebar, phones first, then what runs, with what is shut down folded away, and the one chosen live beside it, controlled right there. Choosing another took 0.4 to 0.8 s between a simulator and an Android emulator, at a load of about 250. Only what stands in the window streams, and a phone starts only when a person chooses it: a simulator or emulator already running may show at once, and no choice is kept from one launch to the next. The toolbar is the system's, with the same controls as a window of its own, and only what that device has. The Inspector is a click away, Performance first. Search takes what is folded too. The hub starts and stops what is virtual, and makes a new simulator or emulator from what this Mac has installed. Where nothing can be shown, it says what to do next.

**AI Clients**, under the devices, lists every MCP client `appdyno install` knows, each as it truly stands. Connected is earned only by a real call: the server keeps each client's name, version, way in and last call, and nothing it sent. Add and Remove show the exact lines first and take a second click, and Undo takes back that one entry. Test runs what an entry runs, as far as its list of tools, and says what to do when it fails; it calls no tool. For a client in a browser it starts and stops `appdyno mcp --http`, in a process that ends with the hub, with the token hidden until asked. A client's name comes from `packages/cli/src/clients.ts` by the parent, never from the viewer. See [Connecting a client](../guides/clients.md).

**Help**, under AI Clients, or command-?, needs no network. It says what appdyno is, gives prompts by goal filled with the device and the app last in front, each saying what it does to the device, says what each panel and number means, and runs `doctor`. The app is the one the Performance pane last named, so a system app, or on a simulator an app opened after its stream began, leaves a prompt saying `my app`. A place stands where a device would, so its stream ends, and the Inspector closes until a device is chosen. While it shows, the list of clients is read every 2 s, and nothing runs when it does not.

**Open in New Window**, in the More Controls menu, in a row's menu, or by shift-command-N, gives a device a window of its own, which is what `appdyno mirror` opens, by the same code: the hub shows that it is there, and can close it. A viewer that dies takes what stands in it, and the hub brings it back with the device it had: 0.6 s when its process was killed on an Android emulator and a simulator. After three in a minute it stops.

## Connect a Phone

Where the hub has nothing to show, Connect a Phone stands in its place, and its sidebar row keeps it reachable later. It holds nothing up: every other part of the hub stays open while it shows.

It finds the phone in your hand by itself. The Mac's USB registry names who made what is plugged in, whatever the phone allows, and asks the phone nothing: an Android with USB debugging off is there before adb has heard of it. So adb is asked for only with an Android in hand, after showing Google's terms, and Xcode only with an iPhone. With nothing on USB it says so plainly, and that a cable that only charges shows nothing, so to try another.

Each driver owns its steps (`guide` on its provider), and `doctor` and `NEEDS` hold the facts. The current step is one short sentence and a diagram drawn in the viewer, and it moves on as the phone's state changes:

| Phone   | Steps                                              | How it ticks                                                                                                                     |
| ------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Android | Get adb                                            | `doctor` finds adb                                                                                                               |
|         | Developer options, USB debugging                   | adb hears of the phone. From a Mac these two are one state, so a person moves between them with Next                             |
|         | Allow USB debugging                                | adb's state goes from `unauthorized` to `device`                                                                                 |
| Xiaomi  | USB debugging (Security settings), Install via USB | `persist.security.adbinput` and `adbinstall` read `1`. Neither holds the phone up: a person moves on with Next where they do not |
| iPhone  | Get Xcode, Trust, Developer Mode                   | `devicectl`'s pairing and Developer Mode state                                                                                   |

Build number's place is named for Samsung, Xiaomi and Pixel, and any other maker is told where it may be. Developer Mode says before it that the phone restarts. A lock or a dark screen is said only when the phone can be read. On a phone that has not allowed this Mac nothing can be, so that step says to wake it. What a runner needs comes from `doctor`, with Build Runner beside it.

A phone that gets ready while this place is on show, with no device on the stage, opens by itself. The stage makes room for one sentence on what to try, with AI Clients a click away, and the sentence goes by itself after 12 s. A phone that gets ready while a person is elsewhere gets its row and nothing moves, and of two phones the first opens and the second gets its row. A phone that was ready all along waits for its row or for Open, as any other does: a phone is touched only when a person works on it or chooses it. A phone under Needs You opens here, on its step. While this place shows, the phone is read every 3 s, and nothing is read when it does not.

## Tools

Tools runs what appdyno does at a terminal, each row the very command, spawned by the hub from one table (`HUB_RUNS` in `packages/appdyno/src/hub-run.ts`), with no second implementation. Nothing a window sends becomes a command by itself. A row ends in a person's sentence, with its device, how long it took and its page. The command and all it said stay behind Show Details, so that no device id or temporary path stands in the way. A row that lacks an app, a device or a folder stands dimmed, and what is missing is said once, at the top. Stop is Ctrl-C to all the command started, so a flight recorder saves what it holds. The gate's row goes by what the gate printed and not by its exit code, which is 1 for a regression and for a change it could not judge alike, and 0 for too few samples: a regression is red, what it could not judge is orange, and only a clear answer is green. A baseline short of runs is saved and says so.

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

A touch on either window goes to both. It waits for both screens to be read, so that what it means is read as it was before it landed, and then goes to both at once. That wait is what **To both** costs: a read took 30 to 60 ms on a simulator and an Android emulator, and on two phones the wait comes to 150 to 250 ms, as the table says. On the other device it goes to the same thing, by id or by words, and to the same one among those called alike, as two devices rarely have a thing in the same place. A finger on nothing with a name goes to the same place, and a drag keeps its length from where it landed. Keys, text and the window's device controls go to both.

A real click's release to the first changed picture in the window, on a Samsung SM-A525F and a Xiaomi 25078RA3EY side by side at 720x1600, load 5, 15 clicks each way, every one landing. This is a person's own measure and not the bench's, which stops as a frame arrives:

| Clicked on | Here only, both streams up, p50, ms | To both, on the clicked device, p50, ms | To both, on the other, p50, ms |
| ---------- | ----------------------------------- | --------------------------------------- | ------------------------------ |
| Xiaomi     | 97                                  | 243                                     | 265                            |
| Samsung    | 113                                 | 368, from 180 to 623                    | 363                            |

Here only is what each phone reads alone, so a second stream costs nothing measurable, and what To both adds is that wait. The reads were not timed apart from it.

Each device says where a touch goes, and what became of it. The subtitle says **To both** with an edge of the accent's colour around the device, or **Here only** once the link control is off, and a ring shows where a touch landed on each screen. Where it failed the device's edge goes red and the subtitle says why, until a touch lands: `No Send here` where that device has no such thing, and nothing else is touched, `iPhone 17 Pro is not live`, `That did not land`. A drag that begins on such a thing goes on from the same place, as it means no one thing.

**Measure Journey…** in Performance measures a flow as `flow` `run` with `iterations` does, a first run left out and five kept, in the same store: `perf_compare` gates it, and the dashboard has it beside every other device. A flow that names no app takes your app in front, so builds under two ids can run one file. On two windows it runs on one device and then the other, as two at once would load each other, and touches stay on their own window meanwhile. Each window then says how it stands: `97 % slower, 1641 ms there`, and the step that moved most, by the rank test and the floor the gate uses for two conditions measured in turns, or `No clear difference`. Every step's numbers are in the row's tooltip. A window where the journey failed says so in red, and the other has nothing to compare.

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
is typed reaches the device and nothing else: no log, the Activity pane or `report` holds it. On an iPhone that takes a runner told so: XCTest writes a line for each key, a secure field's as well, and each field's value it reads, into the result bundle `xcodebuild` keeps, and its own typing writes the text into `xcodebuild`'s output. The runner turns those lines off, types by XCTest's event synthesizer, and `xcodebuild` keeps one folder for each device, `ios-<udid>.kept` in the state folder, replaced at each start and gone at a stop. A device test searches it.

Being the key window is not enough. The app in front hands activation to what it starts, so a terminal a person is typing in could give a new window their keys. A viewer therefore cannot be activated until it has launched, and one kept behind cannot be at all: the system calls it a background process. And a device hears no key, typed text, paste or device shortcut until a person's mouse has come down in that window, which holds until the window loses the keyboard. Coming back by ⌘Tab needs a click before keys reach the device; a menu chosen with the mouse needs none.

Typing goes through the system's own text input, so a dead key, an accent held down and an input method all work. ⌘V sends the Mac's text the same way, 4,096 characters at most, and the window says when it cut one short, as a long text goes one key at a time. A simulator types what a US keyboard has as keys and anything else by its pasteboard and command V, so an app may ask Allow Paste.

An iPhone's letters go by its runner, which the first letters start, about 3 s, as a string, so the phone's keyboard layout has no say in them: keys go by position, and on a Turkish layout `quick` went in as `quıck` and `-` as `*`, with no word. The first letters after a tap ask what is under it. On a text field they name that field, and go once it has the focus, in 2.3 s for a first tap in a new window and 70 to 200 ms for a tap from one field to the next; in 6 s they are dropped and the window says so, with what is typed after them until the next tap, because a keyboard stays up across that tap and letters that came early reached the field before it, a password among them. A tap on no field leaves the caret where it was, and they go there. A letter takes 285 ms by the runner, and at 8 letters a second a person sees them about 475 ms on, the worst 678, as those typed while one is on its way go together. Only what has text goes this way: a key with none, such as an arrow, goes as a key, after the letters before it.

In an app the runner was not told of, it cannot say what is under a tap, so the letters wait for one look by the phone's accessibility service, 3 s after it, and go only if that names a field, and another than the last unless the tap was on it. It is one look because looks in a row kept a field from the focus for 8.9 s. With no runner to be had the same look decides, the letters go by key position, and the window says that the phone's layout decides them.

An Android phone needs none of this. A Samsung and a Xiaomi took all 95 printable ASCII characters and `ç ğ ı İ ö ş ü` as given, through a window and through `type_text`, and letters typed 100 to 900 ms after a tap on a secure field landed there in 72 rounds of 72.

A window takes its menu bar and Dock icon at a person's first click, not before: an agent's window changes nothing on a Mac until someone uses it.

## Sharing a device

A window watches whoever holds the device: it takes no claim, and an agent holding one is no refusal. The pill on it
says who drives. `--no-input` makes it a window to look at only, and `--allow-devices` applies.

The hub and any client on this Mac meet on one agent, whichever came first, and a client that asks for the window of a
device standing in the hub is told it is open. That holds across builds too: a hub left open through an update keeps the
agent it started, and what starts later uses that one until the hub has closed.

A person's input always goes through, on a connection of its own, and it does not queue behind what an agent
does. `mirror status` tells an agent when a person last touched the window. While calls come, the window says an agent is driving. Its Activity pane lists each call: time, tool, how long, its result, with
typed text by its length and secrets hidden, by the code `report` uses. It reads
`activity/<serial>.jsonl` in the state directory: no socket, across processes.

An alert that only a person can answer (Face ID, Touch ID, a passcode, an Apple Account, Allow Paste, a VPN, a profile, a
purchase) is said in the answer that read the screen: `needs a person: Face ID`. `hand_off {reason, timeoutS}` puts a banner on the window with a sound, a Dock bounce and "I'm Done". With no
window, a sound and a best-effort notification of the reason, none on a server run with `--silent`, and it waits for the screen to change. It answers who ended the
wait, or that no one did.

`perf_*` on a mirrored device gets the noise mark `mirrored`, which holds a run out of a gate as high load does:
a stream runs an encoder on the device.

## What it shows

A mirror shows what the screen shows. `report`'s painted-over promise does not hold for a window. The agent's
token goes to a viewer by its stdin, never by its arguments.

## The size of a phone's picture

`--quality auto`, the default, takes the largest size that keeps up with a person: a picture that holds its rate can still run late, and a touch waits for exactly that. The agent reads what the encoder took on each run of motion, five frames or more, past the key frame, as a clock's tick or a ripple says nothing of it. Over 40 ms on two runs in a row, it goes straight to the size its pixels say will fit, and the next stream starts there. No model is named anywhere, and a phone whose encoder keeps up stays at its display's size. `--quality high` and `standard` keep the display's size, and a size asked for is that size.

It stops at the smallest size a person can read, and says the device cannot keep up: 1.12 pixels of picture for each dp of the screen, which is 1024 lines on a screen of 914 dp. Frame rate plays no part. This is what a real window showed of three Settings screens, as read by the Mac's Vision, in words of those it reads on the device's own picture:

| picture  | text at 14 sp | at 11 sp, Material's smallest | at 9 sp    |
| -------- | ------------- | ----------------------------- | ---------- |
| 576x1280 | 79 of 79      | 95 of 95                      | 104 of 104 |
| 456x1024 | 78 of 79      | 95 of 95                      | 102 of 104 |
| 360x800  | 79 of 79      | 93 of 95                      | 74 of 104  |

An eye agrees: at 360x800 a line of 9 sp text cannot be made out, and at 456x1024 it can. Body text alone says nothing here, which is why the floor is taken from the smallest. An encoder that refuses a size is another matter, and may still go below it: a picture of any size is better than none.

A size is no ratchet. Three runs in a row fast enough for the next size up, by the same rule of pixels, after 30 s at this one, and it goes up a size; a size that proved too slow is left for 5 minutes, twice as long each time a growth has to come back, up to an hour, until a new stream. A still screen reads nothing, so a picture grows as a person moves it. Under a load in the guest, on an emulator, a picture stayed at 456x1024 and said so; `device-tests/mirror.android.test.ts` holds that a stream grows on a real restart, with the reading asked for, as under a busy Mac a run read 968 ms at that size and no calm came by itself. On a Samsung A52 with Android 14, at load 8 to 25, with the reading asked for (`roomMs` 1500, so every quiet run reads as room, and what is real is the coming back and the wait), a stream went from 1600 lines to 1920 at 0.51 min and came back 2 s later; the next try came 10.0 min after that, twice the 5 minutes, and came back in 19 s.

| Samsung SM-A525F, 90 Hz | frames/s | capture to arrival p50, p95, ms | touch p50, ms |
| ----------------------- | -------- | ------------------------------- | ------------- |
| 1080x2400               | 89       | 69.3, 73.4                      | 217           |
| 720x1600                | 65       | 36.6, 64.5                      | 107           |
| 576x1280                | 69       | 26.4, 29.3                      | 94.8          |
| 456x1024                | 81       | 23.6, 26.5                      | 93.8          |

That phone's first stream settles on 576x1280, and the next starts there. A first run that is small can under-read, so a size may take two steps to settle, each a restart of the picture on a person's first touches.

What an encoder publishes of itself could not decide this: scaled as Android scales them, its `measured-frame-rate` figures say the Samsung's 2400 lines are faster than a Xiaomi's 1600, where a touch is more than twice as quick.

## The numbers

`packages/appdyno/scripts/mirror-bench.mjs <device>` runs the fixture's frames screen on Android and a list on
iOS, reads the screen before it touches, and says each target's verdict with the host's load beside it. All are
arrive-on-Mac figures, not glass. A miss above load 60 says "run it later". See [perf.md](perf.md#mirror).

## Looking at a window

A viewer kept behind, or with no window at all, copies to a board of its own, `dev.appdyno.behind`, as this Mac's pasteboard is a person's. `packages/core/test/viewer-behind.test.ts` reads the Mac's own count around a copy, and the viewer's self test around all it does.

`packages/appdyno/scripts/mirror-shots.mjs <simulator> <folder>` writes each state of a window, light and dark, with nothing brought forward. `--behind` keeps a real window off every screen, where the window server still composites it, glass and picture included, and `{"op":"snapshot","file":...}` writes it out; no permission is asked, as a process may read its own window. Hover, animation, sheets and the menu bar cannot be seen this way: those take a hand run.

## The wire

A viewer and its parent speak one JSON object a line, on the viewer's stdin and stdout, each with an `op`. Either side passes over a name it does not know, so `VIEWER_OPS` in `packages/core/src/mirror/viewer.ts` lists them all, the compiler holds the parent to that list, and a test holds it to the viewer's sources and to these tables. Names only: what a message carries is read where it is handled.

What it takes:

| Name         | What it asks                                       |
| ------------ | -------------------------------------------------- |
| `activity`   | A line for the Activity pane.                      |
| `agent`      | Who drives the device now, and by what tool.       |
| `answer`     | What came of a link or a push sent from a pane.    |
| `apps`       | What the Apps pane lists.                          |
| `attach`     | Show this source.                                  |
| `banner`     | Ask a person for something, or stop asking.        |
| `clients`    | What the AI Clients pane shows.                    |
| `copied`     | Put this image on the pasteboard.                  |
| `copyText`   | Put this text on the pasteboard.                   |
| `detach`     | Let the source go; the window stays.               |
| `element`    | What is under the pointer.                         |
| `flow`       | The steps of the recording.                        |
| `hub`        | The hub's list and what the chosen device shows.   |
| `mark`       | Time from now to the next changed frame.           |
| `measured`   | The result of a measure.                           |
| `measuring`  | A line on a measure under way.                     |
| `note`       | A line for a person.                               |
| `pair`       | The other device of a pair.                        |
| `perf`       | Live numbers.                                      |
| `poke`       | What a test does to the window, as a person would. |
| `quit`       | Close and exit.                                    |
| `raise`      | Come to the front, at a person's word.             |
| `record`     | Record the picture to this file.                   |
| `recording`  | Show that a recording runs.                        |
| `recordStop` | End the recording.                                 |
| `results`    | What was measured on this device before.           |
| `snapshot`   | Write the window to this file.                     |
| `status`     | The state to show.                                 |
| `tick`       | A new frame in the shared file.                    |
| `touchAt`    | Show where a touch landed.                         |
| `turns`      | Quarter turns that stand the picture up.           |
| `watch`      | Read the motion of the next frames.                |

What it says:

| Name        | What it means                                      |
| ----------- | -------------------------------------------------- |
| `app`       | An action from the Apps pane.                      |
| `board`     | The answer to a test's read of its own pasteboard. |
| `button`    | A device button was pressed.                       |
| `clicked`   | The answer to a test's click.                      |
| `closed`    | The window closed.                                 |
| `control`   | A control that is no input.                        |
| `done`      | A person answered a banner.                        |
| `fired`     | The answer to a test's menu item.                  |
| `first`     | The first picture of a source.                     |
| `hover`     | The pointer rests here.                            |
| `hub`       | A hub action, as `action` names it.                |
| `inspect`   | The element inspector went on or off.              |
| `key`       | A key went down or up.                             |
| `lost`      | The stream was lost, and if it can come back.      |
| `marked`    | The answer to `mark`.                              |
| `needKey`   | The decoder wants a keyframe.                      |
| `perfWatch` | The numbers are wanted, or no longer.              |
| `pick`      | A click on an element, in the inspector.           |
| `ready`     | The process is up.                                 |
| `recorded`  | The answer to `recordStop`.                        |
| `refused`   | It cannot open, and what it needs.                 |
| `sleep`     | The Mac goes to sleep.                             |
| `snapped`   | The answer to `snapshot`.                          |
| `stats`     | The stream's numbers, once a second.               |
| `text`      | Typed text.                                        |
| `touch`     | A finger went down, moved or lifted.               |
| `wake`      | The Mac woke.                                      |
| `watched`   | The answer to `watch`.                             |
| `zoom`      | The window's scale changed.                        |

## Stated limits

- An iPhone is experimental: it rests on undocumented services, which may change.
- An iPhone's lock screen: a swipe sent to it does not open it. Home does, from the window's controls.
- A hub closed as an iPhone connects: the window goes at once, and the process about 5 s after its runner's start began, as that start runs to its end and a runner outlives its host. A hub opened meanwhile comes up and is live.
- An iPhone on the heaviest picture, 167 Mbit/s, under load: 0.25 % of its packets lost over 30 minutes that began at load 361, each loss freezing the picture until a key. At load 8 over 15 minutes it lost 0.01 %, once, as the picture went heavy, for a freeze of 1.1 s.
- **Open Dashboard** in the Performance pane writes its page and opens it with `open`: that the page then shows in a browser needs a hand run, as a test must not bring anything forward.
- On a window a person has not clicked, keys go nowhere: typing into a window needs a hand run, as a test's window never holds the keyboard.
- A simulator's fold: no control that folds one was found, so a new surface at a fold is untested.
- The window does not yet show a secure Android window's content, as no shell can have it from Android 12: it is black, with the status bar still there. Not run on Android 12 and 13, or on 10, for which no image is here.
- Live numbers have been run on a simulator, an Android emulator, a Samsung, a Xiaomi and an iPhone. A window following a person from one app to another on an iPhone has been tested without a phone.
- A window's measures have been run on a simulator and an Android emulator. On an iPhone a launch has been run; a scroll runs its rounds and then the trace tool fails on its own trace, which the window says.
- What the readings cost a device has been measured on one Android 14 emulator, at rest on a screen changing ten times a second: 6.0 % of its whole CPU with a window open and the numbers shut, 10.8 % with them shown, over eight spells of 30 s. No phone has been measured.
- A device's colour: the frame takes one, and nothing yet reads it from a device, so every frame is the table's own graphite or carbon.
- The frame's Action button and Camera Control are drawn and do nothing: no input is known that presses them.
- With no runner, text an iPhone's keyboard has no key for goes by its pasteboard: the phone asks a person to allow the paste, and what it held comes back after, if that was text. In a secure field it does not go at all, and the window says so. The one look that decides there has unit tests only, in rounds on no phone.
- Why a first tap in a new window takes 2.3 s to give a field the focus is not known. It stays near that from round to round, with no read of the accessibility service in the way.
- Letters dropped because no field took them still reach a recording, which notes them as they leave the window: a replay types them.
- The More Controls menu, the frame's hover, a window's remembered size and place, and a trackpad's pinch or a dead key on a real keyboard have not been run by hand; their maths are checked by the self test.
- `auto` on a phone starts at its display's size and changes it, once, on the first motion that shows the encoder falling behind, so a person may see the picture restart on their first touches. `--quality high` and `standard` keep the display's size.
- A phone's touch has a floor below which no size goes: 94 ms on a Samsung SM-A525F at 1024 lines, and 95 to 107 at 1280 across runs, over the target of 80. A Xiaomi's reads 92 at its own size, a miss too.
- Two devices have been run on a simulator and an Android emulator, and on a Samsung and a Xiaomi, with the fixture on each. Two windows standing side by side on a screen are checked by the self test's maths and not by eye, as a test's windows are kept off every screen, and a rotated device has not been run in a pair. Two builds under two ids have not been run.
- Input by `key`: Android presses the agent's keys, and Esc is Back there, which is what a recording writes, so that a replay does what was done. On a simulator a keyboard's characters go as US keys; any other text by its pasteboard and command V.

- On an iPhone a recording and the pane read by its runner, which the first use starts: `inspector` gives words and ids with no places, so with no runner a click has no element to be named by, and the window says why.
- A flow made on an iPhone or a Xiaomi has been replayed there, on a simulator and on an emulator. One made on a simulator or an emulator has been replayed on the other, and on no phone.
- Clicks on a device's own keyboard have been recorded on a stand-in device only. A real pointer's hover, a wheel and a trackpad have not been run by hand: a test's window is given posted clicks, drags and hovers.
- A swipe keeps its direction and not its length: a replay's goes 40 % of the screen. What it reached is kept, as `scroll_to`, where a click or an assertion came next.
- A step is written when input leaves for the device, so what a device then refuses, such as a paste into an iPhone's secure field, is in the file as though it landed. The window says the refusal.
- Clicks on the device's own keyboard are told from the field afterwards, so its Return key is not seen: the Mac's keyboard records it, and the window says so.
- A flow goes to the Desktop under the device's name: rename it there. Steps cannot be taken back in the pane: a flow is a text file, so edit it.
- `flow start` from another process reaches a window within a quarter of a second, and clicks in that time are not recorded. Two processes writing to one recording in the same instant can lose a step.
- A hover and an assertion go by what was last read, so a screen that changed in the last read's time shows what it was, and a pointer resting on what came since says nothing until it moves.

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
`Live · 60 fps · Wi-Fi`. An address says nothing of whose it is, so a phone reached by `adb connect` keeps a row of its
own. An iPhone paired for Wi-Fi stands in the list with no cable, from what is on this Mac and with no look at the
network, and its window says if the phone is not there. It goes by the network with no `--wifi`, as it has nothing else.

A network that goes leaves no end to read, so silence is what tells: past it the last picture dims and the window
says `waiting not-connected`, as for a pulled cable. Measured on an emulator reached by address through a relay that
goes silent: said within 7 s of 20 s of silence, live within 1 s of the return, by itself.

A phone's own Wi-Fi going is another matter on Android. On a Samsung SM-A525F by its Wi-Fi serial with its cable in, its Wi-Fi off for 20 s by `svc wifi`, one run at load 5: said at 7.1 s, and it did not come back by itself, as Android turned Wireless debugging off with the Wi-Fi and 30 s after the Wi-Fi returned it was still off. Turned on again, by `adb_wifi_enabled` over that cable, the window was live 1.6 s later. A phone with no cable takes a hand under Wireless debugging. adb then listed the phone twice, by its name and by the same with `(2)`, both reaching the one port the phone listened on, and still so after Wireless debugging was turned off and on: the hub keeps one row for it.

What Wi-Fi costs, measured on a Samsung SM-A525F against itself by cable (the table is in `reference/perf.md`): a touch takes about twice as long to show, 168 to 208 ms for 103 to 110, and a window opens 100 to 150 ms later, and once 1.4 s later. Most pictures arrive about as soon as by cable, and the slowest one in twenty about 50 ms later, which a person sees as an uneven picture on a phone that is moving. The network's round trip is the likely cause, though it was not measured apart: a ping to that phone took from 6 to 170 ms.

What it costs on an iPhone 13 Pro Max against itself by cable, in the same place: a window opens in 1.5 to 2.5 s for 0.5, a picture takes 44 to 59 frames a second for 60 and freezes 13 to 18 times a run for 0 to 4, each time for under a second, and a flick shows in 121 to 470 ms for 93 to 98. By Wi-Fi only 2 to 5 flicks of 10 showed at all in three runs of five, and no cause has been found.

Run on that Samsung by its Wi-Fi serial with its cable in, by the window suite kept behind, 12 of 12 at load 4: a picture, a tap, typing, a long press, a drag, Home, Recents, Back, turning it, a screenshot, the Inspector, its agent killed and back, a close and a new open. One phone has one agent whichever way it is reached.

Run on that iPhone with its cable in. A pairing: a question appears on the phone, a person accepts, and `appdyno pair` then says the two are paired. By the window suite kept behind, 16 of 16 by Wi-Fi with its letters still going by the cable: a flick, a tap, text, a secret off the pasteboard, dark and back, turning it, screenshots, a viewer killed. With the driver told there is no cable, so that picture, touches and letters all go through tunnels on the network, at load 4 to 7: the letters suite, 6 of 6, with each character a layout turns into another, a secret into a secure field tapped 100 and 900 ms before, a field without the focus, and no word left in what `xcodebuild` keeps; and the window suite with its real window kept behind, 17 of 17. `xcodebuild` started the runner by the cable in all of these.

A runner keeps to its phone's loopback, and on a phone paired for Wi-Fi it takes a tunnel too, with the same token. No listener could be kept to a tunnel alone, so on a paired phone its port stands open on Wi-Fi as well, and what comes that way is closed with nothing read. Tried on that iPhone: its token by the phone's Wi-Fi address was cut off within 15 ms, and through a tunnel it was answered. With no pairing on this Mac, that port refused on Wi-Fi.

With no runner to be had, as an `xcodebuild` that fails at once stood in for, one run each: text with no key, typed after a tap on a plain field, went by the pasteboard, the window said so and that letters now go by key position, and it waited on the phone's question about a paste; typed after a tap on a secure field, it did not go, and the window said that no field took it. The phone's own picture after both showed every field empty.

With the driver told there are no cables, a real hub lists a Samsung and an iPhone by Wi-Fi, each on one row, also with adb listing the Samsung twice, and each window's bar says so with live numbers beside it. With the cables seen, each is on one row by its cable.

A window on Wi-Fi does not do these:

- An iPhone's pairing cannot be made there: on the network a phone refuses to start one, so it takes a cable, once.
- A phone must share this Mac's network: an iPhone is found by what it advertises there, and an Android phone needs Wireless debugging left on, which its Wi-Fi going turns off.
- An iPhone by Wi-Fi takes the lower mode unless asked.

Not run with a cable out, so no claim is made: anything of an iPhone with no cable, and first whether `xcodebuild` can start its runner at all; a cable pulled from a phone in use, a window going on by Wi-Fi, and a row in a real hub changing with it. Not run on a phone: a network that goes on an iPhone, and the hub's card pairing a real phone, which its self test and unit tests hold.

## Left out, for now

Audio.
