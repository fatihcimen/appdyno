# Tools

[Türkçe](tools.tr.md)

The 28 tools an MCP client can call. Each is also [a command](cli.md), and a call in [the library](library.md). What each one was run on, and what the runs showed, is in [How the tools were tested](tools-tested.md).

## At a glance

| group                           | tool                  | use it to                                                                   |
| ------------------------------- | --------------------- | --------------------------------------------------------------------------- |
| [Devices](#devices)             | `list_devices`        | see what is connected, and which device is in use                           |
|                                 | `use_device`          | pick the device to drive, and the app under test                            |
|                                 | `set_device`          | read or change a condition: dark mode, location, network, fold              |
|                                 | `manage_simulator`    | list, boot, create or shut down a simulator or emulator                     |
| [The window](#the-window)       | `show_mirror`         | open a live window a person can watch and touch                             |
|                                 | `ask_person`          | hand over to a person, as at Face ID, and wait                              |
| [Reading](#reading)             | `read_screen`         | read the screen as elements, or as native views                             |
|                                 | `check_element`       | check an element, or wait until the check holds                             |
|                                 | `take_screenshot`     | take a picture, or see what moved                                           |
| [Acting](#acting)               | `tap_screen`          | tap, double tap or long press                                               |
|                                 | `swipe_screen`        | swipe, scroll to an element, drag or pinch                                  |
|                                 | `type_text`           | type into a field                                                           |
|                                 | `press_key`           | press a key or a button, or close the keyboard                              |
|                                 | `run_steps`           | run several tools in one call                                               |
|                                 | `answer_alert`        | read or answer a system alert                                               |
| [Apps](#apps)                   | `open_link`           | open a deep link or a Settings page, or list an app's links                 |
|                                 | `launch_app`          | launch the app, or start it fresh                                           |
|                                 | `manage_app`          | install, stop, clear, grant, or build and run                               |
|                                 | `transfer_files`      | move an app's data out or in, and photos into the gallery                   |
|                                 | `send_push`           | send the app a push notification                                            |
| [Checks](#checks)               | `check_screen`        | audit accessibility, or compare with a saved image                          |
|                                 | `read_logs`           | read the app's log, or its crashes                                          |
| [Evidence](#evidence)           | `record_session`      | keep a video, a report, a timeline or an app's last seconds                 |
|                                 | `capture_network`     | inspect, mock, throttle and check HTTP traffic                              |
| [Inside an app](#inside-an-app) | `inspect_app`         | reach a web view, a React Native app, or an iPhone's screen with no signing |
| [Measuring](#measuring)         | `measure_performance` | measure launch, scroll, frames, CPU, heap, or a snapshot of now             |
|                                 | `compare_performance` | gate runs against a baseline, or query a kept trace                         |
| [Replaying](#replaying)         | `run_flow`            | record a flow, replay it with no model, export it                           |

Where to look next:

- [Every tool](#every-tool) has each tool's inputs, group by group, with links to the details.
- [What an action answers](#what-an-action-answers) and [Targets](#targets) say how every touch behaves.
- [What asks the person first](#what-asks-the-person-first) lists what a model cannot do alone.
- [What each platform can do](#what-each-platform-can-do) is one table of Android, a simulator and an iPhone.
- [Upgrading from 1.2](../guides/upgrade-1.3.md) maps each old tool to its new one, with the commands and permissions that changed.

## How a call runs

- On this page a _window_ is a live window of a device, which `show_mirror`, the hub or the Mac app opens.
- The _runner_ is appdyno's helper app on an iPhone or a simulator, and the _agent_ is its helper on Android. The _fixture_ is appdyno's own test app, `dev.appdyno.fixture`.
- A _condition_ is a device setting that appdyno changed and puts back.
- The _allow list_ is what `--allow-devices`, `--allow-apps` and `--allow-urls` let this server touch.

Tools take no `device` parameter. The device is the one `use_device` selected, else the server's `--device`, else the only connected device this server may drive.

A client's calls that act run one at a time, in the order they arrive. If a client sends two at once, such as a `tap_screen` on each of two refs in one turn, the second runs after the first and aims at the screen the first left, so a ref that the first removed is refused as `STALE`. A call that waits for its turn says `waiting its turn` in its progress. Calls that only read, such as `read_screen` and `check_element`, do not wait, and a tool that `run_steps` calls runs inside that `run_steps` call.

The server speaks MCP's revisions from 2024-10-07 to 2025-11-25, which open with `initialize`, and 2026-07-28, which opens with `server/discover`, over stdio and over `--http` alike: the client's first message says which. The tools and what they say of themselves are the same, byte for byte, on each.

## Every tool

The inputs below are read from each tool's schema. A bold input is required. After a colon come the values an input takes, or its default, which is marked. On a tool that acts, `read` picks how much of the screen its answer holds: what changed (`diff`), all of it (`full`) or none of it (`none`). A target is a `ref`, `x` and `y`, or a `selector`, as [Targets](#targets) says.

### Devices

| tool               | what it does                                                                                                                                                                                                         | inputs                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_devices`     | Connected phones, simulators and emulators: which this server may drive, who holds each, and what blocks each; with `selected`, the device in use: its model, OS version, screen, agent version and the app in front | `selected`                                                                                                                                                                                                                                                                                                                                                                                              |
| `use_device`       | Selects the device to drive, and the app under test                                                                                                                                                                  | **`device`**; `app`; `share`                                                                                                                                                                                                                                                                                                                                                                            |
| `set_device`       | Reads or sets a condition, such as dark mode, the orientation, a fake GPS location, the clipboard, text size or a slow network; with no `value` it reads                                                             | **`name`**: `orientation`, `location`, `clipboard`, `dark_mode`, `text_size`, `reduce_motion`, `increase_contrast`, `reduce_transparency`, `animations`, `locale`, `network`, `proxy`, `battery`, `airplane`, `wifi`, `mobile_data`, `fold`, `thermal`, `restore`, `biometric`, `call`, `sms`, `keychain`, `memory_warning`, `shake`; `value`; `title`; `app`; `read`: `diff` (default), `full`, `none` |
| `manage_simulator` | Lists, boots, creates and shuts down simulators and emulators                                                                                                                                                        | **`action`**: `list`, `boot`, `create`, `shutdown`; `name`                                                                                                                                                                                                                                                                                                                                              |

More: [Sharing a device](#sharing-a-device), [Starting a simulator or emulator](#starting-a-simulator-or-emulator), [Reaching a phone](#reaching-a-phone), [Putting a device back](#putting-a-device-back), [Radios, biometrics and the keychain](#radios-biometrics-and-the-keychain), [A slow network](#a-slow-network), [A fold](#a-fold), [Languages](#languages), [An iPhone's own conditions, data and permissions](#an-iphones-own-conditions-data-and-permissions).

### The window

| tool          | what it does                                                                             | inputs                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `show_mirror` | A live window of the device, which a person can watch and touch                          | **`action`**: `open`, `close`, `status`, `stats`; `quality`: `auto` (default), `high`, `standard`; `wifi`: `false` (default) |
| `ask_person`  | Asks the person to do what a tool cannot, such as Face ID, and waits until they are done | **`reason`**; `timeoutS`: `300` (default)                                                                                    |

More: [The window and the hub](mirror.md).

### Reading

| tool              | what it does                                                                                                      | inputs                                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_screen`     | The screen's elements, each with a ref; with `selector`, the elements it matches, with their state and bounds     | `selector`; `raw`; `views`                                                                                                                                                                                             |
| `check_element`   | Checks an element, pass or fail, or with `timeoutMs` waits until the check holds: `CHECK_FAILED` when it does not | `ref`; `selector`; `check`: `exists` (default), `absent`, `text`, `enabled`, `checked`, `focused`, `moves`; `equals`; `expect`: `true` (default); `timeoutMs`: `0` (default); `read`: `diff` (default), `full`, `none` |
| `take_screenshot` | An image of the screen, or with `watchMs` what moved on it                                                        | `points`; `width`; `watchMs`; `strip`; `file`; `overwrite`; `inline`                                                                                                                                                   |

More: [Reading the screen](#reading-the-screen), [Targets](#targets), [Screenshots](#screenshots).

### Acting

| tool           | what it does                                                                                                           | inputs                                                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tap_screen`   | Taps a target; `count: 2` is a double tap, `holdMs` a long press                                                       | `ref`; `x`; `y`; `selector`; `count`; `holdMs`; `read`: `diff` (default), `full`, `none`                                                                                                                        |
| `swipe_screen` | Moves a finger: a swipe, a scroll until an element is on the screen, a drag, a pinch, or free paths of several fingers | `direction`: `up`, `down`, `left`, `right`; `ref`; `x`; `y`; `selector`; `until`; `maxSwipes`; `distance`; `exact`; `to`; `durationMs`; `holdMs`; `scale`; `pointers`; `read`: `diff` (default), `full`, `none` |
| `type_text`    | Types up to 500 characters into the focused field, or into a target                                                    | **`text`**; `ref`; `x`; `y`; `selector`; `replace`; `submit`; `read`: `diff` (default), `full`, `none`                                                                                                          |
| `press_key`    | Presses a key or a button; `hide_keyboard` closes the on-screen keyboard                                               | **`key`**; `count`; `read`: `diff` (default), `full`, `none`                                                                                                                                                    |
| `run_steps`    | Up to 30 tools in one call                                                                                             | **`steps`**; `read`: `diff` (default), `full`, `none`                                                                                                                                                           |
| `answer_alert` | Reads the open system alert, or answers it                                                                             | `answer`; `read`: `diff` (default), `full`, `none`                                                                                                                                                              |

More: [What an action answers](#what-an-action-answers), [Steps, gestures, apps and settings](#steps-gestures-apps-and-settings), [System alerts](#system-alerts).

### Apps

| tool             | what it does                                                                                                | inputs                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open_link`      | Opens a link or a Settings page, or lists the links an app opens                                            | `url`; `settings`; `links`; `read`: `diff` (default), `full`, `none`                                                                                                                                                                                                      |
| `launch_app`     | Launches the app, or brings it to the front; `restart` starts it fresh                                      | `app`; `restart`; `args`; `env`; `language`; `probe`; `read`: `diff` (default), `full`, `none`                                                                                                                                                                            |
| `manage_app`     | Installs, lists, stops and manages apps and their permissions, and builds and runs a project                | **`action`**: `list`, `state`, `install`, `uninstall`, `clear`, `grant`, `revoke`, `build_and_run`, `stop`; `app`; `path`; `files`; `service`; `scheme`; `configuration`; `args`; `env`; `all`: `false` (default); `read`: `diff` (default), `full`, `none`; `background` |
| `transfer_files` | Moves files between this Mac and the device: an app's data out or in, and photos or videos into the gallery | **`action`**: `pull`, `push`, `media`; **`path`**; `app`                                                                                                                                                                                                                  |
| `send_push`      | Sends the app a push notification; with no `type`, says what this device takes                              | `app`; `type`; `title`; `body`; `image`; `data`; `payload`; `read`: `diff` (default), `full`, `none`                                                                                                                                                                      |

More: [What asks the person first](#what-asks-the-person-first), [Push notifications](#push-notifications), [Links](#links), [Memory warnings, shakes, photos and an app ended in the background](#memory-warnings-shakes-photos-and-an-app-ended-in-the-background).

### Checks

| tool           | what it does                                                                                 | inputs                                                                                                                                                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check_screen` | Checks the whole screen: its accessibility issues, or the screen against a saved image       | **`check`**: `accessibility`, `visual`, `visual_baseline`; `name`; `dir`; `tolerance`: `0.1` (default); `masks`; `types`: `contrast`, `elementDetection`, `hitRegion`, `sufficientElementDescription`, `dynamicType`, `textClipped`, `trait`, `imageContrast`, `duplicateLabel`; `maxIssues`: `50` (default) |
| `read_logs`    | The app's log with secrets hidden, or with `source: crashes` its crash, ANR and exit reports | `source`: `app` (default), `crashes`; `app`; `since`; `level`: `verbose`, `debug`, `info` (default), `warn`, `error`; `contains`; `limit`; `symbols`                                                                                                                                                         |

More: [Logs and crashes](#logs-and-crashes), and for `check_screen` the guide [Evidence](../guides/evidence.md).

### Evidence

| tool              | what it does                                                                                                                            | inputs                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `record_session`  | Keeps evidence: a video of the screen, a test report in one HTML file, a timeline, or an app's last seconds, kept on a crash or a stall | **`kind`**: `video`, `report`, `timeline`, `flight`; **`action`**: `start`, `stop`, `write`; `file`; `overwrite`; `maxSeconds`: `1800` (default); `dir`                                                                                                                                                                                                                        |
| `capture_network` | The app's HTTP traffic                                                                                                                  | **`action`**: `paths`, `start`, `read`, `stop`, `mock`, `throttle`, `check`; `via`: `proxy`, `probe`, `packets`, `bytes`; `proxy`; `app`; `bodies`; `har`; `id`; `path`; `shape`; `diff`; `after`; `contains`; `method`; `status`; `limit`: `50` (default); `save`; `overwrite`; `rules`; `add`; `has`; `timeoutMs`; `from`; `unmatched`: `pass`, `fail`; `strict`; `throttle` |

More: [Network on a simulator](#network-on-a-simulator), and the guide [Evidence](../guides/evidence.md), for `record_session` and `inspect_app`: a `video` takes `start` and `stop` alone.

### Inside an app

| tool          | what it does                                                                                                                                                        | inputs                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect_app` | Inside an app: a debuggable app's web view, a debug React Native app through Metro, or an iPhone's screen with no signing, by the phone's own accessibility service | **`action`**: `web_pages`, `web_elements`, `web_click`, `web_eval`, `rn_targets`, `rn_logs`, `rn_reload`, `ax_list`, `ax_press`; `app`; `page`; `selector`; `js`; `metro`: `localhost:8081` (default); `target`; `ms`: `3000` (default); `name` |

### Measuring

| tool                  | what it does                                                                                                                                                                  | inputs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `measure_performance` | Measures by `metric`: launch time, a list's frames as it scrolls, why frames were slow and an iPhone's hangs, where CPU time goes, a heap dump, or CPU, memory and frames now | **`metric`**: `snapshot`, `launch`, `scroll`, `frames`, `cpu`, `heap`; `app`; `cpuWindowMs`: `2000` (default); `also`: `threads`, `network`, `energy`, `anonMemory`, `startInfo`, `surface`, `battery`, `exits`, `size`; `batteryWindowMs`: `30000` (default); `scenario`; `mode`: `cold` (default), `warm`, `hot`; `repeats`; `compile`: `speed`, `speed-profile`, `verify`; `trace`; `baselineProfile`; `probe`; `baseline`; `direction`: `up`, `down`; `swipes`: `5` (default); `x`; `y`; `selector`; `seconds`; `what`: `frames` (default), `hangs`, `xct_hitches`, `xct_launch`; `dsym`; `profile`: `java_hprof`, `heapprofd` |
| `compare_performance` | The performance gate: kept runs against the baseline and budgets; with `query`, a table from a kept trace, by SQL or by its name                                              | `action`: `compare` (default), `why`, `reference`, `budget`, `baseline`, `dashboard`, `functions`, `prune`, `query`; `limitGb`; `dryRun`; `from`; `to`; `app`; `scenario`; `deviceClass`; `last`: `1` (default); `replace`; `kind`; `max`; `min`; `format`: `text` (default), `json`, `junit`; `dsym`; `trace`; `sql`; `table`; `limit`: `50` (default)                                                                                                                                                                                                                                                                            |

More: [Performance](perf.md), and the guide [Measuring performance](../guides/performance.md).

### Replaying

| tool       | what it does                                                                                                                         | inputs                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_flow` | Records actions as a repeatable test, replays it with no model, runs a folder of them to one verdict, and exports it as Maestro YAML | **`action`**: `record`, `stop`, `save`, `run`, `test`, `export`; `file`; `to`; `from`; `params`; `envFile`; `overwrite`; `iterations`; `retries`; `tags`; `scenario` |

`run_flow` `test` runs a `.flow` file or a folder of them on the selected device, as `appdyno test` does, and writes [the run's report](../guides/flows.md#a-runs-report) in the folder `to` names, `appdyno-artifacts` unless given. It answers with the lines of `verdict.txt`, and its data holds `verdict`, the paths of `record` and `page`, and the files that `failed`. A run that fails is an answer and not a refused call. `tags` selects the files that hold one of them, and `retries` runs a failed file again. A run on several devices is a command line's: `appdyno test --device`.

`run_flow` `run` runs a flow's setup before its steps and its teardown after them, and a teardown that fails is refused with `CHECK_FAILED`, after saying that the steps passed. A `prepare` step runs a project's own command on this Mac, so it asks the person first each time, and a server started with `--allow-build` runs it with nothing asked. A recording writes a step for each action that has one, among them `drag` for a `swipe_screen` with `to`, `push` for a `send_push`, `setting orientation` and `clipboard` for a `set_device` `orientation` and `clipboard`, `web_click` for an `inspect_app` `web_click`, and `audit` for a `check_screen` `accessibility`. It writes `unrecorded` for a `swipe_screen` with `scale` or `pointers` and an `inspect_app` `web_eval`, where a replay stops. [Flows](../guides/flows.md) has the format, and what each recorded action becomes.

## Listing only some tools

A client reads the whole list of tools in every session. A server started with `--toolsets`, or with `APPDYNO_TOOLSETS` in its environment, lists only the groups it names, with a comma between them, as `appdyno mcp --toolsets core,network,perf`. Left out, it lists every tool. A word that names no group is refused, and the server does not start. The sizes are characters of the list a client is sent; the whole list is 26,838.

| group      | tools                                                                                                                                                                                           | size   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `core`     | `list_devices`, `use_device`, `read_screen`, `take_screenshot`, `check_element`, `tap_screen`, `swipe_screen`, `type_text`, `press_key`, `run_steps`, `answer_alert`, `launch_app`, `open_link` | 10,104 |
| `device`   | `manage_simulator`, `set_device`, `ask_person`, `show_mirror`                                                                                                                                   | 3,240  |
| `apps`     | `manage_app`, `transfer_files`, `send_push`, `inspect_app`                                                                                                                                      | 3,645  |
| `evidence` | `read_logs`, `check_screen`, `record_session`, `run_flow`                                                                                                                                       | 4,056  |
| `network`  | `capture_network`                                                                                                                                                                               | 2,247  |
| `perf`     | `measure_performance`, `compare_performance`                                                                                                                                                    | 3,601  |

A group is a shorter list, not a permission. What a server may do is said by its `--allow-` flags. [The command line](cli.md) and [the library](library.md) reach every tool, whatever is listed, and `run_steps` every tool but `run_steps` and `run_flow`. The server's instructions name tools of every group, so a client that lists `core` alone may read of a tool it does not have.

## What an action answers

An action answers with the settled screen. `settled` means the screen was still for the window. `changed` means the screen differs from before the action, in layout or text; it does not say the action caused it.

If nothing changed the answer says "no change seen in N ms; if a slow reaction is expected, use check_element with timeoutMs"; where the screen it lists had changed before the action, it says "no change seen in N ms after the action: the screen changed before it".

### The structured answer

Every answer's `structuredContent` holds its whole text as `text`, beside the summary, as a client may show either part alone; what was done (`done`) is the text's first words, and is left out of `structuredContent` where the text holds it. A failed call is an `isError` answer whose text starts with its `code` and ends with its `hint`, both in `structuredContent` too, and a failed action says whether its touch went out (`dispatched`).

An action reads a screen nobody has seen before it touches it, and on a locked phone it is refused with `DEVICE_LOCKED`. Cancelling a request reaches the device, and long operations report progress.

### When another app is in front

An answer warns that the app is not in front when it left by itself, naming the app in front and the one expected, not after a key, a Settings page, another app's launch or a stop that left it on purpose. An action that began with the app in front and brought another up, as a link it opened in Safari, says which app came to the front.

**A failed action says whether it touched anything.** Its answer ends "no touch was sent", "the touch was sent", or, for a device that stopped answering, "the touch may have been sent: read the screen before trying again", and a client has `dispatched`: `true`, `false` or `unknown`. A target that is not there and a refusal by the device come before any touch; a scroll that ran out of list swiped first. A read after an action can fail too, on a dark screen or a frozen app: the action had gone out, so that answer says it may have been sent, whatever else it says.

**A touch looks first.** Every action reads the screen unless a read was taken since the last action and under 20 s ago, as a phone locks itself about a minute after the last touch, and a blind swipe can open Spotlight from a lock screen. It costs a read only where there was none. A read that is refused leaves nothing to go on, so the next touch reads again. Within those 20 s a screen that locked while on is still touched; one that went dark is refused by the agent, and on Android is then woken and touched again, or refused `DEVICE_LOCKED` where a lock stays.

**A locked phone is refused with `DEVICE_LOCKED`**, reads and touches alike. On Android that is a keyguard that stays after a wake and a dismissal. An iPhone with no passcode gets past its lock screen with the home button: on a dark screen the first press only wakes it, with the lock screen still up, so it presses up to three times, and the app comes back. An iPhone with a passcode refuses the read, by `devicectl device info lockState`. What was run is in [How the tools were tested](tools-tested.md#a-locked-phone).

### Refusal codes

A refused call's `code` is one of these, and its `hint` says what to do next. `TIMEOUT`, `DEVICE_GONE` and `AGENT_UNAVAILABLE` are worth one more try, as the device may answer the next time; the others fail the same way until something changes. The library exports them as `ErrorCode`, and [Protocol](protocol.md#errors) has each one's number on the wire.

| code                     | what it means                                                                                                                               | what to do                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `TIMEOUT`                | the device did not answer in time, or the call waited 5 minutes for its turn on it                                                          | read the screen, as the touch may have gone, then try once more                                                     |
| `CANCELLED`              | the client cancelled the call                                                                                                               | read the screen: the touch may have gone                                                                            |
| `DEVICE_GONE`            | the device was disconnected, or stopped answering                                                                                           | try once more; `list_devices` says whether it is still there                                                        |
| `AGENT_UNAVAILABLE`      | appdyno's helper on the device, the agent or the runner, could not be reached                                                               | try once more                                                                                                       |
| `AGENT_CONFLICT`         | another UI automation tool holds an Android device, or another process uses its agent                                                       | the answer names it and how to stop it; a server started with `--takeover` stops it itself                          |
| `AGENT_VERSION_MISMATCH` | the helper on the device, or the one built here, is of another version than this appdyno                                                    | the hint says which: build it again, or update or close the process that uses it                                    |
| `UNSUPPORTED`            | this device or platform cannot do it                                                                                                        | the hint says what to use instead, where there is something                                                         |
| `PERMISSION_REQUIRED`    | it waits for a person: what loses data, the power controls, a build, a link that asks, or a prompt on the device that only a person answers | a person answers, or allows it ahead of time: [What asks the person first](#what-asks-the-person-first)             |
| `NOT_FOUND`              | nothing matches the target, or no app or file has that name                                                                                 | a touch's answer shows the screen as it is now; `manage_app` `list` names the apps                                  |
| `NO_FOCUS`               | there is text to type and no field has the focus                                                                                            | tap the field first, or give it as the target                                                                       |
| `APP_NOT_RUNNING`        | the app is not running, or died under the action                                                                                            | the answer says why it died, with its last log lines; `launch_app` starts it again                                  |
| `POLICY_DENIED`          | it is outside what the server allows: its devices, apps, links and folders, or `--no-home`                                                  | a path can be one inside the allowed folders; the rest only the person who starts the server changes, by its flags  |
| `INVALID_ARGUMENT`       | the arguments are wrong                                                                                                                     | the hint says which one, and what it takes                                                                          |
| `STALE`                  | the target was read on a screen that has since been replaced                                                                                | read the screen again, then act                                                                                     |
| `SCREEN_OFF`             | the screen is dark, so a touch would reach no window                                                                                        | on Android the host wakes the phone and touches again by itself; where it still comes, wake the phone and try again |
| `INTERNAL`               | appdyno failed in a way it did not expect                                                                                                   | read the screen; if it comes again, report it with its message                                                      |
| `AMBIGUOUS`              | more than one element matches the selector                                                                                                  | narrow the selector, or use a ref: [No match, or several](#no-match-or-several)                                     |
| `CHECK_FAILED`           | a check does not hold, or a wait for one ran out                                                                                            | the answer says what it found                                                                                       |
| `BUILD_FAILED`           | the project's own build failed                                                                                                              | the answer quotes what the build said                                                                               |
| `DEVICE_CLAIMED`         | another live process holds the device                                                                                                       | stop it, or share the device: [Sharing a device](#sharing-a-device)                                                 |
| `DEVICE_LOCKED`          | the phone is locked behind what appdyno cannot answer, as a passcode                                                                        | unlock it                                                                                                           |
| `OFFLINE`                | the package registry, or a pinned tool's release, cannot be reached                                                                         | try again when online                                                                                               |

## Targets

A target is a `ref`, `x` and `y`, or a `selector` `{ text, id, role, index }`, resolved on a fresh read just before the action.

### How text matches

Text matches as `read_screen` with `selector` does, without case or accents ("İstanbul", "istanbul"), on an element's whole words, past where the list cuts a long label short, and on the cut label a flow may have kept; an exact match beats a partial one. A touch or a `swipe_screen` with `until` that found the text only as a part of a paragraph says so, as nothing on the screen read it alone.

### Where the touch lands

A `swipe_screen` with `until` that finds its element cut by the edge its swipes bring things in from, to less than half of what its like neighbours show, swipes once more, as so little of it takes no touch. A touch on a control whose middle is a smaller control of other words, as a mini player's Pause, goes to a point of it clear of that one and says where, or says whose middle it is where none is clear; a switch row that holds its own switch, as SwiftUI's Toggle, is touched on that switch.

### No match, or several

Several matches refuse with `AMBIGUOUS` and list them with their refs, and an index past the last match says how many there are; no match waits a moment, then refuses with the nearest labels, or, where another app is in front and the app did not leave on purpose, says that the app is not; a `check_element` with `timeoutMs` that runs out says the same, and that calling again waits longer.

A touch refused as `NOT_FOUND` or `STALE` holds the screen as it is now, as an answer does: what differs from the screen shown last, or all of it with `read` `full` or another app in front, and none with `read` `none`. No read of the screen is needed before the next try.

### A target under the keyboard

When a target is under the on-screen keyboard, where a touch would type a letter, or a selector finds nothing because the keyboard shrank the window, the keyboard is closed and the target is looked for once more, before any wait for it; a replayed flow's step does the same before its own wait. A phone in landscape shows a full-screen keyboard over the whole app. On iOS the keyboard over a web form is closed by the Done of the bar over it, in any language. A keyboard the app keeps open all the same is not typed on: the touch is refused as `UNSUPPORTED`, saying the element is under it.

## Reading the screen

### The on-screen keyboard

The on-screen keyboard is one element, `@keyboard keyboard`, on iOS as on Android, and none of its keys, bars or predictions is listed: `type_text` types, `press_key` `enter` presses its return key, `press_key` `hide_keyboard` closes it, and a touch on it is refused. A field's tap that opened it says so in one line of the diff.

`type_text` with no target on iOS, where no field holds the focus and no keyboard is up, is refused with `NO_FOCUS` before a key is sent: iOS takes keys with nothing focused, and the first can focus a field the rest then land in. The iOS runner refuses `press_key` `delete` and `tab` so too, where XCTest's own typing ended it.

### What a read leaves out

On iOS what lies under the status bar, above a navigation bar at the top of the screen, and what of that bar's own screen has scrolled under the bar, are left out as what is past the screen's edge is, since a touch on either bar scrolls a list to its top; the bar's own buttons stay, and so does a sheet over that screen.

Four or more elements at one point, none holding another, are rows a list has not placed yet, piled where it begins: they are left out too.

### Refs

A ref names an element by what it is, so it holds across scrolls and redraws; a field with no id of its own is named by the words around it, so its ref holds while its placeholder comes and as it is typed in. A field with a name of its own is listed with what it holds after the name, as `textField "Search" ="shoes"`, and a password's is left out; what takes typing is a `textField` whatever the app calls it.

### What a whole screen folds

A whole screen in an answer folds what repeats.

- A plain text or image inside a row whose label already holds it gets no line of its own, as a web link's own text and a footnote's marks do not, nor does a control named as the row at the row's very place, an element the app gives twice at one place, or a plain element named by the words of a plain text inside it, as an alert by its title, which is said at the title; the first line counts what was folded.
- A toggle that holds its own switch, as SwiftUI's, is one line: the switch inside it, a control of its words inside it, and the cell around it named by its words and its state ("Bold Text 0") get none, nor does a cell around a toggle of its words.
- A row named by the words inside it says a name that comes right after the same once; a value with no letter or of one character, as a score of 3 to 3, stays as many times as it is there.
- Three or more like rows in a sequence share one header (`cell x=201 clickable: ref "label" y`).
- Rows that only their context tells apart share one too, each with its context after its place (`button x=339 clickable: ref "label" y — context`, then `@d62s "Add" 137 — Product 35`).
- A label that an element gives twice is shown once, and what tells two like elements apart, such as their place, is shown only when another line has the same name.

Only the text is folded: `read_screen` with `selector`, selectors, refs, diffs, flows and `record_session` still reach every element. `raw: true` gives every element of the tree in the structured answer as well, with its rect and the index of its parent, as [the library](library.md) has it, and a ref it gives is one `tap_screen` takes.

### Native views on Android

`read_screen` with `views` on Android reads the activity in front from the system's own dump of it, of any build, debuggable or not, with no probe: each view's class, its place in tap units, its resource id and its flags (`clickable`, `disabled`, `focused`, `selected`, `gone`, `invisible`), headed by the framework that draws most of the screen. It gives no words: `read_screen` reads them.

The answer ends with what the views leave out: under a scroll view or a view pager that holds more than it shows, places are its layout's, as its scroll moves what it draws and not its views; a dialog or a menu over the activity is a window of its own and is not there; and where views a minified build's shrinker named hold the screen, as R8 names Flutter's `V4.v` and Compose's `p3`, the framework is told by what the app's package ships: Flutter's or React Native's engine (`libflutter.so`, `libreactnative*.so`, `libhermes*.so`), or Compose where a renamed view takes the focus and draws as Compose's own does. The note says what the label goes by; where the package tells nothing, the label stays Android views and the note says that no name tells what draws there.

The screen is read first, as `read_screen` reads it: a lock that asks for nothing is opened, and a lock behind a PIN, pattern or password is refused with `DEVICE_LOCKED`.

On Android, while the assistant's sheet is in front a read finds no window: `read_screen` and `launch_app` answer `NOT_FOUND`, saying so, and `press_key` `home` closes the sheet. An app that ended behind another app's window in its task, as its permission prompt after `manage_app stop` with `background`, is not started by a launch, which only brings that window forward: `launch_app` answers `APP_NOT_RUNNING`, naming the app in front.

An app whose main thread does not answer the system within 5 s is refused with `TIMEOUT`. `launch_app` with `probe` on Android launches as asked, and says that no probe is needed.

### Native views on a simulator

`read_screen` with `views` on a simulator reads the app's views by the view probe, which `launch_app` with `probe` puts in the app and this tool's later launches of it keep until the session ends; a read only asks the probe, and never starts the app again.

It asks at once the app reads take, each app the probe is held in and the app in front, and gives the views of the one on the screen: each view's class, a Swift name demangled, its place in tap units, its accessibility identifier and label, its text (a label's, a field's, a button's title; never a secure field's, nor that of anything in one), how clear it is, and the view controller where it changes, headed by the framework that draws most of the screen, SwiftUI told from UIKit. SwiftUI draws its own text and shapes, so a SwiftUI screen has few views and fewer words: its hosting views, the UIKit views it is built on, as a field, a list or a navigation bar, and what the app gives as UIKit.

A read of an app without the probe is refused with `UNSUPPORTED`, saying what the app's bundle holds (Flutter, by `Flutter.framework`; React Native, by Hermes or `main.jsbundle`), with `launch_app restart:true probe:true` in its hint; an app whose main thread has not answered within 2 s is refused with `TIMEOUT`, and one behind another, which iOS suspends, with `APP_NOT_RUNNING`.

On an iPhone 17 simulator, iOS 26.5, a read took 2 to 26 ms on the fixture's screens and 2 to 17 ms on apps of up to 273 views.

An app that does not run, or that iOS suspends while its probe answers, as one asked a second after `home`, is refused with `APP_NOT_RUNNING`: this tool's next launch of it puts the probe in where its launches hold one, and `launch_app` with `probe` otherwise.

A probe held from the command line stays until `set_device restore`, or until a server that holds probes on that simulator ends, which lets them all go. `restore`, and a session's end, keep the network probe of a capture that still runs, and say so: `capture_network` `stop` lets it go.

The views are the app's own: when a system alert is in front of them, the answer says so in its last line and in `warnings`, with the alert's words and buttons. An iPhone gives no views: `views` and `launch_app` `probe` are refused there.

### Screenshots

A screenshot's answer says where its pixel is tapped: its x and y times its scale to tap units, said as a division where that is a whole one, `x/3` for an iPhone's picture at full size. The scale and `width` are of the screen as it stands now, turned or not, and a simulator's picture is stood up as its app in front stands; a picture that still stands otherwise than the screen gets no scale, and the answer says the screen's size in tap units.

With `file` it saves the picture at full size, or as wide as `width` asks, and shows the image as a screenshot does beside it, whose size and scale the answer gives, so that the file need not be read back; `inline: false` saves the file alone. Without `file` the image is at most 800 px on its long side, unless `width` or `points` asks otherwise, and a second image of a screen that has not changed is refused `INVALID_ARGUMENT`, as the last one still holds. `watchMs` gives no image but what moved in that many ms, and `strip` adds timed frames of it.

## Steps, gestures, apps and settings

### Steps in one call

`run_steps` runs up to 30 steps across screens. A ref or selector need exist only when its step runs. It stops at the first failure, says which step and why, and shows the screen as the call's `read` asks: what differs from the screen shown last, all of it, or, with `none`, nothing past the failing step's own line. A step that is no tool refuses the whole call before anything is done, and says so.

`check_element` with `timeoutMs` and selectors wait on the device, so the tree crosses the wire only when the screen changed.

### When the app dies under an action

If the app dies under an action, the action is refused with `APP_NOT_RUNNING`: the answer says what the action did, the crash report's reason and the app's last log lines, from the first line that says why. In `run_steps` this ends the call, naming the step. Where the look for the app's end could not read what it needed, as whether the app still runs or its crash reports, no death is known, and the answer says so in a line: `not checked for a crash: could not read whether it still runs: …`.

The app watched is the selected one, else the one in front as the touch was aimed, which a launch or a link earlier in the call may have opened. A later step that fails because an earlier crash left no app adds `APP_NOT_RUNNING` and what to do to its own error, and so does a flow's step.

An action still running after a second has its app's process watched, and is refused as soon as the process is gone, whatever the device answers after: a crash under a touch could hold the device's answer for its whole 15 s, which read as a stuck agent.

### Waits and selectors

`check_element` waits 15000 ms at most a call, as its description says, and a number past an argument's limit is refused with the limit in the hint. `check` `moves` watches the element, or the whole screen, for `timeoutMs`, 2000 ms unless given, and with `expect: false` passes only where it keeps still; `equals` is the text a `text` check wants, and `expect: false` asks the opposite of any check.

A selector goes in `selector` in every tool and step that takes one, `read_screen` and `check_element` among them, as `{"tool":"tap_screen","selector":{"text":"OK"}}`: its words given at the top are refused, with the call in that shape in the hint.

### What each tool holds

- `tap_screen` holds a double tap, as `count: 2`, and a long press, as `holdMs`; `swipe_screen` holds a drag, as `to`, a pinch, as `scale`, and free paths, as `pointers`, one way a call: two are refused. A swipe's `direction` is the way the content moves, `up` moving it up, and `until` swipes up to `maxSwipes` times, 10 unless given.
- `press_key` holds the buttons (`back`, `home`, `app_switch`, `volume_up`, `volume_down`, `mute`, `siri`, `power`, `lock`), a keyboard's keys (`enter`, `delete`, `tab`, `escape`, `space`, the arrows `arrow_up`, `arrow_down`, `arrow_left` and `arrow_right`, and a letter or digit with the keys held first, as `command+a`, where `command` is Ctrl on Android), and `control_center`, `notification_center` and `spotlight`, which `home` closes. A key's name is read whatever its case, and `return` is `enter`, `esc` `escape` and `backspace` `delete`; a letter is a small one, as a capital would be a shift too. `count` presses it again, up to 100 times, and `type_text` takes `replace`, for its text in place of the field's, and `submit`, for an `enter` after it.
- `manage_app` holds `list`, `state`, `install`, `uninstall`, `clear`, `grant`, `revoke`, `stop` and `build_and_run` from a project on this Mac: an Xcode project with `scheme` and `configuration`, or a Gradle folder with `scheme` as its module and `configuration` as its variant. `install` takes one file as `path`, or as `files` an Android app's APK with its `.dm` files or split APKs.
- `transfer_files` holds `pull`, an app's data into a new or empty folder, `push` from one, which stops the app and takes away what the folder does not hold, and `media`.
- `set_device` holds `orientation`, `location`, `clipboard`, `dark_mode`, `text_size`, `reduce_motion`, `increase_contrast`, `reduce_transparency`, `animations`, `locale`, `network`, `thermal`, `proxy`, `battery`, `airplane`, `wifi`, `mobile_data` and `fold`; the one-shot `biometric`, `call`, `sms`, `keychain`, `memory_warning` and `shake`; and `restore`, which puts back what was changed. `dark_mode` reads as it is set, `on` or `off`, on both platforms. `orientation` reads as the device stands, or only tall or wide where it does not say which way, as an iPhone; `location` reads the place this tool fixed, as a device does not tell its own. `call` takes a phone number, and `end` with the number hangs up; `sms` takes the text, from the number in `title`, 5551234 unless given.

### Launching an app

`launch_app` says whether it started the app or brought a running one to the front, on the screen it was on; with `restart`, `args`, `env` or `language` it stops a running one first, and says whether it started the app or restarted it. On iOS a launch that starts the app watches its screen 1 s more once it held still, and what comes in bulk then, a first-run sheet or a grid that loads, is settled and watched for 2 s more: the answer shows it. An app the device does not have is refused as `NOT_FOUND` on both platforms, with `manage_app list` in its hint. An app that ends as it starts is refused with `APP_NOT_RUNNING`, whatever `read` is and whichever app is selected, with the crash report's reason and its last log lines; the line that says why is given whole.

### A change is read back

Each change is read back: the answer says `changed` only when the device then reads otherwise than before, and `restore` says restored only of what then reads as it was. `text_size` on iOS is one of its sizes, from `extra-small` to `accessibility-extra-extra-extra-large`, and on Android a scale from 0.25 to 5 or `default`: another is refused, with what it takes. A location `set_device` `location` fixes is written down as a condition is, so `restore` and the session's end take it back to the real one.

## What asks the person first

These lose what a person may want, so each waits for the person's yes:

- `manage_app uninstall`: the app and all it keeps on the device
- `manage_app clear`: all the app keeps
- `transfer_files push`: all the app keeps now, which the folder's data replaces
- `manage_app revoke`: a permission the app was given
- `manage_app grant`: on an iPhone only, where `grant` resets the permission to ask, which loses the answer the person gave. A simulator's and Android's lose nothing and ask nothing
- `set_device keychain`: every item apps keep in the keychain

### The device's own controls

An input on the system's own power, emergency or erase controls asks too, as these act on the device itself. It may be a tap, gesture, swipe, long press, typing or key, from any tool, `run_steps` or a flow. The controls are:

- on Android: the power menu (Power off, Restart, Emergency) or its button in quick settings, a lock screen's emergency call, Settings' resets and its erase-all-data screen, and a restart or system update the system offers (Restart now, Update now)
- on iOS: the power-off screen but its Cancel, any part of Control Center, whose power button has no mark of its own, and Settings' Reset and Erase All Content and Settings
- on either: a third press of the power or side key in 5 seconds, which calls for help on many phones

They are known by the system app, the ids in any language and the words in English and Turkish, wherever the touch lands.

appdyno restarts, resets and erases no device, and powers off none but a simulator or emulator, by `manage_simulator` `shutdown`; for the rest the answer says the person does it. Reading such a screen asks nothing, nor back and home, which leave it.

Only `--allow-power virtual` or `all` lets these go ahead with nothing asked, never `--allow-data-loss`.

### Calls, languages and a press by words

A call asks too: `open_link` with a link that places one (`tel:`, `telprompt:`, `facetime:` or `facetime-audio:`), and a touch, key or text in a phone app (a dialer, its call screen or FaceTime, the contacts and messages apps, or an Android device's own default dialer) or on a button but Cancel of an iOS system alert whose text is a phone number alone, in any language, or on one that says Call or Ara. appdyno places no call, and `--allow-power` is the flag for these too.

Putting Settings, or the whole device, in a language other than English or Turkish, by `launch_app` `language` or `set_device` `locale`, asks too, as its resets and erase would then be known by no word. `--allow-power` lets it go ahead unasked.

`inspect_app` `ax_press` on an iPhone asks at each press: it presses an element by its words or id alone, with no place on the screen to tell whether it is one of these controls. Under `--allow-apps` or `--no-home` it is refused, and `--allow-power all` lets it go ahead with nothing asked.

### How the question is asked

The server asks by the client's own prompt, MCP elicitation, where the client declared it can, at `initialize` on a 2025 revision and on each request on 2026-07-28, and names the device, the app and what is lost. The model cannot answer it.

A no or a closed prompt does nothing, and the answer, `PERMISSION_REQUIRED`, says its question got no yes, never that a person declined: a client may answer by itself, as one run headless answered no in 9 ms, with no person shown the question. Each refusal's hint, a no's too, says how a person allows it ahead of time, by the flags below.

On 2026-07-28 no request goes back to a client, so the call ends its round with the question and the client brings the answer back with the call: the call waits where it stopped, so a step before it in the same `run_steps` is not done again, and an answer that does not come in 5 minutes is a no.

### Where nobody can be asked

A client that cannot ask is refused with `PERMISSION_REQUIRED` and how a person allows it, and so is every client over `--http`, a 2026-07-28 one too: whoever holds the token would answer the question it is asked, so nothing a caller answers there is a person's yes, and only the server's own flags let these go ahead.

### Allowing ahead of time

`--allow-data-loss virtual` on the server's command line lets these go ahead with nothing asked on simulators and emulators, and `all` on phones too. Only a person's registration of the server sets it: no argument, step or file of a tool stands for a yes. A command asks on its terminal and takes `--yes` for the answer; with neither, only the flag lets it go ahead.

### Installing and building

`manage_app install` is not among them: it removes no app first.

`manage_app build_and_run` asks too, each time and on any device, as a project's build runs its own Gradle or Xcode scripts on this Mac: the question names the project. Only `--allow-build` on the server's command line lets it build with nothing asked, never `--allow-data-loss`; without it, where the client cannot ask, it is refused, and a person builds the project and `manage_app install` takes what the build made. Its `path` is a project inside the folders the server writes in, with the flag too. A build that fails is refused `BUILD_FAILED`, with what the build said.

`manage_app install` names the app it installed by the id the file holds. Under `--allow-apps`, `manage_app install` installs only an app the list names, by the id the file holds, read before anything reaches the device, and refuses another, naming it; `build_and_run` is refused, as what a project builds is not known before it is built.

On Android an install the device refuses says why and what a person can do: an app signed with another key is `PERMISSION_REQUIRED`, as only `manage_app uninstall`, which loses all the app keeps and so asks a person, makes room for it; an older version is `INVALID_ARGUMENT`; no room, an Android older than the app's minSdk, or native libraries for another processor are `UNSUPPORTED`.

`manage_app install` with `files` installs one Android app's APK with its `.dm` files (dex metadata, which carry a Baseline Profile) or split APKs together, in one session, as `adb install-multiple` does, and answers the phone's prompts as for one file. Before anything reaches the device it refuses files of different apps, and a `.dm` with no APK of its name among them (`app.dm` goes with `app.apk`), which the device would drop. Where the device installs the app and warns, as of a `.dm` made for another range of API, the answer quotes the warning; Android 17 refuses such a `.dm`, and the refusal says so. An iOS app is one `.app` or `.ipa`: several files are refused `UNSUPPORTED`.

### Where a tool writes

A tool writes a file where its caller says only inside the folder the server runs in, unless that is the disk's root or the home folder, appdyno's state folder, or a folder given with `--allow-write`: `take_screenshot` `file`, `check_screen` `dir`, `record_session` `file` and `dir`, `transfer_files` `pull` `path`, `capture_network` `save`, `run_flow` `file` and `to`. A path elsewhere is refused `POLICY_DENIED`. This holds a tool call a client makes; a path typed on a command line is written where it says.

Listed secrets are hidden in text only: a screenshot, a `watchMs` strip and a video show the screen as it was, and their answers say so where secrets are listed.

### Links that ask

A link by a scheme the selected app does not take asks the person: `open_link` opens a web link, a link to Settings and a link the device says opens in the selected app, or whose scheme that app says it opens, with nothing asked. Any other asks, as `itms-services:`, `shortcuts:`, `sms:` or `mailto:` with no app selected, and `--allow-urls` is how a person allows links ahead.

## What each platform can do

What a platform cannot do is refused with the reason (`UNSUPPORTED`):

| feature                              | Android                                            | simulator                                                                                            | iPhone                                 |
| ------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------- |
| volume buttons                       | yes                                                | yes (no way to read back)                                                                            | the runner                             |
| clear an app's data                  | `pm clear`                                         | empties its container                                                                                | development-signed apps                |
| reads with no signing                | no need                                            | no need                                                                                              | `inspect_app` `ax_list`: words and ids |
| native views (`read_screen` `views`) | the system's dump, no probe                        | the view probe: `launch_app` `probe`                                                                 | no                                     |
| download, replace app data           | debuggable builds                                  | yes                                                                                                  | development-signed apps                |
| grant, revoke a permission           | `pm grant`, `pm revoke`                            | `simctl privacy`                                                                                     | reset to ask, then `answer_alert`      |
| launch environment                   | no: args are intent extras                         | yes                                                                                                  | yes                                    |
| dark mode, text, motion, contrast    | yes                                                | yes                                                                                                  | `devicectl`                            |
| reduce transparency                  | no: its blurs are a developer option               | yes                                                                                                  | `devicectl`                            |
| animations                           | yes                                                | no: use `reduce_motion`                                                                              | no                                     |
| locale                               | per app, API 33+; whole device below               | per app; `app ""`: the whole simulator                                                               | per app, the tool's launches           |
| slow network, thermal state          | emulator; a phone's downloads, 13+                 | no                                                                                                   | Xcode's conditions                     |
| biometrics                           | an emulator's fingerprint                          | yes                                                                                                  | no: `devicectl` simulates none         |
| airplane, Wi-Fi, mobile data         | yes, read back                                     | no: it has the Mac's network                                                                         | no                                     |
| keychain                             | no: Android has none                               | emptied, counted                                                                                     | no                                     |
| fold pose                            | a foldable, API 31+: every pose it lists, put back | a simulator with two displays (iPhone Duo, Xcode 27.1+): closed, half, open, put back; any other: no | no                                     |
| incoming call, SMS                   | emulator only                                      | no: no telephony                                                                                     | no                                     |
| battery level                        | yes                                                | no: it only draws one                                                                                | no                                     |
| proxy                                | yes, put back                                      | follows the Mac's                                                                                    | no: its Wi-Fi settings                 |
| memory warning                       | a trim level above the app's                       | every app on it, one a call                                                                          | `devicectl` (not yet run on a phone)   |
| shake                                | an emulator's accelerometer                        | yes                                                                                                  | no: only by hand                       |
| photos and videos into the library   | pushed, scanned, taken out at `restore`            | `simctl addmedia`, no delete                                                                         | no                                     |
| app ended in the background          | `am kill`                                          | SIGKILL of its process                                                                               | `devicectl` (not yet run on a phone)   |

An Android app that targets API 37 reaches this Mac, at `10.0.2.2` from an emulator, or the local network only with the `ACCESS_LOCAL_NETWORK` permission: without it, its requests hang, and `measure_performance snapshot` and `capture_network` count 0 bytes.

## Push notifications

`send_push` sends one to the app, by `type`, from fields (`title`, `body`, `image`, `data`) or from `payload`, the platform's own JSON: APNs' on iOS, an FCM message on Android. Given both, it refuses. A push is always the app's own: nothing shows a notification under any name but the app's, and where the app cannot be given one, `send_push` refuses, saying what it needs.

With no type and nothing else it answers each type this device takes, the route it takes and the fields it takes there, with a template of the payload it would send, or why it cannot; its `data` holds the same as `types`, where a route by APNs or FCM names in `tokens` the kinds of token it goes by, which a person may type in a window. A `title` or `body` with no type goes as an `alert` where the device takes one, and the answer says so; where it takes none, and for `image`, `data` or `payload` alone with no type, it refuses, naming the types that go. A push is answered with the screen after it, as an action is.

| type          | Android emulator and phone                                          | simulator                                                                                    | iPhone                                              |
| ------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| alert         | FCM's own message, below, or FCM once set up                        | `simctl push`: the app's code gets it if the app is in front, else only on a tap             | APNs, once set up                                   |
| rich          | as an alert, with an image by a link                                | APNs' sandbox, once set up; `simctl push` runs no Notification Service Extension             | APNs, once set up                                   |
| background    | FCM's own data message, below, or FCM once set up, as data alone    | APNs' sandbox, once set up; `simctl` refuses a push with nothing to see                      | APNs, once set up                                   |
| live_activity | as a background push, for the app to make its own Live Update       | APNs' sandbox, once set up; `simctl push` makes a notification, which no Live Activity takes | APNs, once set up                                   |
| voip          | no: an iOS push                                                     | APNs' sandbox, once set up, for an app that declares VoIP; `simctl` takes none               | APNs, once set up, for an app known to declare VoIP |
| widgets       | no: an iOS push                                                     | APNs' sandbox, once set up, from iOS 26; `simctl` takes none                                 | APNs, once set up, from iOS 26                      |
| tapped        | the launcher activity, or `click_action`'s, with the data as extras | no: `simctl` taps nothing                                                                    | no: only a person's tap                             |

`tapped` draws nothing. It is what [Firebase documents](https://firebase.google.com/docs/cloud-messaging/android/receive) for a push tapped while the app is in the background, "the data payload is delivered in the extras of the intent of your launcher Activity": the activity opens anew on top of the app's task, as Firebase's own tap opens it.

A real iPhone takes a push only from Apple's servers, once a person has set APNs up as in [Push to a phone and a simulator, by Apple and Google](#push-to-a-phone-and-a-simulator-by-apple-and-google). Until then, `open_link` with the app's deep link reaches the code a push with that link would, or a simulator takes the push. Xcode 27.1's `devicectl` has no push of its own: `devicectl device notification post` posts a Darwin notification, by its name alone, as its help says, which is no push. Without a key, Apple's Push Notifications Console sends a push from a browser signed in to the team's account, to the token the app printed, as [Apple shows it](https://developer.apple.com/videos/play/wwdc2023/10025/): appdyno cannot drive it, and it has not been tried.

A type this device or the app's build cannot take is refused with why, and the hint names the types that still work there, such as `tapped`.

### What reaches the app's code on a simulator

On a simulator the answer says what reached the app's code, by where the app was at the push, read just before it: in front, its code gets it; in the background or not running, the push is only shown, and the code gets it when its banner is tapped. An app no one allowed notifications shows none, and `simctl` fails ("Source is not authorized"), yet an app in front still gets the push in its code: the answer says so then, and where the app is not in front `send_push` refuses, saying how to allow them.

A simulator runs no Notification Service Extension for `simctl push`, so a rich push reaches the app's code unchanged, and `simctl push` takes no topic but an app's, so a Live Activity's push never reaches the activity. Apple tests these pushes on a simulator through APNs' sandbox, from a Mac with Apple silicon or a T2 on macOS 13 or later, with the activity's own push token. So a rich push, a background push, a Live Activity's, a VoIP push and a widget's reach a simulator only from APNs' sandbox, with a key of the app's team: once a person has set one up, as below, `send_push` sends them there, and until then each refusal says so.

### FCM's own message on Android, with no project or key

An Android app with Firebase Messaging takes an alert, a rich push, a background push and a Live Activity's as FCM's own message, with no Firebase project and no key. `send_push` sends the broadcast Google Play services hands an app, `com.google.android.c2dm.intent.RECEIVE`, to the receiver the Firebase Messaging SDK declares, `com.google.firebase.iid.FirebaseInstanceIdReceiver`, with the extras the SDK reads, as its [source](https://github.com/firebase/firebase-android-sdk/tree/main/firebase-messaging) has them: the data as given, a notification under `gcm.n.`, a `google.message_id` new for each push, the priority, high unless FCM's own payload says `NORMAL`, and its collapse key.

The receiver lets in only the system, root and the app itself, so `send_push` sends it by `run-as` on a debuggable build, as the app's own uid, or as root where adbd already runs as root; it never restarts adbd to make it so. A broadcast from the shell's own uid is skipped without a word. The receiver's result says it took the message: one that took nothing is refused, as a force-stopped app takes none, from FCM either.

The SDK then does as it does for a message from Google: a data message goes to `onMessageReceived` wherever the app is, and starts the app when it is not running; a notification goes to `onMessageReceived` with its data when the app is in front, and else the SDK draws it under the app's name and icon, in its own channel, where a tap opens the app with the data, as [Firebase documents](https://firebase.google.com/docs/cloud-messaging/android/receive); a tap on one has not been tried, and `tapped` opens the app the same way.

The answer says when the app is not allowed notifications, as the SDK then draws nothing. With no type, `send_push` and a window's Push pane name the route each type takes for the app named, read from its build; the listing goes through the allow list as a push does. With FCM set up, these pushes go by Google's servers instead.

What this leaves untried: Google's servers carry nothing, so their delivery, Doze's deferral, a TTL or a collapse across sends and a token's validity are not tried, and `from` reads `appdyno`, so an app that checks it against its sender ID turns the message down. An image goes by a link, which the SDK fetches.

A data key that is FCM's own name, `from`, `notification`, `message_type`, `collapse_key` or one that starts with `google` or `gcm`, is refused, as FCM refuses it. Where the app has no Firebase Messaging, the only way a push reaches an Android app's code, each of these is refused and the answer says so; where it is a release build on a phone whose adbd is not root, each is refused with what takes it: a debuggable build, or FCM set up with `appdyno push setup fcm`.

A style such as Android's inbox, messaging or media is no push of its own: an app draws it from what its code was handed, so `background`, with the data that code reads, is the push for it.

### Push to a phone and a simulator, by Apple and Google

What only Apple's or Google's servers deliver goes by them once a person has set up their credentials, at a terminal of this Mac: `appdyno push setup apns` asks for the team's APNs key, the `.p8` file, its key ID, the team ID, and whether a distribution build may take pushes from production; `appdyno push setup fcm` asks for a Firebase service account's JSON file. Each is kept in the state folder, `push/apns.json` or `push/fcm.json`, readable by this user alone (mode 0600, in a folder of mode 0700), and `--forget` deletes it. Nothing an MCP client sends sets, reads or deletes them: it is told only whether one is set. Neither command runs without a terminal, and neither says back a key, an id or a token.

With APNs set up, `send_push` sends a simulator's rich, background, Live Activity, VoIP and widget pushes, and each of these and an alert to an iPhone on its cable, by APNs, behind these:

- **Hosts.** `api.sandbox.push.apple.com` and `api.push.apple.com`, written in the code, and no other; a simulator takes only the sandbox's. A request goes by node's `http2`, with an ES256 provider token signed by node's `crypto`, kept 40 minutes, as Apple refuses one made more often than every 20 and one older than 60.
- **Token.** Only one this tool read from the app's own lines in this session, in the device's own log, or one a person typed in the window; nothing an MCP client sends is one. On a simulator the lines are `log show`'s, from the start of the session, of the app's process alone.
- **On an iPhone.** This tool reads no running app's log there, so a push that has no token relaunches the app with `devicectl device process launch --console`, its `os_log` and `NSLog` in that console as under Xcode, and reads what it prints for up to 15 s: only then, and the answer says the app was relaunched and lost its state. The console stays followed for the session, for a token printed later, and is let go by SIGKILL, which devicectl cannot hand on to the app as it does a signal it catches. Reading the phone's own log by its developer services would spare the relaunch, and is a later improvement.
- **What a token looks like.** A token is hex, 32 bytes or more, in a line that names a token where any line does, as an app's log has other hex as long, and the words of its line say which it is: a line naming a push to start, an activity, VoIP (or PushKit) or a widget gives that token, any other the device token. The app prints it with `NSLog` or `os_log`; a push with none says so, and how. A token Apple calls bad or no longer registered is dropped, and the next push reads the app's lines again. No answer, error or log says a token, a key or a provider token: a token is named by its kind and the time it was read.
- **App.** The topic is the app named, installed on that device, and the token is from that app. On an iPhone, the build's signature and Info.plist are read only from a build this tool installed, by `manage_app install` or `manage_app build_and_run`: nothing on the phone gives them.
- **Environment.** The sandbox, but for an app on an iPhone known to be a distribution build, by the signature of a build this tool installed, with production turned on at setup: then production. An app whose signing cannot be read here goes to the sandbox, never production, and a push refused on one host never goes to the other: on `BadDeviceToken` the answer says the token may be for the other environment, and what a person can do. A sandbox push reaches no production build, so nothing is lost by it.
- **Payload.** 4 KB at most, 5 for VoIP, with `aps` an object. Each type has APNs' push type, topic suffix and priority: `alert` and `rich` as `alert`, priority 10; `background` at 5; `live_activity` as `liveactivity` on `.push-type.liveactivity`; `voip` on `.voip`, only for an app known to declare VoIP; `widgets` on `.push-type.widgets`, from iOS 26. `apns-expiration` is 0: a push is delivered now or never. A Live Activity's payload is ActivityKit's: `event` start, update or end, `content-state` as the app's `ContentState`, and to start one `attributes-type`, `attributes` and an alert, with `timestamp` filled in when it is not given; start goes by the push-to-start token, update and end by the activity's.
- **Rate.** At most 10 a minute to a device, one push a call.
- **Answers.** Apple's reason, with words for a person: `BadDeviceToken`, `TopicDisallowed`, `ExpiredProviderToken` and each other Apple lists.

With FCM set up, `send_push` sends an Android device's alert, rich, background and Live Activity pushes by FCM: an alert and a rich push as a notification, with `image`, a background push and a Live Activity's as data alone, for the app's own code (a Live Update is the app's own notification, built from a data message), at high priority with a TTL of 0, so delivered now or never, unless the payload, FCM's own `message`, says otherwise. `tapped` stays as above. Behind the same kind of controls:

- **Host.** `fcm.googleapis.com`, written in the code, and no other: the service account signs its own RS256 token for FCM's audience, as Google's "service account authorization without OAuth" describes, so no token is fetched from another host. Whether FCM's HTTP v1 API takes such a token is unverified until a live send; if it does not, the token comes from Google's token endpoint instead, a second host written in the code.
- **Token.** A registration token the app printed in its own logcat in this session, of its process running now (by `getToken` or `onNewToken`), or one a person typed in the window; never one an MCP client sends. One FCM calls no longer valid is dropped, and the next push reads the app's log again.
- **App.** Installed on that device, and the payload names no token, topic or condition of its own: a message reaches the app on this device alone.
- **Payload.** 4 KB at most, its data strings alone; 10 a minute to a device; FCM's error codes in words, none naming a key or a token.

Requests to Apple and Google are tested against recorded ones, as each documents them, and the sending to Apple against a local HTTP/2 server; no test reaches either. No push has gone through Apple's or Google's servers in testing yet: that waits for a team's key, a project's account and a phone. What was run, and on which devices, is in [How the tools were tested](tools-tested.md#push-notifications).

## Links

`open_link` `links` with an app's id lists the links it opens, read from the installed app: on a simulator its URL schemes and the domains its signature names for universal links, on Android each filter that views a link, as `scheme://host/path`, and each App Link domain with Android's verification state. Its `data.links` holds the same, each with its `url`, its `kind` (`scheme`, `domain` or `filter`) and a domain's `state` where Android verifies it, for a client to offer or go through. An iPhone's installed app is not read.

On Android a link goes to the selected app, held there; with no `--allow-apps`, a web link that app does not open goes to whatever does, a browser most often, and the answer says the app does not open it. A web link that no app holds is answered once a web page, or another app, is on the screen and the screen is no longer the one the link was sent from, as the browser comes in front a moment after the device took the link; where neither came in 3 s, the answer says so.

### When a link has opened

`open_link` says `opened` only when no system alert stands over the screen the link left, which it reads once it has held still, up to 5 s, as an app a link starts goes on drawing after it is in front; an action waits 3 s.

A simulator asks "Open in …?" before an app's scheme first opens it, and nothing opens until that is answered. A link in a scheme of the selected app's own is followed until that app is in front, up to 15 s, and its prompt is answered on the way when it is that prompt, one line that names that app, so that one call answers with the app's screen, and says it answered it. One that comes over the app already in front is watched for a second. The touch that answers a prompt goes by the runner where the simulator's helper sends none, and the runner reads the prompt itself before it touches Open, so that it answers in landscape as in portrait.

Any other prompt is left, and the answer then says `sent`, with the alert's words and buttons, and to answer it with `answer_alert`. With `read: none` nothing is read, and it says `opened`.

### System alerts

Every answer that reads the screen names a system alert over it so, an Android app's crash dialog ("keeps stopping") among them, with `answer_alert` to answer it; on an iOS device in landscape the alert is read where the screen shows it, though the home screen app that draws it keeps its windows upright. `answer_alert`'s answer to an iOS alert over an app, and a `tap_screen`, with `count: 2` or `holdMs` too, that closes one, read that app once it is in front again: as the alert goes, the home screen app is in front a moment, showing only the app's card. `answer` is a button's label, or `allow` or `deny` in any language, where `allow` takes the least the alert offers, once, else while using; with no alert open it is refused `NOT_FOUND`, and a label that several buttons match `AMBIGUOUS`.

### Settings pages

`open_link` `settings` opens Settings, an app of its own, where a person can go anywhere: under `--allow-apps` it opens it, at a page or at an app's, only when Settings' own id is in the list, `com.apple.Preferences` on iOS and `com.android.settings` on Android, and else refuses with `POLICY_DENIED`, saying how a person adds it. A link `url` that opens Settings is held to the same: iOS's `App-prefs:`, `prefs:`, `app-settings:` and `settings-navigation:`, and Android's `package:` and `android.settings.…:`. A page this device lacks is refused as a wrong word, with this device's pages.

## Network on a simulator

`capture_network` on a simulator works through the probe. `paths` says what each way sees on this device, or why it is refused: `proxy`, through a proxy you run at `proxy` host:port; `probe`, on a simulator; and on Android `bytes`, and `packets` from Android 14, both with no bodies.

### Starting a capture

`start` with `bodies` keeps each request's headers and text bodies, to 64 kB each and 20 MB a capture, in the capture's own folder under the state folder, for this user alone; they are deleted at `stop` and at the session's end.

### Reading requests

A `read` of all requests is folded: failed and refused requests first, each whole; each host once, with each method and path once under it, a query by its names, repeats in one line with their count, statuses and median time; pictures counted. `contains`, `method` or `status` (`404`, `4xx`, `failed`) gives each request its own line. Every answer says the last id, and `after` gives only what started after an id. A request that has started and not ended stands after the list as `in flight`.

`read` with `id` gives one request whole: the protocol, address and phases the session measured (the probe's own connection, not the app's), then headers and bodies, with Authorization, Cookie, Set-Cookie and credential-named headers and fields hidden.

`save` writes what was asked for as HAR 1.2, cleaned the same way; a name with no folder goes to `appdyno-network/`.

### Mock rules

`mock` sets rules: `host/path` with `*`, or `regex=` for the path, `method=`, `query=`; then `status=`, `type=`, `header=`, `body=` (`body=@file` inside the server's folder), or `fail=offline|timeout|reset`, or `to=` a host on this Mac or its own network (any other needs `--allow-urls`; a bare `localhost` is `http://127.0.0.1`), with `delayMs=`, `times=` and `off`. Rules given replace the list, `add` adds to it, `[]` clears, none lists them with what each took.

### Throttle

`throttle` takes `full`, `slow`, `gsm`, `gprs`, `edge`, `umts`, `3g`, `hsdpa`, `lte`, `offline`, bytes a second down, or `delayMs= down= up= loss=`.

### What mock and throttle reach

Both start a probe capture if none runs, which restarts the app, and both end with `stop`. They reach only the app's URLSession requests: not background sessions, WKWebView or Network.framework, and the system still reads the Mac's network as it is. While the probe is in, the app's own check of a server's certificate (pinning) and its answers to a login or client-certificate challenge are not asked. A simulator's `set_device network` is refused and names `capture_network throttle`.

### Failed requests in an action's answer

While a capture by the probe runs, an action's answer names the requests that failed since it began, a line each and three at most: `network: POST api.example.com/v1/pay 500 (id 44)`. A request counts when the server refused it (4xx, 5xx) or it failed on its way; one the app gave up does not. One that ended after the last answer is told with the next action and says `before this action`. `strict` (with `start`, `mock` or `throttle`) makes an action fail, `CHECK_FAILED`, for a 5xx or a failure on the way that no rule made.

### Waiting for a request

`check` waits, up to `timeoutMs` (5 s), for a finished request that fits `contains`, `method`, `status` and `has`, and answers with its line. `has` is a value by its path in a JSON body (`user.name=Grace`) or any text of it, in the request's body, or the answer's with `response:` before it; it needs `bodies`. A miss is `CHECK_FAILED` with the nearest request and what differed. `after` keeps a request from before the action out. `read`, `paths` and `check` hold no turn on the device.

### Rules by body and header, and from a capture

A rule also takes a request by `has=` (the request's body, as above) and `when="Name: value"` (a header, `*` in the value), so one GraphQL address answers each operation apart.

`mock` with `from` makes a rule of a captured request by its id, its body in a file under `appdyno-network/` with credentials hidden, or a rule for each answer of a `.har`; what `from` makes is added to the rules.

`unmatched: fail` fails every request no rule takes.

### One value, a shape, a diff

`read` with `id` and `path` gives one value of the answer's body (`request:` before it for the request's), `shape` the keys and types with no values, and `diff` what differs from another request in address, status, query and bodies. `read` ends with what the app made that the probe cannot see: `not seen here: 1 web view, 1 background session, 1 WebSocket task`.

### Limits

Limits: a WebSocket task is left to the system, so it opens as it does without the probe and none of it is listed; a request body sent as a stream is read for `has=` and `bodies` only up to 64 kB and only where it states its length.

From sources and not tried here: Server-Sent Events show in flight until they end; gRPC over its own transport and media loaded by AVPlayer are not seen; React Native's `fetch` is URLSession and is seen, its WebSocket is not; Flutter's `dart:io` is not seen, and an app on `cupertino_http` is.

Under the probe, requests go through one session of the default configuration, so connection limits, HTTP/3 choice and cache may differ from the app's own.

## Logs and crashes

### Which log is read

`read_logs` reads logcat for the app on Android and the simulator log on a simulator. For an iPhone, `devicectl` cannot read the log of a running app, and the answer says so. On a simulator, below `debug`, it reads the app's own lines, `NSLog`'s among them, and of Apple's frameworks only their errors, but for the thousand lines a simulator's keyboard logs as it draws; `debug` reads all of the app's process. What XCTest logs there is never read: appdyno's runner reads the screen and touches from inside the app.

### How lines are shown

A message of several lines is one line of the answer, and `limit` never starts in the middle of one. What every line repeats is said once, in a line under the first (`every line: 11-15, pid 6178, left out below`): the day, and the process where one wrote them all, so a line begins at its time. A log that runs past midnight keeps its days, and one of two processes keeps them.

### Filtering: `contains` and `since`

`contains` keeps the lines that hold its words, whatever their case, matched after secrets are hidden. `since`, here and with `source: crashes`, is an ISO 8601 time or how long ago, as `30s`, `5m` or `2h`. With no `since` it reads from when the last action began, as what a push or a tap sets off is logged while it runs.

On Android it reads the app's process and the last one that died, by the pid exit info gives. The system may end a crashed process at once and start the app anew, or hold it, with its pid, behind its "keeps stopping" dialog until that is answered, as an emulator and a Xiaomi REDMI 15C both did: appdyno reads a process held so as a crash. Either way the crash's own lines are read after it.

### Crashes

`read_logs` with `source: crashes` collects the system's crash records for the app (Android exit info and dropbox, the simulator's DiagnosticReports, an iPhone's system crash logs) as a bounded summary and a file path.

Every simulator's reports are in one folder, so a simulator's are only those that name it, by the app's path or by the coalition its process ran in, which a system app's has too; the note says how many were left out and why. An iOS report is dated by the time it gives itself, as macOS moves an old report's file time on at each new crash once it keeps 25 of the app's, and an uncaught exception's is given by where it was thrown, not by the abort that ended the app. Secrets are redacted.

An iPhone's crash folder holds every process's reports, each named after its process, so only the app's are copied to this Mac: by the name of its bundle's folder, `Shop.app` for `Shop-…`. One of another app's process with that name, as every Flutter app's is `Runner`, is deleted as soon as it is read. An extension's reports are named after its own process, which the phone does not say, so they are not given on an iPhone. An app the phone does not have gets none, and the note says why. The first read after an update deletes what an earlier version copied of other processes.

On Android only the app's dropbox entries are kept, in its crash file and in a `measure_performance` `exits` reading, though the dropbox lists every app's. It also counts every exit the system keeps, by its reason in full, because an app that left by itself or was killed did not crash: `SIGNALED status 9`, `USER REQUESTED KILL BACKGROUND`, `EXIT_SELF status 3`.

### Symbols for a release build

With `symbols`, it names the stack of a release build.

On iOS that is a `.dSYM`, or a folder holding them such as the build's products, and an image is named with `atos` only from the dSYM whose UUID, by `dwarfdump`, is the crashed image's: any other would name the wrong functions and look right, so a report with none says which UUID it wanted and which the folder has.

On Android it is a folder of libraries that keep their symbols, such as the `lib` folder of a build (`merged_native_libs/.../out/lib`, the ABI found from the tombstone), read by `ndk-stack` from the newest NDK in the SDK, which leaves a library of another build unread, and the answer says which ids differ.

A tombstone comes a moment after the crash, and a Java crash has none. Android keeps few tombstones: on API 34, of an app's first 6 native crashes in a few minutes, one left a tombstone and the next none. The answer says so, and a loop of crashing runs will meet it. The whole stack is left in the file `named` gives. Optimized Swift may give a function with no line.

## Putting a device back

Changing a condition writes the old value down first, with the process that changed it. It goes back when that session ends, or with `set_device` name `restore`, which leaves alone what another live process changed and says so.

A session that died leaves the file, and the next one on that device puts back only what a dead process left, and says so; what cannot be put back is reported, and a file that cannot be read is kept beside it as `.bad`.

A command line is one process per command, so its changes stay until `restore`, whatever sessions come and go. A change's answer says which of the two it is.

A recording, a network capture, an open report and a flow recording go the same way. The next session ends what a dead process left and says so (a flow recording stops with its steps kept), leaves what a live one runs, and leaves what a command line started for its next command.

## Radios, biometrics and the keychain

### Radios

A radio is done when the device reads as asked, within 10 s: Wi-Fi by the state of the radio, because its setting changes first, and airplane mode and mobile data by the user's switch, so that a restore during airplane mode brings back what they chose. A device that does not change is refused with what it said. A device reached over its network (`adb connect`, wireless debugging) refuses `wifi off` and `airplane on`, because nothing could reach it to put them back. On an emulator, mobile data off or airplane mode on leaves the device no way to this Mac, and `restore` brings it back. A switch says nothing of a connection.

### Biometrics

`biometric` on an emulator touches its sensor and is done only when the fingerprint service counted the touch: `match`, `nomatch`, each refused when no app is asking. On an emulator with no fingerprint `enroll` takes one by itself: it sets the screen lock to PIN 1234, written down first, goes through Settings' enrolment by its kinds of control and not their words (the PIN field, then the lowest and rightmost button), and touches the sensor until the service holds one. `restore` takes the PIN off, and Android deletes the fingerprints with it.

An emulator with a lock of its own is refused, as its PIN cannot be typed, and so is a server started with `--no-home`, since Settings leaves the app. A real phone is refused: its sensor takes only a person's finger, and its lock is its owner's. A simulator's `enroll` turns Face ID or Touch ID on.

An app's prompt on Android is the system's and holds the focus: it reads as elements like any screen, though a screenshot of it is blank, because it is a secure window.

On an iPhone `devicectl device simulate biometrics` answers `Device does not support any biometric simulation, nothing to do` and exits 0, so it is not used: an answer would say done for a touch that never happened.

### The keychain

`keychain` `reset` empties a simulator's keychain, and says how many items apps held, from the store's own rows, which also prove it empty after. The system's own rows stay and are not counted. It is one-shot: nothing brings them back.

## Memory warnings, shakes, photos and an app ended in the background

### Memory warnings

`memory_warning` sends the app, `app` or the one selected, the warning the system sends when memory runs short. On a simulator every app that runs there gets it, as from Simulator's own menu, one a call, and a level is refused.

On Android `value` is the trim level `am send-trim-memory` takes, `RUNNING_CRITICAL` unless given: `RUNNING_MODERATE`, `RUNNING_LOW` and `RUNNING_CRITICAL` reach an app in front, `HIDDEN`, `BACKGROUND`, `MODERATE` and `COMPLETE` one in the background. Android takes a level only above the one it last gave the process, and a new process is at none, so a refusal says which level the app is at; as the system counts an app sent home as in front for about a second, a background level is asked again for 3 s. Each level reached the fixture's `onTrimMemory` on API 35 and API 36.

On an iPhone `devicectl device process sendMemoryWarning` sends it to the app's process; it has not been run on a phone yet.

### Shakes

`shake` posts the notification a simulator's UIKit takes for a shake, which the app in front gets, one a call. On an emulator the accelerometer is pulled from side to side across gravity's axis, four ways of 80 ms, and its reading put back: the fixture counted one shake a call. A phone and an iPhone are shaken only by hand, and refuse it.

### Photos and videos

`transfer_files` `media` adds a photo or a video, or a folder's photos and videos, inside the server's folder, to the device's library.

A simulator takes them by `simctl addmedia`, and the answer counts what Photos then holds; its Photos has no delete, so nothing takes them out. Each file goes by a call of its own, as `simctl addmedia` given several imports those it can and then ends on an exception that names none. A file Photos cannot import is refused `INVALID_ARGUMENT` by its name, with how many of the others went in, what may help (an H.264 video in an `.mp4` or a `.mov`, a `.png` or `.jpg` photo) and simctl's line under it; for a folder, the line is simctl's for the last file it refused.

Android's are each written down by path and size, pushed into `Pictures/appdyno` and scanned by MediaProvider's own `scan_file`, as a pushed file stays out of the library's sight until it is scanned, and the answer counts how many of them the library then lists. `restore` and the session's end delete exactly those, each only while it has the size it was pushed with, and name any that changed. An iPhone refuses it.

### An app ended in the background

`manage_app stop` with `background` ends an app as the system ends one in the background for memory: home, 1.5 s once the app has left the front to save its state, then its process killed, by SIGKILL on a simulator, `am kill` on Android and `devicectl device process terminate --kill` on an iPhone, which has not been run on a phone yet. A process that still runs is refused, as `am kill` ends only a process the system may end, and a foreground service keeps one.

On Android the activity it was on comes back with its saved instance state when `launch_app` started the task; one a link started first comes back under a new launcher activity. On a simulator the value the fixture keeps by `@SceneStorage` came back in a new process; a simulator that once discarded the saved scene at a launch did so at every launch until it booted again (iOS 26.5).

## An iPhone's own conditions, data and permissions

`network` and `thermal` on an iPhone are the phone's own conditions, as Xcode's Devices window sets them, through its instruments: `network` `slow` is the first EDGE profile the phone lists, or a profile by name, and `full` none; `thermal` `fair`, `serious` or `critical`, and `nominal` none. One holds at a time.

The phone keeps one after the process that set it is gone: a session killed by SIGKILL left `SlowNetworkEdgeBad` on, and the next session's start found it written down and turned it off. A thermal profile ramps for seconds each way, and the phone answers nothing meanwhile, so one is done when the phone reads it so. These go by the same private services of the phone as its live window, and where those cannot be reached they are refused, saying why.

`manage_app clear` on an iPhone empties the app's data container, as `transfer_files push` with an empty folder does: development-signed apps only. iOS has no grant: `grant` and `revoke` reset the app's answer, so it asks again, and `answer_alert` answers. `locale` with an app holds it in a language for every launch this tool makes, as on a simulator.

## A slow network

`network` `slow` on an emulator goes by its console: an EDGE speed both ways and a delay of 40 to 100 ms. A phone from Android 13 has only Android's own cap, `ingress_rate_limit_bytes_per_second`: `slow` caps what it downloads at 30 kB/s, an EDGE network's download, and a number caps it at that many bytes a second on a phone or an emulator. It adds no delay and leaves uploads at full speed, and the answer says so. The cap is a setting the device keeps, so the old one is written down and `restore` deletes it.

## A fold

### A foldable Android device

`fold` on Android asks `cmd device_state` for the state of that name, by its id there, which differs by device, and is done when the device is in it. It takes every pose the device lists: `open`, `closed`, `half_opened` (also `half`), `rear_display`, and `dual` for both displays at once. A read says the state and then the list. A change answers with the display size and density apps then see, and whether the activity in front was recreated or kept, by the system's own relaunch line.

Tabletop and book are not device states: they are half opened with the hinge lying across or standing, which an app reads for itself.

The request holds until it is reset, whatever the hinge does and whatever becomes of this tool, so it is a condition: `restore` resets it, and `default (now open)` is no request.

It is the same on an emulator and a phone, from API 31. It has not been run on a real foldable. A live window on a folded emulator takes the guest's own picture, which is smaller and lags, as the emulator draws the cover stretched into the inner display's frame.

### An iPhone Duo simulator

On an iOS simulator with two built-in displays, the iPhone Duo with Xcode 27.1 or later, `fold` takes `closed`, `half` and `open`. It is read by which display `devicectl device info displays` says is active, and set by the hinge event the simulator's hinge slider sends, which is private API. The display follows the hinge up to 2.5 s later; one that does not follow is refused, and booting the simulator again clears it.

The simulator keeps no request to reset, so the pose found is what is written down, and `restore` and the session's end set it again. Nothing outside the simulator tells half open from open: `half` reads back only where this session set it, and a device found half open is put back open.

While it is open, reads, touches, `take_screenshot` and `record_session` are of the inner display, and an app keeps its process as its scene moves there. Three things differ: the home screen's elements read in the cover's coordinates, a recording comes out unturned, and only the direct input path taps there, not the runner's. Any other simulator refuses.

## Languages

### A language on Android

`locale` on Android is an app's own from API 33, given the app or with one selected, by `cmd locale`. Below API 33, where apps have none, it is the whole device's, set by the agent as Settings sets it: Android keeps it in `persist.sys.locale`, so the old value is written down first and put back. A device that had never chosen one keeps the old language as chosen after.

### A language on a simulator

On a simulator, with an app given or selected, `locale` holds that app in a language for every launch this tool makes, by `-AppleLanguages` and `-AppleLocale`, kept on this Mac: nothing changes on the simulator. With an app selected, what does not change is the system's own text, such as permission prompts and Settings, and a launch this tool does not make: an icon tap, a link or a push that starts the app, the app starting itself again.

`app ""` sets the whole simulator, and the answer names which it took. An app that runs is started again in it, and again at `restore`. XCTest's launch measure is given the same arguments, which has not been checked.

`launch_app` `language` is that launch's alone, on a simulator and an iPhone: the next launch is in the language held, else the system's. One app's language is held at a time: another is refused until `restore`.

## Sharing a device

A process that drives a device holds it: a file in the state folder with its pid and start time. A dead owner's claim is free. A second process is refused `DEVICE_CLAIMED`, with the owner's pid and name, unless it asks to share: `use_device` with `share: true`, `--share` on either command line, or `APPDYNO_SHARE=1`.

`list_devices` shows who holds what. There is no daemon. The process that puts back what an ended server left holds the device as `appdyno put-back` while it does, and a session that starts meanwhile waits for it, up to 40 s, where it is refused at once by any other holder.

With no device selected and more than one this server may drive, a call that needs one is refused, naming each by serial, kind and model, and `use_device` picks one, by its serial or UDID, a simulator's or an AVD's name, or its model, the allow list matched against each; a device it may not drive is refused with the ones it may, by name. `list_devices` gives each device's `kind`: `phone`, `simulator` or `emulator`; an emulator has no `link`, as no cable joins it.

## Starting a simulator or emulator

`manage_simulator` boots and shuts down simulators and emulators, on request only. With no name, shutdown touches only what this tool started. `APPDYNO_EMULATOR_ARGS` replaces the emulator's default flags, and `APPDYNO_EMULATOR_FIRST_PORT` is where the search for a free port starts.

`--allow-devices` takes a simulator or emulator here by its id, its serial or its name, as `name` does, so one allowed for `shutdown` is allowed for the `boot` after it. A stopped emulator has no serial of its own: it answers to the one it ran as when this tool shut it down, and comes back on that port while it is free, as one the hub starts again comes back on the port it was last listed on, which its window waits on. A `shutdown` that the `boot` after it would refuse is refused first, and the device stays on.

A `shutdown` of the selected device ends the session on it and what its apps held in memory, and asks no one, as nothing the device keeps on its disk goes: its progress says so before it begins, and its answer once it is done. What the session changed goes back first, as at the session's end, while the device still answers: dark mode, text size, animations, the rotation a turn set and the rest, and the answer names each, or what could not go back. There is no reboot: a `shutdown` and a `boot` are two calls, as [SECURITY.md](../../SECURITY.md) has it.

With `--allow-devices`, `create` is off, and the hub's New Simulator with it, refused before anything is made: a new simulator's UDID is not known before it is made, so no list names it, and a server that made one only to refuse it left it behind. One made that does not start says how a person removes it, as nothing here deletes one.

## Reaching a phone

### An Android phone

Turn on USB debugging, connect, and check `appdyno devices`.

A Xiaomi asks on its screen before each new install over USB and says no by itself after 10 s: `manage_app install` wakes the phone and taps that prompt's yes, but only during an install it started itself; the answer and `record_session` say so (`--no-install-consent` leaves it to you).

Play Protect's prompt to send the app to Google is always answered no: a private build is not sent to Google. A Play Protect warning is left alone, quoted, unless the server runs with `--accept-install-warnings`. See [A phone's install prompts](protocol.md#a-phones-install-prompts) for what was seen on which phone.

A Samsung with One UI has no prompt of its own, and Play Protect's come only with "Verify apps over USB" on. What else differs between the two is in [One UI against HyperOS](perf.md#one-ui-against-hyperos).

### An iPhone

Turn on developer mode. A phone needs a development signing identity and a provisioning profile that names it. An installed profile for a wildcard app id, with its identity in the unlocked login keychain, is found by itself. To choose another, set `APPDYNO_IOS_PROFILE=<profile.mobileprovision>`, `APPDYNO_IOS_KEYCHAIN=<keychain-db>` and `APPDYNO_IOS_KEYCHAIN_PASSWORD=<password>`. Run `appdyno doctor` to see what it found.

The phone is reached over USB. Only a window goes by the network.

A phone's clipboard goes by Xcode's `devicectl`, with no runner and nothing asked on the phone, and a simulator's is read from the Mac. Text goes in as keys on iOS: a paste brings up iOS's "Allow Paste" alert.
