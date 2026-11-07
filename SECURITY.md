# Security

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
- `--no-home` blocks the home key.
- `APPDYNO_SECRETS=a,b` values are never shown back and never put on the clipboard. Logs and crash
  summaries are redacted of them.
- The server stops another tool's UI automation on Android only with `--takeover`. Without it, it names
  the holder and does nothing.

A window shows what the screen shows, to whoever sits at this Mac. `--no-input` makes it watch only.

## What waits for a person

No tool reboots, erases or resets a device or a simulator, and none deletes a simulator or emulator:
`packages/appdyno/test/device-reset.test.ts` fails if any source gains a way to. `simulator create` says how a person
removes what it made, and runs none of it.

What loses data a person may want asks the person first: [the list](docs/reference/tools.md#what-asks-the-person-first).
The client shows the question, the model cannot answer it, and a no does nothing. Where the client cannot ask, and over
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
