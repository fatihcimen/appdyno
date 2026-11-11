# Tools

[Türkçe](tools.tr.md)

The 48 tools an MCP client can call. Each is also [a command](cli.md), and a call in [the library](library.md). What each one was run on, and what the runs showed, is in [How the tools were tested](tools-tested.md).

On this page a _window_ is a live window of a device, which `mirror`, the hub or the Mac app opens. The _runner_ is appdyno's helper app on an iPhone or a simulator, and the _agent_ is its helper on Android. A _condition_ is a device setting that appdyno changed and puts back. The _allow list_ is what `--allow-devices`, `--allow-apps` and `--allow-urls` let this server touch.

Tools take no `device` parameter. The device is the one `use_device` selected, else the server's `--device`, else the only connected device this server may drive.

A client's calls that act run one at a time, in the order they arrive. If a client sends two at once, such as a `tap` on each of two refs in one turn, the second runs after the first and aims at the screen the first left, so a ref that the first removed is refused as `STALE`. A call that waits for its turn says `waiting its turn` in its progress. Calls that only read, such as `screen`, `find`, `wait_for` and `assert`, do not wait, and a tool that `steps` calls runs inside that `steps` call.

The server speaks MCP's revisions from 2024-10-07 to 2025-11-25, which open with `initialize`, and 2026-07-28, which
opens with `server/discover`, over stdio and over `--http` alike: the client's first message says which. The tools
and what they say of themselves are the same, byte for byte, on each.

## Every tool

The inputs below are read from each tool's schema. A bold input is required. After a colon come the values an input takes, or its default, which is marked. On a tool that acts, `read` picks how much of the screen its answer holds: what changed (`diff`), all of it (`full`) or none of it (`none`). A target is a `ref`, `x` and `y`, or a `selector`, as [Targets](#targets) says.

### Devices

| tool              | what it does                                                                                                  | inputs                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_devices`    | Connected phones, simulators and emulators: which this server may drive, who holds each, and what blocks each | –                                                                                                                                                                                                                                                                                          |
| `use_device`      | Selects the device to drive, and the app under test                                                           | **`device`**; `app`; `share`                                                                                                                                                                                                                                                               |
| `device_info`     | The model, OS version, screen, agent version and the app in front                                             | –                                                                                                                                                                                                                                                                                          |
| `set_orientation` | Turns the screen, which stays turned until it is turned back                                                  | **`orientation`**: `portrait`, `landscape_left`, `upside_down`, `landscape_right`; `read`: `diff` (default), `full`, `none`                                                                                                                                                                |
| `set_location`    | A fake GPS location, until `clear` or the session's end                                                       | `lat`; `lon`; `clear`                                                                                                                                                                                                                                                                      |
| `clipboard`       | Reads the clipboard, or with `text` writes it                                                                 | `text`                                                                                                                                                                                                                                                                                     |
| `device_setting`  | Reads or sets a condition, such as dark mode, text size or a slow network; with no `value` it reads           | **`name`**: `dark_mode`, `text_size`, `reduce_motion`, `increase_contrast`, `reduce_transparency`, `animations`, `locale`, `network`, `proxy`, `battery`, `airplane`, `wifi`, `mobile_data`, `fold`, `thermal`, `restore`, `biometric`, `call`, `sms`, `keychain`; `value`; `title`; `app` |
| `simulator`       | Lists, boots, creates and shuts down simulators and emulators                                                 | **`action`**: `list`, `boot`, `create`, `shutdown`; `name`                                                                                                                                                                                                                                 |

### The window

| tool       | what it does                                                                             | inputs                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `mirror`   | A live window of the device, which a person can watch and touch                          | **`action`**: `open`, `close`, `status`, `stats`; `quality`: `auto` (default), `high`, `standard`; `wifi`: `false` (default) |
| `hand_off` | Asks the person to do what a tool cannot, such as Face ID, and waits until they are done | **`reason`**; `timeoutS`: `300` (default)                                                                                    |

### Reading

| tool         | what it does                                                                 | inputs                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screen`     | The screen's elements, each with a ref                                       | –                                                                                                                                                                            |
| `find`       | Elements by text, id or role, with their state and bounds                    | `selector`                                                                                                                                                                   |
| `wait_for`   | Waits until an element shows, or with `gone` until it is gone                | `ref`; `selector`; `gone`: `false` (default); `timeoutMs`: `5000` (default); `read`: `diff` (default), `full`, `none`                                                        |
| `assert`     | Checks an element, pass or fail: `CHECK_FAILED` when the check does not hold | `ref`; `selector`; `check`: `exists` (default), `absent`, `text`, `enabled`, `checked`, `focused`, `moves`; `equals`; `expect`: `true` (default); `timeoutMs`: `0` (default) |
| `screenshot` | An image of the screen, or with `watchMs` what moved on it                   | `points`; `width`; `watchMs`; `strip`; `file`; `overwrite`; `inline`                                                                                                         |

### Acting

