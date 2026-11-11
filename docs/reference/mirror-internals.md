# How the window works

[Türkçe](mirror-internals.tr.md)

What [The window and the hub](mirror.md) leaves out: how the picture and the input travel, the wire between a window and its parent process, and what was run, on which device and at what load, to hold each claim. A load is the Mac's 1-minute load average. The phones named here are a Samsung Galaxy A52 (SM-A525F, Android 14), a Xiaomi (25078RA3EY, Android 16) and an iPhone 13 Pro Max (iOS 27.2).

## Where the picture comes from

The emulator's frame is RGBA in a file of exactly its size, top row first (the proto's comment says bottom up, and
a frame compared with `screencap` says not). Asked with no size or into a larger file, it answers every frame and writes
nothing. A guest that rotates draws sideways in a frame of the same shape, so the picture is stood up in the
viewer, with no new session. A simulator does the same in its surface, with no callback: its read helper says how the app in front is drawn, four times a second, so an app that does not turn stays upright on a turned device, and a touch is turned back on its way down. An emulator booted by `simulator` gets `-grpc <free port> -grpc-use-token` beside `APPDYNO_EMULATOR_ARGS` (unless
those name `-grpc`). The port is the emulator's own, as adb's is adb's. The picture's file is `0600` in the state
directory and goes with the session.

## States, and what tests each

What a window waits for is one table, `NEEDS` in `packages/core/src/mirror/need.ts`, which the window's banner, `mirror status` and a refusal use.

| what happens                  | tested by                                                 |
| ----------------------------- | --------------------------------------------------------- |
| device gone mid-stream        | an emulator killed under its stream; hand-run for a cable |
| simulator shut down           | a simulator shut down under its window                    |
| screen off                    | emulators and the Xiaomi                                  |
| encoder fails                 | agent unit; `failFirst` on emulators and the Xiaomi       |
| decoder fails                 | viewer self test; session unit                            |
| viewer dies                   | SIGKILL on each kind; session unit                        |
| parent dies                   | SIGKILL of `appdyno mirror`, then `dumpsys`               |
| agent stops                   | `shutdown` on emulators and the Xiaomi                    |
| Mac sleeps, wakes             | session unit; hand-run                                    |
| window covered                | viewer self test                                          |
| rotation, fold                | emulators; a simulator's by a suite, touches included     |
| second window on a device     | parent unit; two runs on the Xiaomi                       |
| several devices               | parent unit; three devices with one killed                |
| no compiler, no window server | session unit                                              |

## An iPhone

Everything that speaks to a phone's services is in `packages/driver-apple/src/phone-stream/`, with one way in: delete
that folder and the rest builds and passes its tests, an iPhone keeps its runner, and its mirror is refused as
`no-phone-stream`. A test holds that nothing else reaches into it.

It makes its own tunnel: `usbmuxd`, lockdown with this Mac's pair record, `CoreDeviceProxy`, then IPv6, TCP and UDP in a
thread of this process. It never connects to the discovery port of Apple's own tunnel, which takes one client and
would throw `remoted` off it; a test holds that too. The pair record is read and never written; by cable pairing is
never asked for, and any refusal stops with what a person must do. No socket opens on this Mac for any of it, so appdyno
still opens no listener.

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

## The window's look

The device stands on a ground painted from the hub's palette, under the system's toolbar. The system's glass has no colour of its own, so a window is as rich as what stands behind it, and colour lives around the picture, never on it.

The window is usually behind the one a person types in, so what it says is built to hold its strength there. AppKit fades the system's colours and every image in the bar of a window that is not key: its own title to 2:1. So the name in the bar is a label of ours, colours are resolved to plain ones, and symbols are drawn by a view of ours. Read off the pixels of the real window, dark and light, on a simulator, in each place of the hub, drawn as in use and as behind others: of 854 words and symbols each way, every word is at 4.5:1 or more and every symbol at 3:1, as they are with Reduce Transparency, Increase Contrast and Differentiate Without Color, and at both ends of the Liquid Glass setting. A window kept behind cannot be made key, so in use is how it is drawn, and no real key window was read.

