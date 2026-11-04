# Security

## Reporting a vulnerability

Report it privately. Do not open a public issue. When this repository is public, use GitHub private
vulnerability reporting on it (the Security tab). Until then, send the report to the maintainer directly.
Say what you did, what happened, and the version or commit.

## Nothing leaves the machine

appdyno has no telemetry and sends nothing anywhere. It asks the npm registry for a release only while you run
`appdyno update`, and the MCP server never does. A client that runs `npx -y appdyno` has npx ask the registry at each
start, before appdyno runs: that is npm's doing, and a global install, as `docs/clients.md` says, keeps it from
changing the version.
By default the MCP server speaks over stdio to the
client that started it and opens no network listener. Only `--http` opens one: see below. Measurements are stored on the local disk, under the state
directory or the `--measurements` directory. The Android agent listens on an abstract unix socket on the
device, reached through adb, and accepts a connection only with its launch token. An iPhone is reached
over USB. A window's picture comes from the same agent, with the same token, given to the viewer by its
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