| tool        | what it does                                                                 | inputs                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tap`       | Taps a target                                                                | `ref`; `x`; `y`; `selector`; `read`: `diff` (default), `full`, `none`                                                                                                                     |
| `gesture`   | A double tap, a long press, a drag, a pinch, or a free `plan` of fingers     | **`kind`**: `double_tap`, `long_press`, `drag`, `pinch`, `plan`; `ref`; `x`; `y`; `selector`; `to`; `scale`; `durationMs`; `holdMs`; `pointers`; `read`: `diff` (default), `full`, `none` |
| `swipe`     | Swipes, from a target if one is given                                        | **`direction`**: `up`, `down`, `left`, `right`; `ref`; `x`; `y`; `selector`; `distance`; `durationMs`; `exact`; `read`: `diff` (default), `full`, `none`                                  |
| `scroll_to` | Scrolls until an element is on the screen                                    | **`selector`**; `direction`: `up` (default), `down`, `left`, `right`; `maxSwipes`: `10` (default); `x`; `y`; `read`: `diff` (default), `full`, `none`                                     |
| `type_text` | Types up to 500 characters into the focused field, or into a target          | **`text`**; `ref`; `x`; `y`; `selector`; `replace`; `submit`; `read`: `diff` (default), `full`, `none`                                                                                    |
| `press_key` | Presses a key or a button                                                    | **`key`**; `count`; `read`: `diff` (default), `full`, `none`                                                                                                                              |
| `keyboard`  | The on-screen keyboard: whether it is open, closing it, or its enter key     | **`action`**: `status`, `dismiss`, `enter`; `read`: `diff` (default), `full`, `none`                                                                                                      |
| `steps`     | Up to 30 tools in one call                                                   | **`steps`**; `read`: `diff` (default), `full`, `none`                                                                                                                                     |
| `alert`     | Reads the open system alert, or answers it                                   | `answer`; `read`: `diff` (default), `full`, `none`                                                                                                                                        |
| `inspector` | An iPhone's screen with no signing, by the phone's own accessibility service | **`action`**: `list`, `press`; `name`                                                                                                                                                     |

### Apps

| tool            | what it does                                                                   | inputs                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open_link`     | Opens a link or a Settings page, or lists the links an app opens               | `url`; `settings`; `links`; `read`: `diff` (default), `full`, `none`                                                                                                                                                                                                        |
| `launch_app`    | Launches the app, or brings it to the front; `restart` starts it fresh         | `app`; `restart`; `args`; `env`; `language`; `read`: `diff` (default), `full`, `none`                                                                                                                                                                                       |
| `terminate_app` | Stops the app                                                                  | `app`                                                                                                                                                                                                                                                                       |
| `app`           | Installs, lists and manages apps, their data and their permissions             | **`action`**: `list`, `state`, `install`, `uninstall`, `clear`, `grant`, `revoke`, `download_data`, `replace_data`, `build_and_run`; `app`; `path`; `service`; `scheme`; `configuration`; `args`; `env`; `all`: `false` (default); `read`: `diff` (default), `full`, `none` |
| `push`          | Sends the app a push notification; with no `type`, says what this device takes | `app`; `type`; `title`; `body`; `image`; `data`; `payload`; `read`: `diff` (default), `full`, `none`                                                                                                                                                                        |

### Checks

| tool      | what it does                          | inputs                                                                                                                                                                                      |
| --------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit`   | Accessibility issues of the screen    | `types`: `contrast`, `elementDetection`, `hitRegion`, `sufficientElementDescription`, `dynamicType`, `textClipped`, `trait`, `imageContrast`, `duplicateLabel`; `maxIssues`: `50` (default) |
| `logs`    | The app's log, with secrets hidden    | `app`; `since`; `level`: `verbose`, `debug`, `info` (default), `warn`, `error`; `maxLines`: `200` (default); `contains`                                                                     |
| `crashes` | The app's crash, ANR and exit reports | `app`; `since`; `limit`: `5` (default); `symbols`                                                                                                                                           |
| `visual`  | The screen against a saved image      | **`action`**: `baseline`, `compare`; **`name`**; `dir`; `tolerance`: `0.1` (default); `masks`                                                                                               |

### Evidence

| tool      | what it does                                                                                     | inputs                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record`  | A video of the screen                                                                            | **`action`**: `start`, `stop`; `file`; `maxSeconds`: `1800` (default)                                                                                   |
| `report`  | A test report in one HTML file, a timeline, or an app's last seconds, kept on a crash or a stall | **`action`**: `start`, `timeline`, `flight`, `write`, `stop`; `dir`                                                                                     |
| `network` | The app's HTTP traffic                                                                           | **`action`**: `paths`, `start`, `read`, `stop`; `via`: `proxy`, `probe`, `packets`, `bytes`; `proxy`; `app`; `har`; `contains`; `limit`: `50` (default) |

### Inside an app

| tool           | what it does                                                           | inputs                                                                                                           |
| -------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `webview`      | Inside a debuggable app's web view: its elements, a click, a script    | **`action`**: `pages`, `elements`, `click`, `eval`; `page`; `selector`; `js`; `app`                              |
| `react_native` | A debug React Native app through Metro: its targets, its log, a reload | **`action`**: `targets`, `logs`, `reload`; `metro`: `localhost:8081` (default); `target`; `ms`: `3000` (default) |

### Measuring

