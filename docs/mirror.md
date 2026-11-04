# Mirror

`appdyno mirror` opens one native window per device, driven by mouse, trackpad and keyboard, while an agent
may drive the same device. A window is a small Objective-C program, compiled by `clang` on first use as the
simulator helpers are: Command Line Tools are enough. Node is the control plane: it starts and stops streams,
carries input, names what is wrong, and reconnects. There is no server, no daemon and no listener of ours.

```sh
appdyno mirror                     # open this device's window and stay
appdyno mirror --all [--watch]     # every device, and new ones as they come; at most --max, default 8
appdyno mirror open --detach       # a window that outlives this command
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
would throw `remoted` off it; a test holds that too. The pair record is read and never written; pairing is never asked
for, and any refusal stops with what a person must do. No socket opens on this Mac for any of it, so the README's
line on listeners stands.

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
press of `home` on a dark phone lights its lock screen, and a second opens a phone with no passcode. A click on the window is the one thing that presses it, on a dark phone only. Input is opened anew after a dark screen, as a finger sent on a connection from before it goes nowhere; a swipe sent to
a phone does not open a lock screen.

A phone that turns keeps sending a picture of the same shape with the app on its side. SpringBoard says how the app in front is drawn, four times a second, over a lockdown service of its own, so the window stands the picture up and a touch is turned back on its way down.

## The window

The device stands full bleed on a backdrop of its own picture's colours, with glass floating over it: a capsule that says how it is, its controls, and the Inspector. Glass is the system's own, found at run time, as a viewer is compiled by whatever SDK a Mac has; before macOS 26 a material stands in. It is only what floats: what sits on a pane is a fill, as glass cannot sample glass.

The frame is drawn in code from a small table by model: its corners, its island or notch, its buttons. Nothing of it is artwork, and it is drawn once per size, so a still window costs nothing for having it. A simulator's picture holds its own island, so the frame adds one only where a picture has none. **Show Device Frame** (⌥⌘F) takes it away, and the setting stays. The backdrop is a few cells of the picture's colours stretched by the layer, read at most every 2 s, with no blur pass.

The buttons on the frame work: a click presses them, and holding the side button is Siri. A window keeps its size and place per device. It can be any size: the device takes the room there is, and zoom sets the window to fit it.

The window shows what is pressed most, and the rest is a click away in **More** and in the menu bar. Both come from one table, so that no control is in one and missing from the other. What a device has not got, it does not show: Android has Back and Quick Settings, and no Siri.

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
| Zoom to Fit, Actual Size, Zoom In, Zoom Out              | ⌘9, ⌘0, ⌘=, ⌘-  | Actual Size is one device point to one Mac point                                                                                                   |
| Reconnect                                                | ⇧⌘R             | a new stream                                                                                                                                       |

The Inspector (⌥⌘I) opens beside the device, which keeps its size. **Stats** says what the viewer counts each second, and Still on a still screen, with the rate it last moved at. **Activity** lists each call an agent made. **Apps** lists, launches, quits and removes, the last after a sheet that says what goes with it. On iOS the list holds the system's apps, as a new simulator has no other; on Android, only what was installed.

While an agent drives, a ring of the accent colour runs around the edge of the screen and the capsule names the call. What stands in the way is a card over the dimmed picture with its fix, and a click beside a card's button still goes to the device.

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
is typed reaches the device and nothing else: no log, the Activity pane or `report` holds it.

Typing goes through the system's own text input, so a dead key, an accent held down and an input method all work. ⌘V sends the Mac's text the same way, 4,096 characters at most, and the window says when it cut one short, as a long text goes one key at a time. A simulator types what a US keyboard has as keys and anything else by its pasteboard and command V, so an app may ask Allow Paste.

A window takes its menu bar and Dock icon at a person's first click, not before: an agent's window changes nothing on a Mac until someone uses it.

## Sharing a device

A window watches whoever holds the device: it takes no claim, and an agent holding one is no refusal. The pill on it
says who drives. `--no-input` makes it a window to look at only, and `--allow-devices` applies.

A person's input always goes through, on a connection of its own, and it does not queue behind what an agent
does. `mirror status` tells an agent when a person last touched the window. While calls come, the window says an agent is driving. Its Activity pane lists each call: time, tool, how long, its result, with
typed text by its length and secrets hidden, by the code `report` uses. It reads
`activity/<serial>.jsonl` in the state directory: no socket, across processes.

An alert that only a person can answer (Face ID, Touch ID, a passcode, an Apple Account, Allow Paste, a VPN, a profile, a
purchase) is said in the answer that read the screen: `needs a person: Face ID`. `hand_off {reason, timeoutS}` puts a banner on the window with a sound, a Dock bounce and "I'm Done". With no
window, a sound and a best-effort notification, and it waits for the screen to change. It answers who ended the
wait, or that no one did.

`perf_*` on a mirrored device gets the noise mark `mirrored`, which holds a run out of a gate as high load does:
a stream runs an encoder on the device.

## What it shows

A mirror shows what the screen shows. `report`'s painted-over promise does not hold for a window. The agent's
token goes to a viewer by its stdin, never by its arguments.

## The numbers

`packages/appdyno/scripts/mirror-bench.mjs <device>` runs the fixture's frames screen on Android and a list on
iOS, reads the screen before it touches, and says each target's verdict with the host's load beside it. All are
arrive-on-Mac figures, not glass. A miss above load 60 says "run it later". See [perf.md](perf.md#mirror).

## Looking at a window

`packages/appdyno/scripts/mirror-shots.mjs <simulator> <folder>` writes each state of a window, light and dark, with nothing brought forward. `--behind` keeps a real window off every screen, where the window server still composites it, glass and picture included, and `{"op":"snapshot","file":...}` writes it out; no permission is asked, as a process may read its own window. Hover, animation, sheets and the menu bar cannot be seen this way: those take a hand run.

## Stated limits

- An iPhone is experimental: it rests on undocumented services, which may change.
- An iPhone's lock screen: a swipe sent to it does not open it. Home does, from the window's controls.
- An iPhone on the heaviest picture, 167 Mbit/s, under load: 0.25 % of its packets lost over 30 minutes that began at load 361, each loss freezing the picture until a key. At load 8 over 15 minutes it lost 0.01 %, once, as the picture went heavy, for a freeze of 1.1 s.
- On a window a person has not clicked, keys go nowhere: typing into a window needs a hand run, as a test's window never holds the keyboard.
- A simulator's fold: no control that folds one was found, so a new surface at a fold is untested.
- The window does not yet show a secure Android window's content, as no shell can have it from Android 12: it is black, with the status bar still there. Not run on Android 12 and 13, or on 10, for which no image is here.
- A device's colour: the frame takes one, and nothing yet reads it from a device, so every frame is the table's own graphite or carbon.
- The frame's Action button and Camera Control are drawn and do nothing: no input is known that presses them.
- A stream's picture gives the backdrop no colours: only a surface is read so far, so a phone's window has a plain one.
- Text an iPhone's keyboard has no key for goes by its pasteboard: the phone asks a person to allow the paste, and what it held comes back after, if that was text. In a secure field it does not go at all, and the window says so.
- More's menu, the frame's hover, a window's remembered size and place, and a trackpad's pinch or a dead key on a real keyboard have not been run by hand; their maths are checked by the self test.
- Input by `key`: Android has only the keys the agent has (no arrows). On a simulator a keyboard's characters go as US keys; any other text by its pasteboard and command V.

## Left out, for now

Wi-Fi, which needs an identity of our own paired with the phone. Audio.