Its words are in Turkish or English by the Mac's language, from one table, `mac/Viewer/WordsTable.m`. English is the key, so what the parent sends for a command line needs no second name: a label looks up the window's own words, and what the table has not got, such as a tool's own error, stands in English. What an app or a device names, such as an element's label, an app's or a device's name, an address, a log line or what an agent did to it, is never looked up, as `Settings` or `Small` there is a name: it stands as it came, inside one of the window's sentences too, which is said around it.

The frame is drawn in code from a small table by model: its corners, its island or notch, its buttons. Nothing of it is artwork, and it is drawn once per size, so a still window costs nothing for having it. A simulator's picture holds its own island, so the frame adds one only where a picture has none. **Show Device Frame** (⌥⌘F) takes it away, and the setting stays. The ground is a small picture mixed from the palette and stretched by the layer, with no blur pass, and its colours move round with the place on show. A device's colours reach it as hue only, each on its own side when two stand together, read at most every 2 s and once more as a screen stops. Below macOS 26 a sidebar and an Inspector are the system's older material, and the ground does not show through them. Reduce Transparency gives a plain ground and solid cards, Increase Contrast stronger lines and words, and Differentiate Without Color a shape for each state.

Only what changes a state moves, and it comes to rest within 300 ms: a place's ground crosses over, a step passes with one ring, a run lands with its mark, a result arrives in its list, and the capsule crosses over for a state. What a person repeats, a row, a tab or a button, happens at once, and a reading changes without a fade. Two things take longer because they explain, the rings on the step to do and the beats in its picture, three times each, and then they stop. A spinner runs only while a run does. Nothing moves on a window at rest, and with Reduce Motion a move is a cut.

Motion is for what changes: a device coming or going in the sidebar, 200 ms; the first frame fading into a bezel that stands at once, 200 ms; the ring, 240 ms; a dot, 300 ms; a step of a measure's bar, 150 ms; one small spring for a regression. Nothing moves at rest, and with Reduce Motion set each is a plain cut. VoiceOver hears a device arriving or leaving and a regression found.

## The panes, as run

**Logs, Crashes, Network and Accessibility.** Run from the hub kept behind on an iPhone 17 Pro simulator with iOS 27.2 and an API 34 emulator, at loads of 4 to 10, in each look and language: the fixture's log came in, its crash stood among its reports, a fetch it made stood with its token hidden on the simulator and as bytes on the emulator, and its accessibility screen's issues stood by kind, one marked on the picture.

**Links.** Run from a window kept behind on an iPhone 17 Pro simulator with iOS 27.2 and an API 34 emulator, at loads of 7 to 57: `appdyno-fixture://open/form` opened the fixture at its form, and `javascript:alert(1)` was refused, with nothing opened. The same on an iPhone 13 Pro Max with iOS 27.2, the fixture named in the app field, and on a Samsung Galaxy A52 with Android 14 over USB, at loads of 6 to 11.

**Push.** Run from a window kept behind on an iPhone 17 Pro simulator with iOS 27.2 at loads of 5 to 12, with made-up APNs credentials and the push sent to the test in Apple's place: the field stood with them and was gone without, and a rich push went by the token typed. Run from a window kept behind at loads of 40 to 52: on an iPhone 17 Pro simulator with iOS 27.2, just erased, an alert with a title and one data key reached the fixture's code once a person had allowed its notifications in the window; on an API 34 emulator and on the Samsung a tapped push opened the fixture with its two data keys as extras, which it showed. On the iPhone the pane listed each type with the iPhone's own reason, and so offered none to send.

