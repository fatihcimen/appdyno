# Security

[Türkçe](SECURITY.tr.md)

## Reporting a vulnerability

Report it privately. Do not open a public issue. When this repository is public, use GitHub private
vulnerability reporting on it (the Security tab). Until then, write to fatih@fatihcimen.com.
Say what you did, what happened, and the version or commit.

## Nothing leaves the machine

appdyno has no telemetry and sends nothing anywhere. It asks for a release only while you run `appdyno update` or
Check for Updates: the npm registry from the package, this repository's releases from the app. The MCP server never
does. The app downloads adb from Google only when you accept Google's terms. A client that runs `npx -y appdyno` has npx ask the registry at each
start, before appdyno runs: that is npm's doing, and a global install, as `docs/guides/clients.md` says, keeps it from
changing the version.
One file comes by itself: Perfetto's trace processor, pinned to v59.1, which reads Android's traces. The first time
an Android trace needs it, and neither the app carries one nor `APPDYNO_TRACE_PROCESSOR` names one, it is fetched
once from Google's release of it on GitHub, and checked by its sha256. Nothing else comes unless you ask for it.
By default the MCP server speaks over stdio to the
client that started it and opens no network listener. Only `--http` opens one: see below. Measurements are stored on the local disk, under the state
directory or the `--measurements` directory. The Android agent listens on an abstract unix socket on the
device, reached through adb, and accepts a connection only with its launch token. An iPhone is reached
over USB, and by the network only once a person has paired it for that with `appdyno pair`. A window's picture comes from the same agent, with the same token, given to the viewer by its
stdin; on an emulator booted by `simulator` from that emulator's own gRPC port, behind its token, into a
file only this user can read.

## What the server can do

A client of the server can do on a device what a person holding it can: read the screen, tap, swipe and
type, open links, launch and stop apps, set the clipboard, location and orientation, take screenshots, and
read logs and crash records of an app. The Android agent runs as the shell user. Anything shown on the
screen is visible to the client, so assume the model sees it.

Limits you set:

- `--allow-devices`, `--allow-apps` and `--allow-urls` restrict where the server acts.
  `--allow-devices` is matched against a device's serial or UDID. `simulator` `boot` and `shutdown` match a simulator's or emulator's name too, and a stopped emulator by the serial it ran as when this tool shut it down: a device allowed for the one is allowed for the other. With it, `simulator create` and the hub's New Simulator are off: a new simulator could not be on the list, and one the server made would be a device the person never named.
- Under `--allow-apps`, Settings is an app like any other: `open_link` `settings` opens it, at any page, only with its
  id in the list, `com.apple.Preferences` on iOS and `com.android.settings` on Android, and so does a link to it, `App-prefs:` or `prefs:`, `package:`. `app install` installs only
  an app the list names, by the id the file holds, read before anything reaches the device; `build_and_run` is refused.
- `--no-home` blocks the home key.
- `APPDYNO_SECRETS=a,b` values are never shown back and never put on the clipboard. Logs and crash
  summaries are redacted of them.
- A timeline keeps a request by its method, host and path. `--full-urls` (`APPDYNO_FULL_URLS=1`) keeps its query too,
  where a token can ride, with a listed secret and what looks like a credential still hidden. It is a flag of the
  person who starts the server, and no argument an agent can pass.
- The server stops another tool's UI automation on Android only with `--takeover`. Without it, it names
  the holder and does nothing.

A window shows what the screen shows, to whoever sits at this Mac. `--no-input` makes it watch only.

## What waits for a person

No tool reboots, erases or resets a device or a simulator, and none deletes a simulator or emulator:
`packages/appdyno/test/device-reset.test.ts` fails if any source gains a way to. `simulator create` says how a person
removes what it made, and runs none of it.