| tool            | what it does                                                     | inputs                                                                                                                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perf_snapshot` | CPU, memory and frames now, and the device's load and heat       | `app`; `cpuWindowMs`: `2000` (default); `also`: `threads`, `network`, `energy`, `anonMemory`, `startInfo`, `surface`, `battery`, `exits`, `size`; `batteryWindowMs`: `30000` (default); `scenario`                                                                                           |
| `perf_scroll`   | Frames, frozen frames and memory as a list scrolls               | `app`; `direction`: `up` (default), `down`; `swipes`: `5` (default); `repeats`; `probe`; `scenario`                                                                                                                                                                                          |
| `perf_launch`   | Cold, warm or hot launch time, over several launches             | `app`; `mode`: `cold` (default), `warm`, `hot`; `repeats`: `5` (default); `compile`: `speed`, `speed-profile`, `verify`; `trace`; `baselineProfile`; `probe`; `scenario`; `baseline`                                                                                                         |
| `perf_profile`  | Where the app's CPU time goes, by function                       | `app`; `seconds`: `3` (default); `scroll`: `up`, `down`; `dsym`                                                                                                                                                                                                                              |
| `perf_heap`     | A heap dump, and on iOS the count of leaks                       | `app`; `profile`: `java_hprof`, `heapprofd`; `seconds`: `5` (default)                                                                                                                                                                                                                        |
| `perf_trace`    | Why frames were slow, and an iPhone's hangs                      | `app`; `seconds`: `5` (default); `scroll`: `up`, `down`; `what`: `frames` (default), `hangs`, `xct_hitches`, `xct_launch`; `dsym`; `probe`; `scenario`                                                                                                                                       |
| `perf_compare`  | The performance gate: kept runs against the baseline and budgets | `action`: `compare` (default), `why`, `reference`, `budget`, `baseline`, `dashboard`, `functions`, `prune`; `limitGb`; `dryRun`; `from`; `to`; `app`; `scenario`; `deviceClass`; `last`: `1` (default); `replace`; `kind`; `max`; `min`; `format`: `text` (default), `json`, `junit`; `dsym` |
| `perf_query`    | A table from a kept trace, by SQL or by its name                 | **`trace`**; `sql`; `table`; `limit`: `50` (default)                                                                                                                                                                                                                                         |

### Replaying

| tool   | what it does                                                                                   | inputs                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `flow` | Records actions as a repeatable test, replays it with no model, and exports it as Maestro YAML | **`action`**: `start`, `stop`, `save`, `run`, `export`; `file`; `to`; `from`; `params`; `envFile`; `overwrite`; `iterations`; `scenario` |

## Reading the screen

The on-screen keyboard is one element, `@keyboard keyboard`, on iOS as on Android, and none of its keys, bars or predictions is listed: `type_text` types, `press_key` `enter` presses its return key, `keyboard` `dismiss` closes it, and a touch on it is refused. A field's tap that opened it says so in one line of the diff. `type_text` with no target on iOS, where no field holds the focus and no keyboard is up, is refused with `NO_FOCUS` before a key is sent: iOS takes keys with nothing focused, and the first can focus a field the rest then land in. On iOS what lies under the status bar, above a navigation bar at the top of the screen, is left out as what is past the screen's edge is, since a touch there scrolls a list to its top. Four or more elements at one point, none holding another, are rows a list has not placed yet, piled where it begins: they are left out too. A ref names an element by what it is, so it holds across scrolls and redraws; a field with no id of its own is named by the words around it, so its ref holds while its placeholder comes and as it is typed in.

A whole screen in an answer folds what repeats. A plain text or image inside a row whose label already holds it gets no line of its own, nor does a control named as the row at the row's very place; the first line counts what was folded. Three or more like rows in a sequence share one header (`cell x=201 clickable: ref "label" y`). A label that an element gives twice is shown once, and what tells two like elements apart, such as their place, is shown only when another line has the same name. Only the text is folded: `find`, selectors, refs, diffs, flows and `report` still reach every element.

A screenshot's answer says where its pixel is tapped: its x and y times its scale to tap units, said as a division where that is a whole one, `x/3` for an iPhone's picture at full size. With `file` it saves the picture at full size and shows the image as a screenshot does beside it, whose size and scale the answer gives, so that the file need not be read back; `inline: false` saves the file alone.

## Targets

A target is a `ref`, `x` and `y`, or a `selector` `{ text, id, role, index }`, resolved on a fresh read
just before the action. Text matches as `find` does, without case or accents ("İstanbul", "istanbul"),
and an exact match beats a partial one. Several matches refuse and list them with their refs; no match
waits a moment, then refuses with the nearest labels, or, where another app is in front and the app did not leave on purpose, says that the app is not; a `wait_for` that runs out says the same, and that calling again waits longer. When a target is under the on-screen keyboard, where a touch would type a letter, or a selector finds nothing because the keyboard shrank the window, the keyboard is closed and the target is looked for once more, before any wait for it; a replayed flow's step does the same before its own wait. A phone in landscape shows a full-screen keyboard over the whole app.

## Steps, gestures, apps and settings

`steps` runs up to 30 steps across screens. A ref or selector need exist only when its step runs. It
stops at the first failure, says which step and why, and shows the screen. `wait_for` and selectors
wait on the device, so the tree crosses the wire only when the screen changed.
If the app dies under an action, the action is refused with `APP_NOT_RUNNING`: the answer says what the action did, the crash report's reason and the app's last log lines, from the first line that says why. In `steps` this ends the call, naming the step. The app watched is the selected one, else the one in front as the touch was aimed, which a launch or a link earlier in the call may have opened. A later step that fails because an earlier crash left no app adds `APP_NOT_RUNNING` and what to do to its own error, and so does a flow's step. An action still running after a second has its app's process watched, and is refused as soon as the process is gone, whatever the device answers after: a crash under a touch could hold the device's answer for its whole 15 s, which read as a stuck agent.
`wait_for` waits 15000 ms at most a call, as its description says, and a number past an argument's limit is refused with the limit in the hint.
A selector goes in `selector` in every tool and step that takes one, `find`, `wait_for` and `assert` among them, as `{"action":"tap","selector":{"text":"OK"}}`: its words given at the top are refused, with the call in that shape in the hint.

`gesture` holds `double_tap`, `long_press`, `drag`, `pinch` and a free `plan`. `press_key` holds the buttons (`back`, `home`, `app_switch`, `volume_up`, `volume_down`, `mute`, `siri`, `power`, `lock`), a keyboard's keys (`enter`, `delete`, `tab`, `escape`, `space`, the arrows `arrow_up`, `arrow_down`, `arrow_left` and `arrow_right`, and a letter or digit with the keys held first, as `command+a`, where `command` is Ctrl on Android), and `control_center`, `notification_center` and `spotlight`, which `home` closes. A key's name is read whatever its case, and `return` is `enter`, `esc` `escape` and `backspace` `delete`; a letter is a small one, as a capital would be a shift too.
`app` holds `list`, `state`, `install`, `uninstall`, `clear`, `grant`, `revoke`,
`download_data` into a new or empty folder, and `replace_data`
from one, which stops the app and takes away what the folder does not hold, and `build_and_run` from a
project on this Mac: an Xcode project with `scheme` and `configuration`, or a Gradle folder with `scheme` as
its module and `configuration` as its variant.
`device_setting` holds `dark_mode`, `text_size`, `reduce_motion`, `increase_contrast`, `reduce_transparency`, `animations`, `locale`, `network`, `thermal`, `proxy`, `battery`, `airplane`, `wifi`, `mobile_data` and `fold`; the one-shot `biometric`, `call`, `sms` and `keychain`; and `restore`, which puts back what was changed. `dark_mode` reads as it is set, `on` or `off`, on both platforms.

`launch_app` says whether it started the app or brought a running one to the front, on the screen it was on; with `restart`, `args`, `env` or `language` it stops a running one first, and says whether it started the app or restarted it. An app the device does not have is refused as `NOT_FOUND` on both platforms, with `app` `list` in its hint.

Each change is read back: the answer says `changed` only when the device then reads otherwise than before, and `restore` says restored only of what then reads as it was. `text_size` on iOS is one of its sizes, from `extra-small` to `accessibility-extra-extra-extra-large`, and on Android a scale from 0.25 to 5 or `default`: another is refused, with what it takes. A location `set_location` fixes is written down as a condition is, so `restore` and the session's end take it back to the real one.

## What asks the person first

These lose what a person may want, so each waits for the person's yes:

- `app uninstall`: the app and all it keeps on the device
- `app clear`: all the app keeps
- `app replace_data`: all the app keeps now, which the folder's data replaces
- `app revoke`: a permission the app was given
- `app grant`: on an iPhone only, where `grant` resets the permission to ask, which loses the answer the person gave. A simulator's
  and Android's lose nothing and ask nothing
- `device_setting keychain`: every item apps keep in the keychain
- an input on the system's own power, emergency or erase controls, the device itself: a tap, gesture, swipe, long press,
  typing or key from any tool, `steps` or a flow, on Android's power menu (Power off, Restart, Emergency) or its button in
  quick settings, a lock screen's emergency call, Settings' resets and its erase-all-data screen, iOS's power-off screen
  but its Cancel, any part of Control Center, whose power button has no mark of its own, or Settings' Reset and Erase All Content and Settings, known by the system app, the ids in any
  language and the words in English and Turkish wherever the touch lands; and a third press of the power or side key in
  5 seconds, which calls for help on many phones. appdyno restarts, resets and erases no device, and powers off none but a simulator or emulator, by `simulator` `shutdown`; for the rest the
  answer says the person does it. Reading such a screen asks nothing, nor back and home, which leave it. Only
  `--allow-power virtual` or `all` lets these go ahead with nothing asked, never `--allow-data-loss`
- a call: `open_link` with a link that places one (`tel:`, `telprompt:`, `facetime:` or `facetime-audio:`), and a touch, key or text in a phone app (a dialer, its call screen or FaceTime, or an Android device's own default dialer) or on a button but Cancel of an iOS system alert whose text is a phone number alone, in any language, or on one that says Call or Ara. appdyno places no call, and `--allow-power` is the flag for these too

The server asks by the client's own prompt, MCP elicitation, where the client declared it can, at `initialize` on a 2025
revision and on each request on 2026-07-28, and names the device, the app and what is lost. The model cannot answer it.
A no or a closed prompt does nothing, and the answer says its question got no yes, never that a person declined: a client may answer by itself, as one run headless answered no in 9 ms, with no person shown the question. Each refusal's hint, a no's too, says how a person allows it ahead of time, by the flags below.
On 2026-07-28 no request goes back to a client, so the call ends its round with the question and the client brings the answer back with the call: the call waits where it stopped, so a step before it in the same `steps` is not done again, and an answer that does not come in 5 minutes is a no.

A client that cannot ask is refused with `PERMISSION_REQUIRED` and how a person allows it, and so is every client over `--http`, a 2026-07-28 one too: whoever holds the token would answer the question it is asked, so nothing a caller answers there is a person's yes, and only the server's own flags let these go ahead.
`--allow-data-loss virtual` on the server's command line lets these go ahead with nothing asked on simulators and emulators, and `all` on phones too. Only a person's registration of the server sets it: no argument, step or file of a tool stands for a yes. A command asks on its terminal and takes `--yes` for the answer; with neither, only the flag lets it go ahead.

`app install` and `build_and_run` are not among them: neither removes an app first.
Under `--allow-apps`, `app install` installs only an app the list
names, by the id the file holds, read before anything reaches the device, and refuses another, naming it; `build_and_run` is refused, as what a project builds is not known before it is built. On Android an install the device refuses says why and what a person can do: an app signed with another key is `PERMISSION_REQUIRED`, as only `app uninstall`, which loses all the app keeps and so asks a person, makes room for it; an older version is `INVALID_ARGUMENT`; no room, an Android older than the app's minSdk, or native libraries for another processor are `UNSUPPORTED`.

## What each platform can do

What a platform cannot do is refused with the reason (`UNSUPPORTED`):

| feature                           | Android                              | simulator                              | iPhone                         |
| --------------------------------- | ------------------------------------ | -------------------------------------- | ------------------------------ |
| volume buttons                    | yes                                  | yes (no way to read back)              | the runner                     |
| clear an app's data               | `pm clear`                           | empties its container                  | development-signed apps        |
| reads with no signing             | no need                              | no need                                | `inspector`: words and ids     |
| download, replace app data        | debuggable builds                    | yes                                    | development-signed apps        |
| grant, revoke a permission        | `pm grant`, `pm revoke`              | `simctl privacy`                       | reset to ask, then `alert`     |
| launch environment                | no: args are intent extras           | yes                                    | yes                            |
| dark mode, text, motion, contrast | yes                                  | yes                                    | `devicectl`                    |
| reduce transparency               | no: its blurs are a developer option | yes                                    | `devicectl`                    |
| animations                        | yes                                  | no: use `reduce_motion`                | no                             |
| locale                            | per app, API 33+; whole device below | per app; `app ""`: the whole simulator | per app, the tool's launches   |
| slow network, thermal state       | emulator; a phone's downloads, 13+   | no                                     | Xcode's conditions             |
| biometrics                        | an emulator's fingerprint            | yes                                    | no: `devicectl` simulates none |
| airplane, Wi-Fi, mobile data      | yes, read back                       | no: it has the Mac's network           | no                             |
| keychain                          | no: Android has none                 | emptied, counted                       | no                             |
| fold pose                         | a foldable, API 31+, put back        | no: `simctl` has none                  | no                             |
| incoming call, SMS                | emulator only                        | no: no telephony                       | no                             |
| battery level                     | yes                                  | no: it only draws one                  | no                             |
| proxy                             | yes, put back                        | follows the Mac's                      | no: its Wi-Fi settings         |

An Android app that targets API 37 reaches this Mac, at `10.0.2.2` from an emulator, or the local network only with the `ACCESS_LOCAL_NETWORK` permission: without it, its requests hang, and `perf_snapshot` and `network` count 0 bytes.

## Push notifications

`push` sends one to the app, by `type`, from fields (`title`, `body`, `image`, `data`) or from `payload`, the platform's own JSON: APNs' on iOS, an FCM message on Android. Given both, it refuses. A push is always the app's own: nothing shows a notification under any name but the app's, and where the app cannot be given one, `push` refuses, saying what it needs.

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

On a simulator the answer says what reached the app's code, by where the app was at the push, read just before it: in front, its code gets it; in the background or not running, the push is only shown, and the code gets it when its banner is tapped. An app no one allowed notifications shows none, and `simctl` fails ("Source is not authorized"), yet an app in front still gets the push in its code: the answer says so then, and where the app is not in front `push` refuses, saying how to allow them.

A simulator runs no Notification Service Extension for `simctl push`, so a rich push reaches the app's code unchanged, and `simctl push` takes no topic but an app's, so a Live Activity's push never reaches the activity. Apple tests these pushes on a simulator through APNs' sandbox, from a Mac with Apple silicon or a T2 on macOS 13 or later, with the activity's own push token. So a rich push, a background push, a Live Activity's, a VoIP push and a widget's reach a simulator only from APNs' sandbox, with a key of the app's team: once a person has set one up, as below, `push` sends them there, and until then each refusal says so.

### FCM's own message on Android, with no project or key

An Android app with Firebase Messaging takes an alert, a rich push, a background push and a Live Activity's as FCM's own message, with no Firebase project and no key. `push` sends the broadcast Google Play services hands an app, `com.google.android.c2dm.intent.RECEIVE`, to the receiver the Firebase Messaging SDK declares, `com.google.firebase.iid.FirebaseInstanceIdReceiver`, with the extras the SDK reads, as its [source](https://github.com/firebase/firebase-android-sdk/tree/main/firebase-messaging) has them: the data as given, a notification under `gcm.n.`, a `google.message_id` new for each push, the priority, high unless FCM's own payload says `NORMAL`, and its collapse key.

The receiver lets in only the system, root and the app itself, so `push` sends it by `run-as` on a debuggable build, as the app's own uid, or as root where adbd already runs as root; it never restarts adbd to make it so. A broadcast from the shell's own uid is skipped without a word. The receiver's result says it took the message: one that took nothing is refused, as a force-stopped app takes none, from FCM either.

The SDK then does as it does for a message from Google: a data message goes to `onMessageReceived` wherever the app is, and starts the app when it is not running; a notification goes to `onMessageReceived` with its data when the app is in front, and else the SDK draws it under the app's name and icon, in its own channel, where a tap opens the app with the data, as [Firebase documents](https://firebase.google.com/docs/cloud-messaging/android/receive); a tap on one has not been tried, and `tapped` opens the app the same way. The answer says when the app is not allowed notifications, as the SDK then draws nothing. With no type, `push` and a window's Push pane name the route each type takes for the app named, read from its build; the listing goes through the allow list as a push does. With FCM set up, these pushes go by Google's servers instead.

What this leaves untried: Google's servers carry nothing, so their delivery, Doze's deferral, a TTL or a collapse across sends and a token's validity are not tried, and `from` reads `appdyno`, so an app that checks it against its sender ID turns the message down. An image goes by a link, which the SDK fetches. A data key that is FCM's own name, `from`, `notification`, `message_type`, `collapse_key` or one that starts with `google` or `gcm`, is refused, as FCM refuses it. Where the app has no Firebase Messaging, the only way a push reaches an Android app's code, each of these is refused and the answer says so; where it is a release build on a phone whose adbd is not root, each is refused with what takes it: a debuggable build, or FCM set up with `appdyno push setup fcm`. A style such as Android's inbox, messaging or media is no push of its own: an app draws it from what its code was handed, so `background`, with the data that code reads, is the push for it.

### Push to a phone and a simulator, by Apple and Google

What only Apple's or Google's servers deliver goes by them once a person has set up their credentials, at a terminal of this Mac: `appdyno push setup apns` asks for the team's APNs key, the `.p8` file, its key ID, the team ID, and whether a distribution build may take pushes from production; `appdyno push setup fcm` asks for a Firebase service account's JSON file. Each is kept in the state folder, `push/apns.json` or `push/fcm.json`, readable by this user alone (mode 0600, in a folder of mode 0700), and `--forget` deletes it. Nothing an MCP client sends sets, reads or deletes them: it is told only whether one is set. Neither command runs without a terminal, and neither says back a key, an id or a token.

With APNs set up, `push` sends a simulator's rich, background, Live Activity, VoIP and widget pushes, and each of these and an alert to an iPhone on its cable, by APNs, behind these:

- **Hosts.** `api.sandbox.push.apple.com` and `api.push.apple.com`, written in the code, and no other; a simulator takes only the sandbox's. A request goes by node's `http2`, with an ES256 provider token signed by node's `crypto`, kept 40 minutes, as Apple refuses one made more often than every 20 and one older than 60.
- **Token.** Only one this tool read from the app's own lines in this session, in the device's own log, or one a person typed in the window; nothing an MCP client sends is one. On a simulator the lines are `log show`'s, from the start of the session, of the app's process alone.
- **On an iPhone.** This tool reads no running app's log there, so a push that has no token relaunches the app with `devicectl device process launch --console`, its `os_log` and `NSLog` in that console as under Xcode, and reads what it prints for up to 15 s: only then, and the answer says the app was relaunched and lost its state. The console stays followed for the session, for a token printed later, and is let go by SIGKILL, which devicectl cannot hand on to the app as it does a signal it catches. Reading the phone's own log by its developer services would spare the relaunch, and is a later improvement.
- **What a token looks like.** A token is hex, 32 bytes or more, in a line that names a token where any line does, as an app's log has other hex as long, and the words of its line say which it is: a line naming a push to start, an activity, VoIP (or PushKit) or a widget gives that token, any other the device token. The app prints it with `NSLog` or `os_log`; a push with none says so, and how. A token Apple calls bad or no longer registered is dropped, and the next push reads the app's lines again. No answer, error or log says a token, a key or a provider token: a token is named by its kind and the time it was read.
- **App.** The topic is the app named, installed on that device, and the token is from that app. On an iPhone, the build's signature and Info.plist are read only from a build this tool installed, by `app install` or `app build_and_run`: nothing on the phone gives them.
- **Environment.** The sandbox, but for an app on an iPhone known to be a distribution build, by the signature of a build this tool installed, with production turned on at setup: then production. An app whose signing cannot be read here goes to the sandbox, never production, and a push refused on one host never goes to the other: on `BadDeviceToken` the answer says the token may be for the other environment, and what a person can do. A sandbox push reaches no production build, so nothing is lost by it.
- **Payload.** 4 KB at most, 5 for VoIP, with `aps` an object. Each type has APNs' push type, topic suffix and priority: `alert` and `rich` as `alert`, priority 10; `background` at 5; `live_activity` as `liveactivity` on `.push-type.liveactivity`; `voip` on `.voip`, only for an app known to declare VoIP; `widgets` on `.push-type.widgets`, from iOS 26. `apns-expiration` is 0: a push is delivered now or never. A Live Activity's payload is ActivityKit's: `event` start, update or end, `content-state` as the app's `ContentState`, and to start one `attributes-type`, `attributes` and an alert, with `timestamp` filled in when it is not given; start goes by the push-to-start token, update and end by the activity's.
- **Rate.** At most 10 a minute to a device, one push a call.
- **Answers.** Apple's reason, with words for a person: `BadDeviceToken`, `TopicDisallowed`, `ExpiredProviderToken` and each other Apple lists.

With FCM set up, `push` sends an Android device's alert, rich, background and Live Activity pushes by FCM: an alert and a rich push as a notification, with `image`, a background push and a Live Activity's as data alone, for the app's own code (a Live Update is the app's own notification, built from a data message), at high priority with a TTL of 0, so delivered now or never, unless the payload, FCM's own `message`, says otherwise. `tapped` stays as above. Behind the same kind of controls:

- **Host.** `fcm.googleapis.com`, written in the code, and no other: the service account signs its own RS256 token for FCM's audience, as Google's "service account authorization without OAuth" describes, so no token is fetched from another host. Whether FCM's HTTP v1 API takes such a token is unverified until a live send; if it does not, the token comes from Google's token endpoint instead, a second host written in the code.
- **Token.** A registration token the app printed in its own logcat in this session, of its process running now (by `getToken` or `onNewToken`), or one a person typed in the window; never one an MCP client sends. One FCM calls no longer valid is dropped, and the next push reads the app's log again.
- **App.** Installed on that device, and the payload names no token, topic or condition of its own: a message reaches the app on this device alone.
- **Payload.** 4 KB at most, its data strings alone; 10 a minute to a device; FCM's error codes in words, none naming a key or a token.

Requests to Apple and Google are tested against recorded ones, as each documents them, and the sending to Apple against a local HTTP/2 server; no test reaches either. No push has gone through Apple's or Google's servers in testing yet: that waits for a team's key, a project's account and a phone. What was run, and on which devices, is in [How the tools were tested](tools-tested.md#push-notifications).

`open_link` `links` with an app's id lists the links it opens, read from the installed app: on a simulator its URL schemes and the domains its signature names for universal links, on Android each filter that views a link, as `scheme://host/path`, and each App Link domain with Android's verification state. Its `data.links` holds the same, each with its `url`, its `kind` (`scheme`, `domain` or `filter`) and a domain's `state` where Android verifies it, for a client to offer or go through. An iPhone's installed app is not read.

