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
```

The `mirror` tool has `open`, `close`, `status` and `stats`. No frames pass over MCP: an agent has `screenshot`
and `record`. `hand_off` asks a person for what an agent cannot do.

## What feeds it

| device    | how                                                                                         | what to know                                                                                               |
| --------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| simulator | CoreSimulator's own surface, no encode: the framebuffer itself, called back on each present | a still screen costs nothing. Private API, loaded at run time; what fails says so                          |
| phone     | the agent's stream on a connection of its own: nothing passes through Node                  | H.264 by default, HEVC at your word. Android 10 and up. A secure window is black from Android 12 (not run) |
| emulator  | the emulator's own gRPC port, its screen in a shared file, nothing in the guest             | the emulator's port, not ours. Where it has none, the guest encodes, which lags by seconds, and it says so |

The emulator's frame is RGBA in a file of exactly its size, top row first (the proto's comment says bottom up, and
a frame compared with `screencap` says not). Asked with no size or into a larger file, it answers every frame and writes
nothing. A guest that rotates draws sideways in a frame of the same shape, so the picture is stood up in the
viewer, with no new session. An emulator booted by `simulator` gets `-grpc <free port> -grpc-use-token` beside `APPDYNO_EMULATOR_ARGS` (unless
those name `-grpc`). The port is the emulator's own, as adb's is adb's. The picture's file is `0600` in the state
directory and goes with the session.

## Its states

`connecting`, `live`, `waiting {need}`, `reconnecting {attempt}`, `stopped {why}`. What it waits for is one table,
`NEEDS` in `packages/core/src/mirror/need.ts`, used by the window's banner, `mirror status` and a refusal, each with
its words and its fix. A wait asks again each second and goes on by itself when it clears.

| what happens                  | what it does                                                                                      | tested by                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| device gone mid-stream        | last picture dimmed, banner, `waiting not-connected`; back: live again                            | session unit; `emu kill` by hand-run   |
| screen off                    | `waiting asleep`, and on when a person wakes it                                                   | session and adapter units              |
| encoder fails                 | restart 3 times, 500 ms apart; smaller; the other codec; software; then `stopped` with the reason | agent unit; `failFirst` on an emulator |
| decoder fails                 | a keyframe is asked for and the picture held; three in a row, a new stream; then `stopped`        | viewer self test; session unit         |
| viewer dies                   | restarted at once, same zoom; twice in a minute, `stopped` with what it said                      | session unit; SIGKILL on each kind     |
| parent dies                   | the viewer's stdin ends, so it ends; the agent sees that and releases the display and codec       | SIGKILL in the viewer test; `dumpsys`  |
| agent stops                   | `reconnecting`, and the agent starts by the path every driver uses                                | `shutdown` on an emulator              |
| Mac sleeps, wakes             | the stream ends, and comes back on wake                                                           | session unit; hand-run                 |
| window covered                | frames are read and not decoded or drawn; back with a keyframe                                    | viewer self test                       |
| rotation, fold                | a new size with no new session: the agent restarts its encoder, a simulator's surface changes     | emulator suite                         |
| second window on a device     | the first comes forward, and the refusal says who has it                                          | parent unit                            |
| several devices               | one viewer each, `--max`; one failing leaves the others                                           | parent unit; device run                |
| no compiler, no window server | `stopped` by its need, before anything opens                                                      | session unit                           |

## Sharing a device

A viewer goes through the same claims as any process: `appdyno mirror` holds the device, or is refused with who
does, unless `--share`. `--takeover` and `--allow-devices` apply. A window opened by the `mirror` tool shares,
as it serves the session that opened it.

A person's input always goes through, on a connection of its own, and it does not queue behind what an agent
does. `mirror status` tells an agent when a person last touched the window. While calls come, a pill on the window
says an agent is driving. The window's Activity panel lists each call: time, tool, how long, its result, with
typed text by its length and secrets hidden, by the code `report` uses. It reads
`activity/<serial>.jsonl` in the state directory: no socket, across processes.

`hand_off {reason, timeoutS}` puts a banner on the window with a sound, a Dock bounce and "I'm Done". With no
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

## Left out, for now

An iPhone, which is a later adapter adding one kind of source. Wi-Fi. Recording through the stream. The toolbar,
shortcuts and device menu. Audio. A device frame.