A device's own controls do it too, and an agent can reach them as a person does: one restarted a phone by its quick
panel's power button, Restart and the confirmation. So every input the server sends a device passes one guard first,
`packages/ops/src/power.ts`: a tap, gesture, swipe, long press, typing or key, from any tool, `steps` or a flow replayed.
It reads the screen, and one that would act on the system's power, emergency or erase controls asks the person: Android's
power menu (Power off, Restart, Emergency), its button in quick settings and a lock screen's emergency call, a Samsung's
and a Xiaomi's power menu, Settings' resets and its erase-all-data screen and confirmation; iOS's slide to power off and
Emergency SOS, and Settings' Reset and Erase All Content and Settings. It knows them by the system app that shows them,
by the power menu's and the erase screen's ids in any language, and by their words in English and Turkish, however the
touch is aimed, by ref, selector or x,y. A third press of the power or side key in 5 seconds asks too, as presses in a
row call for help on many phones. Reading such a screen asks nothing, nor back and home, which leave it. The answer says
that appdyno does not restart, power off, reset or erase a device, and that the person does it. It is asked and refused
as what loses data is, below, and only `--allow-power virtual` (simulators and emulators) or `all` lets it go ahead
with nothing asked: `--allow-data-loss` does not, as a run that clears an app's data on an emulator must not find it
restarted. A window's own input is the person at it, and passes no guard.

`simulator` starts and stops a simulator or emulator, as its own tools do, and offers no reboot: a `shutdown` and a `boot` are two calls, and neither its description nor its answer puts them together as one. A `shutdown` asks no one: it loses nothing a device keeps on its disk, only the session on it and what its apps held in memory, as `terminate_app` does, which asks no one either. So its description says that before any call, and its answer says it once it shut down the selected device.

What loses data a person may want asks the person first: [the list](docs/reference/tools.md#what-asks-the-person-first).
The client shows the question, the model cannot answer it, and a no does nothing. A client may answer no by itself, so the answer says the question got no yes, never that the person declined, and every refusal says how a person allows it ahead. Where the client cannot ask, and over
`--http`, it is refused, unless the person started the server with `--allow-data-loss virtual` (simulators and
emulators) or `all`. Nothing a tool call carries sets that or stands for a yes. A model that can change the client's
settings or run a shell is past what the server can hold back: it can run `appdyno` with `--yes`, or `adb` itself, and
the client's own permission for each command is what stands then.

## Wi-Fi

`appdyno pair` makes an identity this Mac shares with one phone, once, with a person accepting on it. On an iPhone its
private key is in the state directory, under `wifi-pairing/`, readable by this user alone: **whoever has that file and
is on the phone's network can reach the phone's developer services**, as a window does. It is not the pair record,
which is read and never written. An iPhone's pairing is made on its cable, as on the network a phone allows none. At
each start the phone proves itself with the key it gave at pairing, so something else on the network that answers as it
is turned away. All of it is encrypted on the network. Android's is adb's own, kept by adb.

An iPhone's runner keeps to the phone's loopback unless the phone is paired so. A paired phone's runner takes a tunnel too,
with the same token, and as no listener could be kept to a tunnel alone its port stands open on the phone's network while
it runs: a connection is read only when it came by the loopback, or by an interface of a tunnel's kind from the Mac's end
of a tunnel to the phone's, which every tunnel seen made `::2` and `::1` of one private /64. Any other is closed with
nothing read from it, the phone's Wi-Fi and a VPN's among them, but for a VPN on the phone set up with addresses of that
same form, which would reach the runner's token.

## `--http`

`appdyno mcp --http 127.0.0.1:PORT` serves the same tools over MCP's Streamable HTTP. It binds only to this Mac's
loopback and refuses any other address. Every request needs the token, compared in constant time, and one with an
`Origin` other than the server's own is refused, so a web page cannot reach it. A generated token is printed once,
at the start, and no token goes in the log.

A tunnel is what puts it on the internet, and you run that: appdyno runs none, and there is no service of ours.
**Whoever has the address and the token can do all of the above on your devices, and read and write files on this
Mac where a tool takes a path.** Whoever runs the tunnel and the client sees the traffic, and a token in an address
shows in a tunnel's logs. Keep it short, keep to `--allow-devices`, `--allow-apps` and `--allow-urls`, and stop it
when you are done. The server cannot tell two holders of a token apart: it knows a client by the name it gives,
to keep two clients off one context, not to keep anyone out.

Use a test device and test accounts. Do not point the server at a device that holds real data.