**Device.** Run from a window kept behind on an API 34 emulator at loads of 5 to 10: dark mode and a text size of 1.3 set by the pane read so on the emulator, a location, a call and its end and a text message reached it, and in dark and light, English and Turkish, the hub ended 2.4 to 2.9 s after its window closed, with both read as before. On an iPhone 17 Pro simulator with iOS 27.2 at loads of 7 to 33, the same two were set and read so, the radios, the network's speed, the battery, the thermal state, the fold, animations, a call and a text message stood disabled with the simulator's own reasons, a location was set and cleared, and the hub ended 0.5 to 1 s after its window closed, with both read as before.

## A click, timed

A click to the first picture it changed, 15 clicks each way, each from a still screen, through a window kept behind. On a simulator the click is on a list's first Add, and on Android on the fixture's frames button, as the bench's is, which draws each frame for 2 s. A window with no recording holds no UI automation on Android, and these start without it. On an iPhone a flick along the list stands in for the click, as a small change is lost in what its stream keeps sending.

| device               | no recording, p50, ms | recording, p50, ms | Mac's load |
| -------------------- | --------------------- | ------------------ | ---------- |
| simulator, iOS 27.2  | 102.3                 | 109.8              | 4          |
| emulator, Android 14 | 33.2                  | 35.1               | 3          |
| Xiaomi, Android 16   | 68.2                  | 67.1               | 3          |
| iPhone 13 Pro Max    | 110.7                 | 109.0              | 10         |

## The hub, timed

Choosing another took 0.4 to 0.8 s between a simulator and an Android emulator, at a load of about 250. A viewer killed under the hub came back with the device it had in 0.6 s, on an Android emulator and a simulator.

A client's name comes from `packages/cli/src/clients.ts` by the parent, never from the viewer.

Connect a Phone's steps are each driver's own (`guide` on its provider), and `doctor` and `NEEDS` hold the facts; its diagram is drawn in the viewer. The hub's Tools come from one table, `HUB_RUNS` in `packages/appdyno/src/hub-run.ts`.

## Two devices, timed

A real click's release to the first changed picture in the window, on a Samsung SM-A525F and a Xiaomi 25078RA3EY side by side at 720x1600, load 5, 15 clicks each way, every one landing. This is a person's own measure and not the bench's, which stops as a frame arrives:

| Clicked on | Here only, both streams up, p50, ms | To both, on the clicked device, p50, ms | To both, on the other, p50, ms |
| ---------- | ----------------------------------- | --------------------------------------- | ------------------------------ |
| Xiaomi     | 97                                  | 243                                     | 265                            |
| Samsung    | 113                                 | 368, from 180 to 623                    | 363                            |

Here only is what each phone reads alone, so a second stream costs nothing measurable, and what To both adds is that wait. The reads were not timed apart from it.

## The keyboard

On an iPhone this takes a runner set up for it. By default XCTest writes a line for each key, a secure field's too, and each field value it reads, into the result bundle `xcodebuild` keeps, and its own typing writes the text into `xcodebuild`'s output. The runner turns those lines off, types by XCTest's event synthesizer, and `xcodebuild` keeps one folder for each device, `ios-<udid>.kept` in the state folder, replaced at each start and gone at a stop. A device test searches it.

Being the key window is not enough. The app in front hands activation to what it starts, so a terminal a person is typing in could give a new window their keys. A viewer therefore cannot be activated until it has launched, and one kept behind cannot be at all: the system calls it a background process. And a device hears no key, typed text, paste or device shortcut until a person's mouse has come down in that window, which holds until the window loses the keyboard. Coming back by ⌘Tab needs a click before keys reach the device; a menu chosen with the mouse needs none.

On an iPhone, typed text is sent by the runner as a string, so the phone's keyboard layout does not change it. Sent as key positions instead, a Turkish layout turned `quick` into `quıck` and `-` into `*`, and said nothing. The first letters start the runner, which takes about 3 s. The first letters after a tap ask what is under it. On a text field they name that field, and go once it has the focus, in 2.3 s for a first tap in a new window and 70 to 200 ms for a tap from one field to the next; in 6 s they are dropped and the window says so, with what is typed after them until the next tap, because a keyboard stays up across that tap and letters that came early reached the field before it, a password among them. A tap on no field leaves the caret where it was, and they go there. A letter takes 285 ms by the runner, and at 8 letters a second a person sees them about 475 ms on, the worst 678, as those typed while one is on its way go together. Only what has text goes this way: a key with none, such as an arrow, goes as a key, after the letters before it.