`open_link` says `opened` only when no system alert stands over the screen the link left, which it reads once it has held still, up to 5 s, as an app a link starts goes on drawing after it is in front; an action waits 3 s. A simulator asks "Open in …?" before an app's scheme first opens it, and nothing opens until that is answered. A link in a scheme of the selected app's own is followed until that app is in front, up to 15 s, and its prompt is answered on the way when it is that prompt, one line that names that app, so that one call answers with the app's screen; any other prompt is left, and the answer then says `sent`, with the alert's words and buttons, and to answer it with `alert`. With `read: none` nothing is read, and it says `opened`. Every answer that reads the screen names a system alert over it so, an Android app's crash dialog ("keeps stopping") among them, with `alert` to answer it.

`open_link` `settings` opens Settings, an app of its own, where a person can go anywhere: under `--allow-apps` it opens it, at a page or at an app's, only when Settings' own id is in the list, `com.apple.Preferences` on iOS and `com.android.settings` on Android, and else refuses with `POLICY_DENIED`, saying how a person adds it. A link `url` that opens Settings is held to the same: iOS's `App-prefs:`, `prefs:`, `app-settings:` and `settings-navigation:`, and Android's `package:` and `android.settings.…:`. A page this device lacks is refused as a wrong word, with this device's pages.

