# Security

## Reporting a vulnerability

Report it privately. Do not open a public issue. When this repository is public, use GitHub private
vulnerability reporting on it (the Security tab). Until then, send the report to the maintainer directly.
Say what you did, what happened, and the version or commit.

## Nothing leaves the machine

appdyno has no telemetry and sends nothing anywhere. The MCP server speaks over stdio to the client that
started it and opens no network listener. Measurements are stored on the local disk, under the state
directory or the `--measurements` directory. The Android agent listens on an abstract unix socket on the
device, reached through adb, and accepts a connection only with its launch token. An iPhone is reached
over USB.

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

Use a test device and test accounts. Do not point the server at a device that holds real data.