In an app the runner was not told of, it cannot say what is under a tap, so the letters wait for one look by the phone's accessibility service, 3 s after it, and go only if that names a field, and another than the last unless the tap was on it. It is one look because looks in a row kept a field from the focus for 8.9 s. With no runner to be had the same look decides, the letters go by key position, and the window says that the phone's layout decides them.

An Android phone needs none of this. A Samsung and a Xiaomi took all 95 printable ASCII characters and `ç ğ ı İ ö ş ü` as given, through a window and through `type_text`, and letters typed 100 to 900 ms after a tap on a secure field landed there in 72 rounds of 72.

## How the size was chosen

`--quality auto`, the default, takes the largest size that keeps up with a person: a picture that holds its rate can still run late, and a touch waits for exactly that. The agent reads what the encoder took on each run of motion, five frames or more, past the key frame, as a clock's tick or a ripple says nothing of it. Over 40 ms on two runs in a row, it goes straight to the size its pixels say will fit, and the next stream starts there. No model is named anywhere, and a phone whose encoder keeps up stays at its display's size. `--quality high` and `standard` keep the display's size, and a size asked for is that size.

It stops at the smallest size a person can read, and says the device cannot keep up: 1.12 pixels of picture for each dp of the screen, which is 1024 lines on a screen of 914 dp. Frame rate plays no part. This is what a real window showed of three Settings screens, as read by the Mac's Vision, in words of those it reads on the device's own picture:

| picture  | text at 14 sp | at 11 sp, Material's smallest | at 9 sp    |
| -------- | ------------- | ----------------------------- | ---------- |
| 576x1280 | 79 of 79      | 95 of 95                      | 104 of 104 |
| 456x1024 | 78 of 79      | 95 of 95                      | 102 of 104 |
| 360x800  | 79 of 79      | 93 of 95                      | 74 of 104  |

An eye agrees: at 360x800 a line of 9 sp text cannot be made out, and at 456x1024 it can. Body text alone says nothing here, which is why the floor is taken from the smallest. An encoder that refuses a size is another matter, and may still go below it: a picture of any size is better than none.

A size can go back up. Three runs in a row fast enough for the next size up, by the same rule of pixels, after 30 s at this one, and it goes up a size; a size that proved too slow is left for 5 minutes, twice as long each time a growth has to come back, up to an hour, until a new stream. A still screen reads nothing, so a picture grows as a person moves it. Under a load in the guest, on an emulator, a picture stayed at 456x1024 and said so; `device-tests/mirror.android.test.ts` holds that a stream grows on a real restart, with the reading asked for, as under a busy Mac a run read 968 ms at that size and no calm came by itself. On a Samsung A52 with Android 14, at load 8 to 25, with the reading asked for (`roomMs` 1500, so every quiet run reads as room, and what is real is the coming back and the wait), a stream went from 1600 lines to 1920 at 0.51 min and came back 2 s later; the next try came 10.0 min after that, twice the 5 minutes, and came back in 19 s.

| Samsung SM-A525F, 90 Hz | frames/s | capture to arrival p50, p95, ms | touch p50, ms |
| ----------------------- | -------- | ------------------------------- | ------------- |
| 1080x2400               | 89       | 69.3, 73.4                      | 217           |
| 720x1600                | 65       | 36.6, 64.5                      | 107           |
| 576x1280                | 69       | 26.4, 29.3                      | 94.8          |
| 456x1024                | 81       | 23.6, 26.5                      | 93.8          |

That phone's first stream settles on 576x1280, and the next starts there. A first run that is small can under-read, so a size may take two steps to settle, each a restart of the picture on a person's first touches.