## Radios, biometrics and the keychain

A radio is done when the device reads as asked, within 10 s: Wi-Fi by the state of the radio, because its setting changes first, and airplane mode and mobile data by the user's switch, so that a restore during airplane mode brings back what they chose. A device that does not change is refused with what it said. A device reached over its network (`adb connect`, wireless debugging) refuses `wifi off` and `airplane on`, because nothing could reach it to put them back. On an emulator, mobile data off or airplane mode on leaves the device no way to this Mac, and `restore` brings it back. A switch says nothing of a connection.

`biometric` on an emulator touches its sensor and is done only when the fingerprint service counted the touch: `match`, `nomatch`, each refused when no app is asking. On an emulator with no fingerprint `enroll` takes one by itself: it sets the screen lock to PIN 1234, written down first, goes through Settings' enrolment by its kinds of control and not their words (the PIN field, then the lowest and rightmost button), and touches the sensor until the service holds one. `restore` takes the PIN off, and Android deletes the fingerprints with it. An emulator with a lock of its own is refused, as its PIN cannot be typed, and so is a server started with `--no-home`, since Settings leaves the app. A real phone is refused: its sensor takes only a person's finger, and its lock is its owner's. A simulator's `enroll` turns Face ID or Touch ID on. An app's prompt on Android is the system's and holds the focus: it reads as elements like any screen, though a screenshot of it is blank, because it is a secure window.

