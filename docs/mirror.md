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
  --quality auto|high|standard  --codec h264|hevc  --no-input  --headless  --seconds N  --share  --takeover
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
press of `home` on a dark phone lights its lock screen, and a second opens a phone with no passcode; a swipe sent to
a phone does not open a lock screen.

## The keyboard

A window never takes the keyboard by itself: not when it opens, reconnects or restarts, and not when an agent opens it.
A person's click gives it, or `--focus` at the first opening. A key that reaches a window without the keyboard goes
nowhere. A window an agent opened also holds all input until a person's click, and that click goes no further. What
is typed reaches the device and nothing else: no log, the Activity panel or `report` holds it.

## Sharing a device

A viewer goes through the same claims as any process: `appdyno mirror` holds the device, or is refused with who
does, unless `--share`. `--takeover` and `--allow-devices` apply. A window opened by the `mirror` tool shares,
as it serves the session that opened it.

A person's input always goes through, on a connection of its own, and it does not queue behind what an agent
does. `mirror status` tells an agent when a person last touched the window. While calls come, a pill on the window
says an agent is driving. The window's Activity panel lists each call: time, tool, how long, its result, with
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

## Stated limits

- A simulator's fold: no control that folds one was found, so a new surface at a fold is untested.
- The window does not yet show a secure Android window's content, as no shell can have it from Android 12: it is black, with the status bar still there. Not run on Android 12 and 13, or on 10, for which no image is here.
- Input by `key`: Android has only the keys the agent has (no arrows). On a simulator a keyboard's characters go as US keys; any other text by its pasteboard and command V.

## Left out, for now

Wi-Fi, which needs an identity of our own paired with the phone. Recording through the stream. The toolbar,
shortcuts and device menu. Audio. A device frame.