What an encoder publishes of itself could not decide this: scaled as Android scales them, its `measured-frame-rate` figures say the Samsung's 2400 lines are faster than a Xiaomi's 1600, where a touch is more than twice as quick.

## Measuring a mirror

`packages/appdyno/scripts/mirror-bench.mjs <device>` runs the fixture's frames screen on Android and a list on
iOS, reads the screen before it touches, and says each target's verdict with the host's load beside it. All figures are the time a frame reaches this Mac,
not the time it shows on the phone's glass. A miss above load 60 says "run it later". The numbers are in [Mirror](perf-evidence.md#mirror), on the page of how the measures were validated.

## Looking at a window

A viewer kept behind, or with no window at all, copies to a board of its own, `dev.appdyno.behind`, as this Mac's pasteboard is a person's. `packages/core/test/viewer-behind.test.ts` reads the Mac's own count around a copy, and the viewer's self test around all it does.

`packages/appdyno/scripts/mirror-shots.mjs <simulator> <folder>` writes each state of a window, light and dark, with nothing brought forward. `--behind` keeps a real window off every screen, where the window server still composites it, glass and picture included, and `{"op":"snapshot","file":...}` writes it out; no permission is asked, as a process may read its own window. Hover, animation, sheets and the menu bar cannot be seen this way: those take a hand run.

## The wire

A viewer and its parent speak one JSON object a line, on the viewer's stdin and stdout, each with an `op`. Either side passes over a name it does not know, so `VIEWER_OPS` in `packages/core/src/mirror/viewer-wire.ts` lists them all, the compiler holds the parent to that list, and a test holds it to the viewer's sources and to these tables. `ViewerMessage` and `ViewerOrder` beside it give each name its fields, which the parent's handlers read by name, and the same test holds them to what the viewer writes and reads.

What it takes:

| Name         | What it asks                                                  |
| ------------ | ------------------------------------------------------------- |
| `activity`   | A line for the Activity pane.                                 |
| `agent`      | Who drives the device now, and by what tool.                  |
| `answer`     | What came of a link, a push or a capture asked for in a pane. |
| `apps`       | What the Apps pane lists.                                     |
| `attach`     | Show this source.                                             |
| `audit`      | What an audit found on the screen shown, or where it stands.  |
| `banner`     | Ask a person for something, or stop asking.                   |
| `clients`    | What the AI Clients pane shows.                               |
| `copied`     | Put this image on the pasteboard.                             |
| `copyText`   | Put this text on the pasteboard.                              |
| `crashes`    | The app's crash reports, for the Logs pane.                   |
| `detach`     | Let the source go; the window stays.                          |
| `element`    | What is under the pointer.                                    |
| `flow`       | The steps of the recording.                                   |
| `hub`        | The hub's list and what the chosen device shows.              |
| `logs`       | New lines of the app's log, or a new start.                   |
| `mark`       | Time from now to the next changed frame.                      |
| `measured`   | The result of a measure.                                      |
| `measuring`  | A line on a measure under way.                                |
| `network`    | The capture, what it saw and the ways the device has.         |
| `note`       | A line for a person.                                          |
| `pair`       | The other device of a pair.                                   |
| `perf`       | Live numbers.                                                 |
| `poke`       | What a test does to the window, as a person would.            |
| `quit`       | Close and exit.                                               |
| `raise`      | Come to the front, at a person's word.                        |
| `record`     | Record the picture to this file.                              |
| `recording`  | Show that a recording runs.                                   |
| `recordStop` | End the recording.                                            |
| `results`    | What was measured on this device before.                      |
| `snapshot`   | Write the window to this file.                                |
| `status`     | The state to show.                                            |
| `tick`       | A new frame in the shared file.                               |
| `touchAt`    | Show where a touch landed.                                    |
| `turns`      | Quarter turns that stand the picture up.                      |
| `watch`      | Read the motion of the next frames.                           |

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
| `paneWatch` | A pane that reads the device shows, or no longer.  |
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