On an iPhone `devicectl device simulate biometrics` answers `Device does not support any biometric simulation, nothing to do` and exits 0, so it is not used: an answer would say done for a touch that never happened.

`keychain` `reset` empties a simulator's keychain, and says how many items apps held, from the store's own rows, which also prove it empty after. The system's own rows stay and are not counted. It is one-shot: nothing brings them back.

## An iPhone's own conditions, data and permissions

`network` and `thermal` on an iPhone are the phone's own conditions, as Xcode's Devices window sets them, through its instruments: `network` `slow` is the first EDGE profile the phone lists, or a profile by name, and `full` none; `thermal` `fair`, `serious` or `critical`, and `nominal` none. One holds at a time. The phone keeps one after the process that set it is gone: a session killed by SIGKILL left `SlowNetworkEdgeBad` on, and the next session's start found it written down and turned it off. A thermal profile ramps for seconds each way, and the phone answers nothing meanwhile, so one is done when the phone reads it so. These go by the same private services of the phone as its live window, and where those cannot be reached they are refused, saying why.

`app clear` on an iPhone empties the app's data container, as `replace_data` with an empty folder does: development-signed apps only. iOS has no grant: `grant` and `revoke` reset the app's answer, so it asks again, and `alert` answers. `locale` with an app holds it in a language for every launch this tool makes, as on a simulator.

