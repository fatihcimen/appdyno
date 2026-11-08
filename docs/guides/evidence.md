# Evidence

[Türkçe](evidence.tr.md)

What an agent can leave behind to show what happened, and how it looks inside an app.

## Video

`record` with `action` `start` (`file`, `maxSeconds`, default 1,800) and `stop`, one recording per device. It
outlives the process that started it, so `appdyno record start` and `appdyno record stop` work as two commands. A session's
end stops a recording it left running.

`stop` reads the file, and a file that does not play is a refusal saying why (a recorder killed before it ended leaves no
index). The answer gives the length, frames and size.

|           | how                                                      | what to know                                                                                                                                                                                                  |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android   | `screenrecord` on the device, 3 minutes a run, 4 Mbps    | runs are joined into one video by copying their frames, with no dependency; a moment is lost at each join. Runs an encoder change makes unjoinable stay as `name-1.mp4`, `name-2.mp4`, and the answer says so |
| simulator | `simctl io recordVideo --codec=h264`, a QuickTime `.mov` | a frame is written only when the screen changes, so a still screen gives a very short video, and the answer says so                                                                                           |
| iPhone    | its own stream into a movie, with no second encode       | HEVC 4:4:4 at the phone's own size, from a key picture on; a build without the stream uses `devicectl device capture screen-record`, which not every phone offers                                             |

## Report

`report` `start` (`dir`) keeps every call from then on: its arguments, its answer and, after anything that is not a plain read,
the screen and an image of it. `stop` writes `index.html` in that folder, with the video recorded meanwhile, the app's log, its
crashes and the measurements taken. So does the end of a session. `write` writes it at any moment, and with no `start` it is a report
of the screen as it is.

The page loads nothing: it has no script, and its content policy allows only its own folder. Listed secrets and what looks
like a credential are hidden in all text. Typed text, and any argument not known to name something, is shown by its length. An image is painted over where an
element holds a secret or is a password field, and left out if it cannot be painted over. Text drawn with no element behind it cannot be told, and a video is not painted over.

## Dashboard

```sh
appdyno perf survey --app A [--device S]               # every measure on that device in turn, then the page
appdyno perf dashboard [--app A] [--out dir] [--open]  # the page alone, from what is kept
```

One page of an app's performance on all your devices: what needs attention, what would count by Play's definitions (a session, never a rate), each measure by device (its newest value, marked if it is an estimate or was taken under noise, or why that device cannot read it), and a trend of each with its baseline's band and budget. It says that an emulator's or a simulator's numbers are relative to this Mac and that real frame rates, frozen frames, hitches and energy need a phone, what a number means where it differs (a simulator's frames are main-thread pacing, its energy this Mac's), and, with no phone measured for an app, the command for one. It is `<measurements dir>/dashboard/index.html`, rewritten after each kept run, and an open page reloads itself. There is no server: one file with no script, which loads nothing. `perf_compare` with `action: dashboard` writes it too. `perf_snapshot` `also: surface` reads a `SurfaceView` or a game's frames, which `gfxinfo` never sees, against Play's slow sessions. `perf_launch` with `baselineProfile: true` says of an Android release build whether its Baseline Profile is in the APK, whether it is applied, and what it is worth, in cold starts with it and without. See [docs/perf.md](../reference/perf.md#a-baseline-profile). An Android app's battery signals (wake locks by tag, wakeups, jobs, with no power model) come from `perf_snapshot` `also: battery`, and its memory as Play judges it (anon RSS and swap by process state, bitmaps) from `also: anonMemory`, and why it last started, from Android 15, from `also: startInfo`. See [docs/perf.md](../reference/perf.md#the-dashboard). `perf_trace` says why slow frames and hangs were slow, and `perf_compare` `action: functions` which functions moved between two profiles.

## Network

`network` `paths` says what each way sees on this device, and why not. `start` picks one, `read` and `stop` give a bounded list.

| way       | where                                                                                                                                                                                                 | sees                                                                                                              | bodies                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `proxy`   | Android: `settings put global http_proxy`, through `adb reverse` for one on this Mac, put back at `stop` or the session's end. Simulator: follows the Mac's proxy, and this tool does not change that | every HTTP request of an app that keeps the system proxy; for HTTPS only the host unless your proxy decrypts it   | only in the proxy's export, only where it decrypted |
| `probe`   | simulator: an `NSURLProtocol` injected into the app, which restarts                                                                                                                                   | URLSession requests: method, URL, status, time, size. Not background sessions, `WKWebView` or `Network.framework` | no                                                  |
| `bytes`   | Android: `dumpsys netstats`                                                                                                                                                                           | an app's bytes and packets; not the loopback                                                                      | no                                                  |
| `packets` | Android 14+: Perfetto's `android.network_packets`                                                                                                                                                     | an app's packets by remote port and direction, read at `stop`                                                     | no                                                  |

The proxy is one you run. `read` lists a running Proxyman by its own export, and any proxy from a file: `har`, from Charles (File,
Export Session) or mitmproxy (`--set hardump=file`). A list holds what went through the proxy from any client, since `start`. No
certificate is ever installed: to see HTTPS through a proxy, install its certificate yourself. An iPhone has only `read` with `har`: its proxy is in its Wi-Fi settings.

## Web views

`webview`: `pages`, `elements` (the DOM at tap coordinates, to read where the accessibility tree does not), `click` (a CSS
selector), `eval` (a script). On Android it speaks the DevTools protocol to the `webview_devtools_remote_<pid>` socket of a debuggable
app, through `adb forward`. On a simulator it speaks to the socket Safari's Web Inspector uses, and from iOS 16.4 a page shows only if the app set
`isInspectable`. An iPhone is not reached this way.

`screen` marks what a web view shows as `web`, and adds what the page holds and the accessibility tree does not, by coordinates and
selector. An app that is not debuggable still shows what its web view tells accessibility.

## Flutter

A Flutter app's semantics are in the accessibility tree, so `screen`, selectors and taps work on it. The richer tree of the Dart VM
service is not built: this tool's rule is to test what it ships, and the Mac this was written on has no Flutter SDK to build a test app with.
It would go as `webview` does: find the `Observatory` or `Dart VM service` line in the log of a debug build, forward its
port, and call `ext.flutter.inspector.getRootWidgetSummaryTree` over its WebSocket.

## React Native

`react_native` talks to Metro on this Mac and needs no device: `targets`, `logs` (the JS console over the Hermes
runtime's DevTools protocol, for `ms`, secrets hidden) and `reload` (Metro's route, else the runtime's). Tested against a stand-in for Metro only, not a real app. Left out: the
component tree and JS profiles. On Android, a device reaches Metro through your own `adb reverse tcp:8081 tcp:8081`.

## Visual comparison

`visual` `baseline` saves the screen as `name` under `dir` (default `./appdyno-baselines`, to commit with your project). `compare` refuses
with `CHECK_FAILED` past `tolerance` (percent of pixels, default 0.1; a pixel counts if a channel differs by more than 16), and writes
`name.diff.png` (what differs in red, masks in blue) and `name.actual.png`. `masks` are `x,y,w,h` in tap units or `text`, `id`, `role`; the status bar is always left out.
A baseline holds for one size of screen, and the refusal says so.