## Limits, and what has not been run

- A hub closed as an iPhone connects: the window goes at once, and the process about 5 s after its runner's start began, as that start runs to its end and a runner outlives its host. A hub opened meanwhile comes up and is live.
- An iPhone on the heaviest picture, 167 Mbit/s, under load: 0.25 % of its packets lost over 30 minutes that began at load 361, each loss freezing the picture until a key. At load 8 over 15 minutes it lost 0.01 %, once, as the picture went heavy, for a freeze of 1.1 s.
- **Open Dashboard** in the Performance pane writes its page and opens it with `open`: that the page then shows in a browser needs a hand run, as a test must not bring anything forward.
- On a window a person has not clicked, keys go nowhere: typing into a window needs a hand run, as a test's window never holds the keyboard.
- A simulator's fold: no control that folds one was found, so a new surface at a fold is untested.
- Live numbers have been run on a simulator, an Android emulator, a Samsung, a Xiaomi and an iPhone. A window following a person from one app to another on an iPhone has been tested without a phone.
- A window's measures have been run on a simulator and an Android emulator. On an iPhone a launch has been run; a scroll runs its rounds and then the trace tool fails on its own trace, which the window says.
- What the readings cost a device has been measured on one Android 14 emulator, at rest on a screen changing ten times a second: 6.0 % of its whole CPU with a window open and the numbers shut, 10.8 % with them shown, over eight spells of 30 s. No phone has been measured.
- A device's colour: the frame takes one, and nothing yet reads it from a device, so every frame is the table's own graphite or carbon.
- With no runner, text an iPhone's keyboard has no key for goes by its pasteboard: the phone asks a person to allow the paste, and what it held comes back after, if that was text. In a secure field it does not go at all, and the window says so. The one look that decides there has unit tests only, in rounds on no phone.
- Why a first tap in a new window takes 2.3 s to give a field the focus is not known. It stays near that from round to round, with no read of the accessibility service in the way.
- Letters dropped because no field took them still reach a recording, which notes them as they leave the window: a replay types them.
- The More Controls menu, the frame's hover, a window's remembered size and place, and a trackpad's pinch or a dead key on a real keyboard have not been run by hand; their maths are checked by the self test.
- A phone's touch has a floor below which no size goes: 94 ms on a Samsung SM-A525F at 1024 lines, and 95 to 107 at 1280 across runs, over the target of 80. A Xiaomi's reads 92 at its own size, a miss too.
- Two devices have been run on a simulator and an Android emulator, and on a Samsung and a Xiaomi, with the fixture on each. Two windows standing side by side on a screen are checked by the self test's maths and not by eye, as a test's windows are kept off every screen, and a rotated device has not been run in a pair. Two builds under two ids have not been run.
- Input by `key`: Android presses the agent's keys, and Esc is Back there, which is what a recording writes, so that a replay does what was done. On a simulator a keyboard's characters go as US keys; any other text by its pasteboard and command V.

Recording a flow:

- On an iPhone a recording and the pane read by its runner, which the first use starts: `inspector` gives words and ids with no places, so with no runner a click has no element to be named by, and the window says why.
- A flow made on an iPhone or a Xiaomi has been replayed there, on a simulator and on an emulator. One made on a simulator or an emulator has been replayed on the other, and on no phone.
- Clicks on a device's own keyboard have been recorded on a stand-in device only. A real pointer's hover, a wheel and a trackpad have not been run by hand: a test's window is given posted clicks, drags and hovers.
- Clicks on the device's own keyboard are told from the field afterwards, so its Return key is not seen: the Mac's keyboard records it, and the window says so.
- `flow start` from another process reaches a window within a quarter of a second, and clicks in that time are not recorded. Two processes writing to one recording in the same instant can lose a step.
- A hover and an assertion go by what was last read, so a screen that changed in the last read's time shows what it was, and a pointer resting on what came since says nothing until it moves.

## Wi-Fi, as run

