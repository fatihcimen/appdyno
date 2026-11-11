# Security

[Türkçe](SECURITY.tr.md)

## Reporting a vulnerability

Report it privately, never in a public issue. Use GitHub's private vulnerability reporting: this repository's Security tab, then Report a vulnerability. If you cannot use it, write to fatih@fatihcimen.com.

Say what you did, what happened, and the version or commit. You will get an answer within 7 days.

Only the latest release is supported: a fix comes out as a new release, and older releases get none.

## Nothing leaves the machine

appdyno has no telemetry and sends nothing anywhere unless you ask. What it fetches, and when:

- A release, only while you run `appdyno update` or Check for Updates: the package asks the npm registry, the app asks this repository's releases. The MCP server never does.
- adb, from Google, only when you accept Google's terms: in the app's menu bar, or with `appdyno tools install adb --accept-license`.
- Perfetto's trace processor, pinned to v59.1, which reads Android's traces. The first time an Android trace needs it, and neither the app carries one nor `APPDYNO_TRACE_PROCESSOR` names one, it is fetched once from Google's release of it on GitHub, and checked by its sha256. This is the one file that comes by itself.
- A `push` by Apple's or Google's service, once a person has set that service up with `appdyno push setup`, goes to that service, signed with the key given for it. The payload and the device's push token leave this Mac then, and at no other time.

A client that runs `npx -y appdyno` has npx ask the npm registry at each start, before appdyno runs. That is npm's doing, and a global install keeps it from changing the version, as [the clients guide](docs/guides/clients.md#keep-appdyno-current) says. Nothing else comes unless you ask for it.