## A slow network

`network` `slow` on an emulator goes by its console: an EDGE speed both ways and a delay of 40 to 100 ms. A phone from Android 13 has only Android's own cap, `ingress_rate_limit_bytes_per_second`: `slow` caps what it downloads at 30 kB/s, an EDGE network's download, and a number caps it at that many bytes a second on a phone or an emulator. It adds no delay and leaves uploads at full speed, and the answer says so. The cap is a setting the device keeps, so the old one is written down and `restore` deletes it.

## A fold

`fold` on Android asks `cmd device_state` for the state of that name, `open`, `closed` or another the device lists such as `half_opened`, by its id there, which differs by device, and is done when the device is in it. The request holds until it is reset, whatever the hinge does and whatever becomes of this tool, so it is a condition: `restore` resets it, and `default (now open)` is no request. It is the same on an emulator and a phone, from API 31. It has not been run on a real foldable.

## Languages

`locale` on Android is an app's own from API 33, given the app or with one selected, by `cmd locale`. Below API 33, where apps have none, it is the whole device's, set by the agent as Settings sets it: Android keeps it in `persist.sys.locale`, so the old value is written down first and put back. A device that had never chosen one keeps the old language as chosen after.

On a simulator, with an app given or selected, `locale` holds that app in a language for every launch this tool makes, by `-AppleLanguages` and `-AppleLocale`, kept on this Mac: nothing changes on the simulator. With an app selected, what does not change is the system's own text, such as permission prompts and Settings, and a launch this tool does not make: an icon tap, a link or a push that starts the app, the app starting itself again. `app ""` sets the whole simulator, and the answer names which it took. An app that runs is started again in it, and again at `restore`. XCTest's launch measure is given the same arguments, which has not been checked. `launch_app` `language` is that launch's alone, on a simulator and an iPhone: the next launch is in the language held, else the system's. One app's language is held at a time: another is refused until `restore`.

## Putting a device back

Changing a condition writes the old value down first, with the process that changed it. It goes back
when that session ends, or with `device_setting` name `restore`, which leaves alone what another live
process changed and says so. A session that died leaves the file, and the next one on that device puts
back only what a dead process left, and says so; what cannot be put back is reported, and a file that
cannot be read is kept beside it as `.bad`. A command line is one process per command, so its changes
stay until `restore`, whatever sessions come and go. A change's answer says which of the two it is.

A recording, a network capture, an open report and a flow recording go the same way. The next session
ends what a dead process left and says so (a flow recording stops with its steps kept), leaves what a
live one runs, and leaves what a command line started for its next command.

## Sharing a device

A process that drives a device holds it: a file in the state directory with its pid and start time.
A dead owner's claim is free. A second process is refused with the owner's pid and name unless it asks
to share: `use_device` with `share: true`, `--share` on either command line, or `APPDYNO_SHARE=1`.
`list_devices` shows who holds what. There is no daemon. The process that puts back what an ended server left holds
the device as `appdyno put-back` while it does, and a session that starts meanwhile waits for it, up to 40 s, where it is refused at once by any other holder.

With no device selected and more than one this server may drive, a call that needs one is refused, naming each by serial, kind and model, and `use_device` picks one, by its serial or UDID, a simulator's or an AVD's name, or its model, the allow list matched against each; a device it may not drive is refused with the ones it may, by name. `list_devices` gives each device's `kind`: `phone`, `simulator` or `emulator`; an emulator has no `link`, as no cable joins it.

## Starting a simulator or emulator

`simulator` boots and shuts down simulators and emulators, on request only. With no name, shutdown
touches only what this tool started. `APPDYNO_EMULATOR_ARGS` replaces the emulator's default flags, and `APPDYNO_EMULATOR_FIRST_PORT` is where the search for a free port starts.

`--allow-devices` takes a simulator or emulator here by its id, its serial or its name, as `name` does, so one allowed for `shutdown` is allowed for the `boot` after it. A stopped emulator has no serial of its own: it answers to the one it ran as when this tool shut it down, and comes back on that port while it is free, as one the hub starts again comes back on the port it was last listed on, which its window waits on. A `shutdown` that the `boot` after it would refuse is refused first, and the device stays on.

A `shutdown` of the selected device ends the session on it and what its apps held in memory, and asks no one, as nothing the device keeps on its disk goes: its progress says so before it begins, and its answer once it is done. What the session changed goes back first, as at the session's end, while the device still answers: dark mode, text size, animations, the rotation a turn set and the rest, and the answer names each, or what could not go back. There is no reboot: a `shutdown` and a `boot` are two calls, as [SECURITY.md](../../SECURITY.md) has it.

With `--allow-devices`, `create` is off, and the hub's New Simulator with it, refused before anything is made: a new simulator's UDID is not known before it is made, so no list names it, and a server that made one only to refuse it left it behind. One made that does not start says how a person removes it, as nothing here deletes one.