A phone's own Wi-Fi going is another matter on Android. On a Samsung SM-A525F by its Wi-Fi serial with its cable in, its Wi-Fi off for 20 s by `svc wifi`, one run at load 5: said at 7.1 s, and it did not come back by itself, as Android turned Wireless debugging off with the Wi-Fi and 30 s after the Wi-Fi returned it was still off. Turned on again, by `adb_wifi_enabled` over that cable, the window was live 1.6 s later. A phone with no cable takes a hand under Wireless debugging. adb then listed the phone twice, by its name and by the same with `(2)`, both reaching the one port the phone listened on, and still so after Wireless debugging was turned off and on: the hub keeps one row for it.

What Wi-Fi costs, measured on a Samsung SM-A525F against itself by cable (the table is in [Mirror](perf-evidence.md#mirror)): a touch takes about twice as long to show, 168 to 208 ms for 103 to 110, and a window opens 100 to 150 ms later, and once 1.4 s later. Most pictures arrive about as soon as by cable, and the slowest one in twenty about 50 ms later, which a person sees as an uneven picture on a phone that is moving. The network's round trip is the likely cause, though it was not measured apart: a ping to that phone took from 6 to 170 ms.

What it costs on an iPhone 13 Pro Max against itself by cable, in the same place: a window opens in 1.5 to 2.5 s for 0.5, a picture takes 44 to 59 frames a second for 60 and freezes 13 to 18 times a run for 0 to 4, each time for under a second, and a flick shows in 121 to 470 ms for 93 to 98. By Wi-Fi only 2 to 5 flicks of 10 showed at all in three runs of five, and no cause has been found.

Run on that Samsung by its Wi-Fi serial with its cable in, by the window suite kept behind, 12 of 12 at load 4: a picture, a tap, typing, a long press, a drag, Home, Recents, Back, turning it, a screenshot, the Inspector, its agent killed and back, a close and a new open. One phone has one agent whichever way it is reached.

Run on that iPhone with its cable in. A pairing: a question appears on the phone, a person accepts, and `appdyno pair` then says the two are paired. By the window suite kept behind, 16 of 16 by Wi-Fi with its letters still going by the cable: a flick, a tap, text, a secret off the pasteboard, dark and back, turning it, screenshots, a viewer killed. With the driver told there is no cable, so that picture, touches and letters all go through tunnels on the network, at load 4 to 7: the letters suite, 6 of 6, with each character a layout turns into another, a secret into a secure field tapped 100 and 900 ms before, a field without the focus, and no word left in what `xcodebuild` keeps; and the window suite with its real window kept behind, 17 of 17. `xcodebuild` started the runner by the cable in all of these.

A runner keeps to its phone's loopback, and on a phone paired for Wi-Fi it takes a tunnel too, with the same token. No listener could be kept to a tunnel alone, so on a paired phone its port stands open on Wi-Fi as well, and what comes that way is closed with nothing read. Tried on that iPhone: its token by the phone's Wi-Fi address was cut off within 15 ms, and through a tunnel it was answered. With no pairing on this Mac, that port refused on Wi-Fi.

With no runner to be had, as an `xcodebuild` that fails at once stood in for, one run each: text with no key, typed after a tap on a plain field, went by the pasteboard, the window said so and that letters now go by key position, and it waited on the phone's question about a paste; typed after a tap on a secure field, it did not go, and the window said that no field took it. The phone's own picture after both showed every field empty.

With the driver told there are no cables, a real hub lists a Samsung and an iPhone by Wi-Fi, each on one row, also with adb listing the Samsung twice, and each window's bar says so with live numbers beside it. With the cables seen, each is on one row by its cable.

Not run with a cable out, so no claim is made: anything of an iPhone with no cable, and first whether `xcodebuild` can start its runner at all; a cable pulled from a phone in use, a window going on by Wi-Fi, and a row in a real hub changing with it. Not run on a phone: a network that goes on an iPhone, and the hub's card pairing a real phone, which its self test and unit tests hold.