By default the MCP server speaks over stdio to the client that started it, and opens no network listener. Only `--http` opens one: see [below](#--http).

Measurements are stored on the local disk, under the state directory or the `--measurements` directory. The Android agent listens on an abstract unix socket on the device, reached through adb, and accepts a connection only with its launch token. An iPhone is reached over USB, and by the network only once a person has paired it for that with `appdyno pair`. A window's picture comes from the same agent, with the same token, given to the viewer by its stdin; on an emulator booted by `simulator`, it comes from that emulator's own gRPC port, behind its token, kept in a file only this user can read.

## What the server can do

A client of the server can do on a device what a person holding it can: read the screen, tap, swipe and type, open links, launch and stop apps, set the clipboard, location and orientation, take screenshots, and read logs and crash records of an app. The Android agent runs as the shell user. Anything shown on the screen is visible to the client, so assume the model sees it.

Limits you set:

- `--allow-devices`, `--allow-apps` and `--allow-urls` restrict where the server acts. `--allow-devices` is matched against a device's serial or UDID. `simulator` `boot` and `shutdown` match a simulator's or emulator's name too, and a stopped emulator by the serial it ran as when this tool shut it down: a device allowed for the one is allowed for the other. With it, `simulator create` and the hub's New Simulator are off: a new simulator could not be on the list, and one the server made would be a device the person never named.
- Under `--allow-apps`, Settings is an app like any other: `open_link` `settings` opens it, at any page, only with its id in the list, `com.apple.Preferences` on iOS and `com.android.settings` on Android, and so does a link to it, `App-prefs:` or `prefs:`, `package:`. `app install` installs only an app the list names, by the id the file holds, read before anything reaches the device; `build_and_run` is refused. Every input lands in an allowed app's window, or in one a person uses over an allowed app in front: its keyboard, a permission or system alert, the share sheet. One that would land elsewhere, a home screen, a browser, Settings, is refused, and the answer says how a person allows that app. `open_link` opens a link only in an allowed app, as the device tells before it sends it: Android holds it to the selected app, or to the one the system picks, by `-p`; a simulator opens only a link the selected app says it opens, by its scheme or its domain; an iPhone opens it in the app it is sent to.
- `--no-home` blocks every key that leaves the app, the home key among them, and Settings by any tool: `open_link` `settings`, a link to it, `launch_app`, `app launch` and a `perf_` measure, which may start its app. A swipe or a tap by x,y that goes home, and a tap on Settings' icon there, is held only by `--allow-apps`.
- `APPDYNO_SECRETS=a,b` values are never shown back and never put on the clipboard. Logs and crash summaries are redacted of them.
- A timeline keeps a request by its method, host and path. `--full-urls` (`APPDYNO_FULL_URLS=1`) keeps its query too, where a token can ride, with a listed secret and what looks like a credential still hidden. It is a flag of the person who starts the server, and no argument an agent can pass.
- The server stops another tool's UI automation on Android only with `--takeover`. Without it, it names the holder and does nothing.

A window shows what the screen shows, to whoever sits at this Mac. `--no-input` makes it watch only.

## What waits for a person

No tool reboots, erases or resets a device or a simulator, and none deletes a simulator or emulator: [`packages/appdyno/test/device-reset.test.ts`](packages/appdyno/test/device-reset.test.ts) fails if any source gains a way to. `simulator create` says how a person removes what it made, and runs none of it.

A device's own controls can restart or erase it, and an agent can reach them as a person does: in testing, an agent restarted a phone by tapping the power button in quick settings, then Restart, then the confirmation. So every input the server sends a device passes one guard first, [`packages/ops/src/power.ts`](packages/ops/src/power.ts): a tap, gesture, swipe, long press, typing or key, from any tool, `steps` or a flow replayed. It reads the screen, and reads it again after any input that may have changed it, one that failed on its way among them, and after an input of another client of the same server; an input that would act on the system's power, emergency or erase controls asks the person: Android's power menu (Power off, Restart, Emergency), its button in quick settings and a lock screen's emergency call, a Samsung's and a Xiaomi's power menu, Settings' resets and its erase-all-data screen and confirmation; iOS's power-off screen, all of it but its Cancel, all of Control Center over any app, as its power button has no mark of its own, and Settings' Reset and Erase All Content and Settings. It knows them by the system app that shows them, by the ids of the power menu, the erase screen, iOS's power-off slider and Control Center in any language, and by their words in English and Turkish, however the touch is aimed, by ref, selector or x,y. A third press of the power or side key in 5 seconds asks too, as presses in a row call for help on many phones. A link that places a call, `tel:`, `telprompt:`, `facetime:` or `facetime-audio:`, a touch, key or typed text in a phone app (a dialer, its call screen or FaceTime, and on Android the device's own default dialer, whoever made it), and a touch on a button of an iOS system alert whose text is a phone number alone, in any language, or on one that says Call or Ara, but a Cancel, ask too. Where the guard cannot tell, as when a device cannot say which app is its dialer or an iPhone's home screen app cannot be read, the input is not sent. Reading such a screen asks nothing, nor do back and home, which leave it. The answer says that appdyno does not restart, power off, reset or erase a device, nor place a call, and that the person does it; for Control Center, that `device_setting` changes what it would.

The question is asked, and refused where nobody can be asked, in the same way as for what loses data, below. Only `--allow-power virtual` (simulators and emulators) or `all` lets it go ahead unasked. `--allow-data-loss` does not: a run that may clear an app's data on an emulator must not also be able to restart it. A window's own input is the person at it, and passes no guard.

`simulator` starts and stops a simulator or emulator, as its own tools do, and offers no reboot: a `shutdown` and a `boot` are two calls, and neither its description nor its answer puts them together as one. A `shutdown` asks no one: it loses nothing a device keeps on its disk, only the session on it and what its apps held in memory, as `terminate_app` does, which asks no one either. So its description says that before any call, and its answer says it once it shut down the selected device.

What loses data a person may want asks the person first: [the list](docs/reference/tools.md#what-asks-the-person-first). The client shows the question, the model cannot answer it, and if the answer is no, nothing is done. A client may answer no by itself, so the answer says the question got no yes, never that the person declined, and every refusal says how a person allows it ahead of time. Where the client cannot ask, and over `--http`, it is refused, unless the person started the server with `--allow-data-loss virtual` (simulators and emulators) or `all`. Nothing a tool call carries sets that or stands for a yes. A model that can change the client's settings or run a shell is past what the server can hold back: it can run `appdyno` with `--yes`, or `adb` itself, and the client's own permission for each command is what stands then.

## Wi-Fi

`appdyno pair` makes an identity this Mac shares with one phone, once, with a person accepting on it. On an iPhone its private key is in the state directory, under `wifi-pairing/`, readable by this user alone: **whoever has that file and is on the phone's network can reach the phone's developer services**, as a window does. It is not the pair record, which is read and never written. An iPhone's pairing is made on its cable, as on the network a phone allows none. At each start the phone proves itself with the key it gave at pairing, so something else on the network that answers as it is turned away. All of it is encrypted on the network. On Android the pairing is adb's own, and adb keeps it.

An iPhone's runner keeps to the phone's loopback unless the phone is paired so. A paired phone's runner takes a tunnel too, with the same token, and as no listener could be kept to a tunnel alone, its port stands open on the phone's network while it runs. A connection is read only when it came by the loopback, or by an interface of a tunnel's kind from the Mac's end of a tunnel to the phone's, which every tunnel seen made `::2` and `::1` of one private /64. Any other is closed with nothing read from it, the phone's Wi-Fi and a VPN's among them, but for a VPN on the phone set up with addresses of that same form, which would reach the runner's token.

## `--http`

`appdyno mcp --http 127.0.0.1:PORT` serves the same tools over MCP's Streamable HTTP. It binds only to this Mac's loopback and refuses any other address. Every request needs the token, compared in constant time, and one with an `Origin` other than the server's own is refused, so a web page cannot reach it. A generated token is printed once, at the start, and no token goes in the log.

A tunnel is what puts it on the internet, and you run that: appdyno runs none, and there is no service of ours. **Whoever has the address and the token can do all of the above on your devices, and read and write files on this Mac where a tool takes a path.** Whoever runs the tunnel and the client sees the traffic, and a token in an address shows in a tunnel's logs. Keep it short, keep to `--allow-devices`, `--allow-apps` and `--allow-urls`, and stop it when you are done. The server cannot tell two holders of a token apart: it knows a client by the name it gives, to keep two clients off one context, not to keep anyone out.

Use a test device and test accounts. Do not point the server at a device that holds real data.