## What an action answers

An action answers with the settled screen. `settled` means the screen was still for the window.
`changed` means the screen differs from before the action, in layout or text; it does not say the action
caused it. If nothing changed the answer says "no change seen in N ms; if a slow reaction is expected,
use wait_for". Every answer's `structuredContent` holds its whole text as `text`, beside the summary, as a client may show either part alone; what was done (`done`) is the text's first words and is said there only. A failed call is an `isError` answer whose text starts with its `code` and ends with its `hint`, both in `structuredContent` too, and a failed action says whether its touch went out (`dispatched`). An action reads a screen nobody has seen before it touches it, and on a locked phone it is refused with `DEVICE_LOCKED`. Cancelling a request
reaches the device, and long operations report progress. An answer warns that the app is not in front when it left by itself, not after a key, a Settings page, another app's launch or a stop that left it on purpose.

**A failed action says whether it touched anything.** Its answer ends "no touch was sent", "the touch was sent", or, for a device that stopped answering, "the touch may have been sent: read the screen before trying again", and a client has `dispatched`: `true`, `false` or `unknown`. A target that is not there and a refusal by the device come before any touch; a scroll that ran out of list swiped first. A read after an action can fail too, on a dark screen or a frozen app: the action had gone out, so that answer says it may have been sent, whatever else it says.

**A touch looks first.** Every action reads the screen unless a read was taken since the last action and under 20 s ago, as a phone locks itself about a minute after the last touch, and a blind swipe can open Spotlight from a lock screen. It costs a read only where there was none. A read that is refused leaves nothing to go on, so the next touch reads again. Within those 20 s a screen that locked while on is still touched; one that went dark is refused by the agent.

**A locked phone is refused with `DEVICE_LOCKED`**, reads and touches alike. On Android that is a keyguard that stays after a wake and a dismissal. An iPhone with no passcode gets past its lock screen with the home button: on a dark screen the first press only wakes it, with the lock screen still up, so it presses up to three times, and the app comes back. An iPhone with a passcode refuses the read, by `devicectl device info lockState`. What was run is in [How the tools were tested](tools-tested.md#a-locked-phone).

## Logs and crashes

`logs` reads logcat for the app on Android and the simulator log on a simulator. For an iPhone,
`devicectl` cannot read the log of a running app, and the answer says so. On a simulator, below `debug`, it reads the app's own lines, `NSLog`'s among them, and of Apple's frameworks only their errors, but for the thousand lines a simulator's keyboard logs as it draws; `debug` reads all of the app's process. What XCTest logs there is never read: appdyno's runner reads the screen and touches from inside the app. A message of several lines is one line of the answer, and `maxLines` never starts in the middle of one. `contains` keeps the lines that hold its words, whatever their case, matched after secrets are hidden. With no `since` it reads from when the last action began, as what a push or a tap sets off is logged while it runs. On Android it reads the app's process and the last one that died, by the pid exit info gives: a phone ends a crashed process at once, where an emulator's crash dialog holds it, and may start the app anew, so the crash's own lines are read after it. `crashes` collects the
system's crash records for the app (Android exit info and dropbox, the simulator's DiagnosticReports,
an iPhone's system crash logs) as a bounded summary and a file path. Every simulator's reports are in one folder, so a simulator's are only those that name it, by the app's path or by the coalition its process ran in, which a system app's has too; the note says how many were left out and why. Secrets are redacted. On Android it also counts every exit the system keeps, by its reason in full, because an app that left by itself or was killed did not crash: `SIGNALED status 9`, `USER REQUESTED KILL BACKGROUND`, `EXIT_SELF status 3`.

With `symbols`, it names the stack of a release build. On iOS that is a `.dSYM`, or a folder holding them such as the build's products, and an image is named with `atos` only from the dSYM whose UUID, by `dwarfdump`, is the crashed image's: any other would name the wrong functions and look right, so a report with none says which UUID it wanted and which the folder has. On Android it is a folder of libraries that keep their symbols, such as the `lib` folder of a build (`merged_native_libs/.../out/lib`, the ABI found from the tombstone), read by `ndk-stack` from the newest NDK in the SDK, which leaves a library of another build unread, and the answer says which ids differ. A tombstone comes a moment after the crash, and a Java crash has none. Android keeps few tombstones: on API 34, of an app's first 6 native crashes in a few minutes, one left a tombstone and the next none. The answer says so, and a loop of crashing runs will meet it. The whole stack is left in the file `named` gives. Optimized Swift may give a function with no line.

## Reaching a phone

- Android: turn on USB debugging, connect, and check `appdyno devices`. A Xiaomi asks on its screen before each new install over USB and
  says no by itself after 10 s: `app install` wakes the phone and taps that prompt's yes, but only during an install it started itself; the answer and `report`
  say so (`--no-install-consent` leaves it to you). Play Protect's prompt to send the app to Google is always answered no: a private build is not sent
  to Google. A Play Protect warning is left alone, quoted, unless the server runs with `--accept-install-warnings`. See [A phone's install prompts](protocol.md#a-phones-install-prompts)
  for what was seen on which phone. A Samsung with One UI has no prompt of its own, and Play Protect's come only with "Verify apps over USB" on. What else differs between the two is in [One UI against HyperOS](perf.md#one-ui-against-hyperos).
- iPhone: turn on developer mode. A phone needs a development signing identity and a provisioning profile that names it. An
  installed profile for a wildcard app id, with its identity in the unlocked login keychain, is found by itself. To choose another,
  set `APPDYNO_IOS_PROFILE=<profile.mobileprovision>`, `APPDYNO_IOS_KEYCHAIN=<keychain-db>` and
  `APPDYNO_IOS_KEYCHAIN_PASSWORD=<password>`. Run `appdyno doctor` to see what it found. The phone is
  reached over USB. Only a window goes by the network. A phone's clipboard goes by Xcode's `devicectl`, with no runner and nothing asked on the phone,
  and a simulator's is read from the Mac. Text goes in as keys on iOS: a paste brings up iOS's "Allow Paste" alert.
