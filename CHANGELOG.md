# Changelog

[Türkçe](CHANGELOG.tr.md)

## Unreleased

## 1.1.1

appdyno 1.1.1 keeps an iOS runner fast on a screen with a control drawn twice under something that moves, stops restarting a runner in a loop on such a screen, and lets a program read the screen's tree itself with `screen raw`.

### Changed

- `screen` takes `raw: true` and then also gives every element of the tree in its structured answer: its ref, type, words, rect, flags and its parent's index, for a program that drives the device through appdyno and needs the tree itself rather than the folded list a model reads. Its words are cleaned as the list's are, and a password field's text is left out.

### Fixed

- On an iOS simulator or an iPhone, a screen with a control drawn twice and something that moves elsewhere, as a turning banner over a grid of cells, no longer makes every read ask XCUI of each copy again: which copy a tap reaches is kept by the copies' places and what is over them, not by the whole screen's layout, and one read asks for at most half a second more of a few groups (always of one), leaving the rest to the next read. On such a screen a read took 25 s and more, past the 15 s a read has, and taps 15 to 27 s.
- A runner that answers a quick call with its own TIMEOUT, as one does when the call came too late to start, is not taken for stuck and restarted: only no answer at all is stuck.
- An iOS runner restarted as stuck twice in a row, with nothing answered between, is left running at the third: a screen that held every new runner as it held the last made a loop of them, a start and then 15 s of nothing, 13 times in one session. The timeout says the runner was left, and why.
- On an iPhone, a runner restarted as stuck is no longer first asked to shut down: the ask waits on the lane that is stuck, and each restart spent 6 s on it for nothing.
- On a simulator, a runner started in place of the helper says why the helper was not used when that was a refusal, a turned screen or no screen size: the reason was left empty, and a failed start ended its message with "after the simulator's helper did not answer: ".
- On Android, `webview` `pages` lists a page once: the system lists a web view's socket once more for each connection made to it, appdyno's own just-ended ones among them, and each was asked, so calls a few seconds apart listed one page 1, 2, 4, then 17 times, each slower than the last. Reading the pages no longer keeps its connection open once its port is gone.
- On Android, `app` `list` names an app with two launcher activities by its own, the first, which `launch_app` starts: Wikipedia's debug build was named "Leaks", the name of the activity LeakCanary adds.
- On Android, `open_link` `links` writes a wildcard host with its `*`, `https://*.wikipedia.org/wiki/*`, and each path as it matches: a glob as it is written, a prefix with one `*` after it and a suffix with one before. It printed `http://.wikipedia.org/wiki/*` and `/zh.**`, and left out a glob that holds a `}`.
- `report` `stop` with the flight recorder and a report both open ends both, and writes the report: it said only `flight recorder off, 0 kept`, and the report took a second `stop`.
- `logs` and `crashes` take `since` as how long ago, `30s`, `5m` or `2h`, as well as an ISO 8601 time: `since: "5m"` was refused.
- A selector's text reaches an element's whole words: it matched only the first 59 characters the list shows, so `find`, `tap`, `wait_for`, `assert`, `scroll_to` and flows missed a word further along a paragraph ("Nabataeans" in Wonderous's Petra history read `not found`, and `scroll_to` swiped past it six times). A cut label a flow kept still matches.
- Every ref `screen raw` gives is one `tap` takes: one the list leaves out, as a container, a navigation bar or a window, is tapped at its middle, where it was refused as stale. A nameless control inside a named one at its point, as Now in Android's check boxes, now has a ref too (11 of 77 had none). A flow records such a tap as what is at that point. A stale refusal always says what to do: its hint was empty.
- A screen's answer says a web link once, not again as its text (`tappable "Constantinople"` and `text "Constantinople"` at one point), a footnote as `[b]` alone, an element the app gives twice in one box once (NetNewsWire's scroll bar, an iPad alert's texts), and an alert's title once, at the title. A row named by the words inside it says a name that comes right after the same once: "Search Wikipedia Search Wikipedia Voice input search" reads "Search Wikipedia Voice input search", and "Headlines Headlines" reads "Headlines"; a value with no letter or of one character, as a score of 3 to 3, stays as it is.
- A `wait_for` that runs out names what it waited for, as one in `steps` does. A tap or `scroll_to` that found its text only as a part of a paragraph says so: `tap {"text":"Home"}` tapped "of over 15 million, it is home to 18% of the" with no word that nothing read "Home" alone.
- `appdyno screen --raw` prints the tree's elements after the screen, one JSON line each: it printed only the folded list.

## 1.1.0

appdyno 1.1.0 fixes what driving seven builds of five open-source apps showed, measures the scroll of an app that draws on its own surface, as a Flutter app does on Android, and adds a shop example to try an agent on.

### Changed

- The README starts with a quick start: one command, one ask, and a real answer.
- A shop example, [`docs/examples/shop`](docs/examples/shop/README.md): a small iOS app with a crash left in its checkout, the flow that finds it, and the one-line fix after which the flow passes. The README's first run and its quick start's answer are of it.
- The README shows appdyno on open-source apps: a run of Wikipedia's debug build, and what it measured of seven builds of five apps.
- A measured flow's scenario is named by the file's path in its repository, `journey-flows-login` for `flows/login.flow`, and no longer by its name alone. A baseline 1.0.0 kept under `journey-login` needs keeping again under the new name.
- The gate exits 1 for a scenario with neither a baseline nor a budget, which nothing judged: it passed, and a job that read only the exit code went green with no comparison made. A step put into a scenario that has a baseline still passes as `new`.
- On a Mac that is itself a virtual machine, as a CI runner is, a number says `host-load-unread` and is no longer marked `high-host-load` by a load average that says nothing of how busy the Mac is: a GitHub runner of 3 cores read 115 to 650 at rest, and refused every run as a baseline. `APPDYNO_HOST_VIRTUAL=0` reads it all the same. The example `perf-gate.yml` waits for no load there, keeps a failed step's screenshot and tree, measures the base again after a run that failed rather than ending the job on it, and measures the pull request seven times, as a step past its deadline keeps no time.
- The example `perf-gate.yml` has run as it is on GitHub's `macos-latest` runner: a pull request that changed no code passed, and one that made a step slower failed as a regression at that step.

### Fixed

- `assert` with `check: text` and `expect: false` fails when the element reads that text: it passed, as the text check left `expect` out.
- Two flows of one name in two folders, such as `login/smoke.flow` and `checkout/smoke.flow`, no longer share their failure's screenshot and tree, their JUnit case or their performance scenario.
- On a simulator, a touch right after a launch waits out the app's opening when the runner saw the app come to the front, as it already did when the helper saw it: on a runner's first start, as in CI, the touch went out during the opening and was lost, and the flow's next step failed.
- On an iPhone or a simulator, stopping an app no longer fails when the runner, just come up on a loaded Mac, does not answer the look at whether the app left the front: the app was stopped, and a CI runner's first `stop` failed on it after 15 s.
- A journey's step that never settled is counted, and its iteration's whole, at the tool's deadline, which it took at least: it kept no time, so a step slowed past the deadline left too few samples to call, and the answer said only that `journey.unsettled` had gone up. It is now a regression at that step, by name, and a window says such a journey as at least its time.
- A flow exported to Maestro YAML keeps a key's count: `press_key back count=3` is three presses, not one.
- On Android, an app with two launcher activities, as a debug build with LeakCanary has, starts: the system resolved them to its chooser, which `launch_app` started in the app's place and then took the app for dead, and `perf_launch` timed as a cold start of 0 ms. The first of the app's own is started, as its manifest names it.
- `perf_launch` keeps and judges only the starts the system timed as the asked state: a start it called `UNKNOWN`, at 0 ms, or `WARM` in a cold series went into the run's numbers and its longest start, though not into its median.
- A touch on a web link that wraps over two lines lands on its first line's end: the middle of its box is the text between the lines, so the touch was said to land and opened nothing.
- A selector that matches a web link and its own text, which take the same box, is one target, the link: it was refused as matching two.
- `perf_scroll` reads the rounds of an app that draws on its own surface, as a Flutter app does on Android, from that surface, read every 500 ms over each round, and keeps `surface.p95_ms` and the two shares of each, as `perf_snapshot` does: it said no threshold was exceeded of a scroll it counted no frames of. With neither, it says it judged nothing.
- `perf_scroll` on a list already at its end brings it back for the first round too, as it did for later ones: it was refused as a screen covered by a popup.
- A memory read the system answered without the app's total, seen once while the app was not responding, is a `TIMEOUT` to ask again, with what the system said: it was a bare error with no code.
- On the command line, `--ref` takes a ref typed without its `@`, and a flag that takes a list takes its words as they are, `--also surface,battery`, as much as their JSON.
- An iOS runner whose start runs out of time says that it did not start, after how long, and how far it got: it said the runner had stopped, `xcodebuild exit null`, as the kill that ended it came first. A start that has got on to launching the runner has 90 s more from then: one killed there was started again from nothing. How far a start got is read from the runner's own first line: xcodebuild's first, where it writes its results, read as the runner launching.
- On a simulator whose helper does not answer, the progress says the runner starts in its place, and a runner that does not start either says the helper had not answered.
- A command on the command line no longer starts a simulator's runner behind its answer, which it then waited for before it ended, up to two minutes: the runner starts for what needs it, and stays for the next command.
- `perf_scroll` says when the profile it takes of high jank failed or named no function, and says that it is taking one: an iOS profile ran three minutes, and its answer named nothing and said nothing.
- `crashes` on iOS keeps the crashes of the app's own extensions, a widget among them, and names which: it kept only the app's own.
- On iOS, an element of a web page has the focus only where it is a field: every one said `focused`.
- On Android, a screenshot the system gives no picture of is asked for once more, and one still missing is said as that: it was said to be of a window marked secure, of a home screen whose next try had it.
- `alert` with an answer and no system alert open says that no button was touched.
- A nameless control inside a named one at the same point, as the icon of a button, is not listed beside it: `button ""` stood next to the button it is part of.
- A ref not on the screen is waited for a moment, as a selector is, before it is called stale, and the refusal says the words it had and what is nearest in their place: a read on a loaded device, of an app not responding, came back without a ref the screen had just listed, twice.
- An iOS runner start that failed ends the runner app its xcodebuild was launching: it stayed running in the simulator.
- `scroll_to` whose swipes brought no new rows into view says the list may be at its end that way, and to try the other: at a list's top, a pull to refresh moved the rows, and the answer said the list could still move and to raise `maxSwipes`.
- On an iOS simulator, a tap's answer waits until a push has taken the old page away: at load 17 a SwiftUI push answered with the old page's elements still there, a third of the screen aside, beside the new page's.
- An action whose app dies under it says so, with the crash report and the app's last log lines, also where the device's own read after the touch fails first: on an iOS simulator whose runner had just started, it said only that the screen could not be read, as the runner lost the app. A death whose report the system has not written yet, which took up to a minute on a loaded Mac, says so, and that `crashes` reads it once it is there.
- A function's name from an iOS profile reads as it is: a C++ name read `__func&amp;lt;`, and the app's own names kept their escapes.
- On Android, an agent restarted as stuck says when the system is asking about an app that is not responding: a touch on that app had held the agent up, and the answer said only that it was stuck.
- `perf_snapshot` says its janky share is of frames late for their deadline, as the system counts them, beside Play's share of frames over 16 ms, and leaves out a CPU pressure, a thermal state or a graphics memory the device did not give: it showed `?` and `0.0 MB`.

## 1.0.0

appdyno 1.0.0 is the first public release: an MCP server, a command line and a Mac app that drive, test and measure iOS and Android apps on simulators, emulators and real phones. Each of its 48 tools is also a command and a call in the library; coming from 0.6.0, read Changed first.

### Added

- The Mac app, `Appdyno.app`, from a disk image or a Homebrew cask, signed and notarized: it carries its own Node, the Android agent, the device viewer and Perfetto's trace processor, lives in the menu bar, and looks for a newer release when it opens and once a day, which it installs only when you say so. Google's terms keep adb out of it, and `appdyno tools install adb --accept-license` fetches it.
- `appdyno install` adds the server to the MCP clients on this Mac, changing only its own entry after a backup, with `--dry-run` to see the change and `--remove` to take it out. `appdyno path` puts the app's command on every shell's PATH.
- `appdyno update` moves to the latest release only once it is verified, by npm's provenance for the package and a signed appcast for the app, and `--check` changes nothing. `appdyno doctor` says the version and how it was installed.
- `appdyno mcp --http 127.0.0.1:PORT` serves the same tools over Streamable HTTP, for a client that cannot start a program on this Mac: on this Mac's loopback alone, behind a token, to one client at a time.
- `appdyno hub` shows every device of this Mac in one window, to start, stop, create and watch, with Connect a Phone, which takes a phone from its cable to ready, a page that adds and tests each MCP client, Tools and Help, in English and Turkish.
- `appdyno mirror` opens a live window of a simulator, an emulator, an Android phone or an iPhone on iOS 27 by USB, driven by mouse, trackpad and keyboard while an MCP client drives the same device. `appdyno pair` lets a window reach a phone by Wi-Fi.
- A window's Inspector has ten panes, Performance, Flows, Apps, Activity, Logs, Network, Accessibility, Device, Links and Push, which do by hand what the tools do, live numbers and launch and scroll measures among them.
- **Record Flow** writes what a person does in a window as a flow, by selector, with a password kept as a secret's name. **Show Beside This One**, or `appdyno mirror` with two `--device` and `--pair`, puts two devices side by side, and a touch goes to both.
- The `mirror` tool opens and closes a window from a client, and `hand_off` asks the person to do what a tool cannot, such as Face ID, and waits. `--silent` keeps it quiet, for CI and a shared Mac.
- `push` sends an app a push notification of seven types: by `simctl` on a simulator, by FCM's own message on Android with no Firebase project, and by APNs or FCM once a person has stored its credentials with `appdyno push setup`.
- `open_link` `settings` opens Settings at a named page, and `links` lists the schemes and domains an installed app opens.
- `press_key` takes `control_center`, `notification_center`, `spotlight`, `escape`, `space`, the arrows, `mute` and `siri`, a letter or digit with keys held, as `command+a`, and a `count`.
- `screenshot` saves a `file` and sizes its image by `points` or `width`, and with `watchMs` says in words what moved on the screen. `assert` `check: moves` holds something to moving.
- A screen whose tree has no words, such as a game or a canvas, is read from its picture by the Mac's own text recognition, and `find`, `tap`, `wait_for` and `assert` take what it reads.
- `swipe` `exact` moves the content by its `distance` and stops, `gesture` `drag` takes `holdMs` to press before it moves, and `set_location` `clear` ends a fixed location.
- `simulator` `create` makes and boots a new iOS simulator. `app` installs an `.ipa`, builds and runs a project with `build_and_run`, and copies an app's data out and back with `download_data` and `replace_data`.
- `device_setting` takes `increase_contrast`, `reduce_transparency`, `airplane`, `wifi`, `mobile_data`, `thermal` and `keychain`. On Android it slows a phone's network too, folds a device from API 31, sets a language below API 33 and enrolls a fingerprint on an emulator.
- `list_devices` says what blocks each device and how to fix it, and `use_device` takes a device by its serial, a simulator's or an AVD's name, or its model.
- On an iPhone, `clipboard` works with no runner, and `inspector` lists and presses what is on the screen with no signing identity.
- `crashes` `symbols` names a release build's stack, from its dSYM on iOS and its libraries with symbols on Android.
- `appdyno perf why`, or `perf_compare` `action: why`, finds the likeliest cause of a regression with what shows it: a function, a phase of a start, a frame's cause or a hang. `perf reference`, `perf functions` and `perf comment` go with it.
- A journey is measured and gated: `appdyno test --measure`, or `flow` `run` with `iterations`, keeps each step's numbers, and `perf compare` names the step that got slower. `perf_launch` `baseline` keeps a baseline in one call, and `perf_compare` `budget` sets a budget.
- On Android, `perf_snapshot` `also` reads `surface`, `startInfo`, `anonMemory` and `battery`, numbers are set against Google Play's definitions, `perf_trace` says why slow frames were slow, and `perf_launch` `baselineProfile` measures a Baseline Profile.
- On an iPhone, a window's numbers come each second with no runner, and `perf_trace` `what: hangs` says whether each hang was busy or blocked and in which function, which `dsym` names.
- Kept traces stay under a limit, 10 GB by default (`--trace-limit-gb`), and `appdyno perf prune` lists what goes. Perfetto's trace processor, pinned and checked, is fetched the first time an Android trace needs it.
- `report` `timeline` (`appdyno timeline`) puts a journey's video, touches, steps, frames, requests, log and memory on one clock, in one HTML file to send. `report` `flight` (`appdyno flight`), once turned on, keeps an app's last 30 s and saves them on a crash or a stall.
- Flows take parameters as `${NAME}`, run another flow with `run` and carry tags, and `appdyno test` takes `--tag`, `--env-file` and `--retries`, which reports a file that passed on a retry as flaky. `flow` `export` `to` writes Maestro YAML to a file.

### Changed

- `app` has no `launch`: `launch_app` takes `restart`, `args` and `env` and starts the app fresh with them, takes an app by its name as well as its id, and says whether it started the app or brought it to the front.
- `find`, `wait_for` and `assert` take their target in `selector`, as every touch does. A selector's words at the top of a tool or a step are refused, with the call in that shape in the hint.
- On iOS the on-screen keyboard is one element, `@keyboard keyboard`, as on Android, and a touch on it is refused. `type_text` with no target, where nothing has the focus, is refused with `NO_FOCUS`.
- Every answer's `structuredContent` holds its whole text as `text`, and leaves `done` out where the text holds it. A refusal's text starts with its code and ends with its hint.
- `press_key` reads a key's name whatever its case, `return` as `enter`, and a letter in a shortcut is a small one.
- `logs` takes `contains`, reads from when the last action began where no `since` is given, and on a simulator keeps to the app's own lines and the errors of Apple's frameworks.
- Protocol 2: the host checks every request against its schema before it reaches a device, a dark screen is `SCREEN_OFF`, `device_info` lists no capabilities, and a runner or agent of another version is refused at its first answer.
- `push` is a tool of its own, out of `device_setting`, and takes `alert`, `background`, `rich`, `live_activity`, `tapped`, `voip` and `widgets`.
- `set_orientation` takes `landscape_left`, `landscape_right` and `upside_down` where it took `landscape`, and answers once the screen has turned.
- `device_setting` says `changed` only when the device reads otherwise after the change, `dark_mode` reads `on` or `off`, and `text_size` on iOS takes iOS's own named sizes.
- `locale` on a simulator, with an app given or selected, holds that app in the language and leaves the simulator alone, which `app ""` sets whole. `launch_app` `language` on iOS is for that launch alone.
- `appdyno mcp` is the one way to start the server, as `appdyno-mcp` is gone, `bench` takes no `--driver`, and the library exports one function, `connect`.
- A client's calls that act run one at a time, in the order they came, and say `waiting its turn` while they wait; calls that only read run beside them.
- A `wait_for` that runs out is refused with `TIMEOUT`, and an `alert` with no alert with `NOT_FOUND`, so on the command line both exit 1.
- The performance gate fails on `noisy`, `few-samples` and `refused` as on a regression, and `perf baseline` exits 1 until it holds the 3 runs a comparison needs.
- Several numbers are measured anew, so take a baseline kept with 0.6.0 again: exit counts are per run, every percentile has one definition, a step that never settled keeps no time, and an iOS step leaves out the runner's wait for an alert.
- `perf_scroll` reads one round, and three under a `scenario`. `perf_profile` and `perf_compare` are no longer marked read-only, as either can swipe or restart the app.
- The command line keeps its selected device per working directory, a condition it changes stays until `restore`, and downloaded tools are kept in `~/Library/Caches/appdyno/tools`.

### Fixed

- An answer no longer claims what did not happen: typing whose field reads back other text presses no Enter and says `submitted: false`, and a touch that may have gone out is answered `TIMEOUT` or `dispatched: "unknown"` and never made twice.
- An action whose app dies under it is refused at once with `APP_NOT_RUNNING`, the crash report's reason and the app's last log lines, in `steps` and flows too, and behind Android's crash dialog as well.
- The settle no longer calls a screen still while it slides slowly or while an alert comes up late, nor busy for a progress bar that stands still.
- A call that is stopped or times out stops on the device: no stroke, key or typing goes out after it, on Android, a simulator or an iPhone.
- Conditions go back as they were, Android's text size, language, dark mode, contrast, rotation lock and Wi-Fi among them, also when a client kills the server, and `simulator` `shutdown` puts them back first.
- A simulator's first tap no longer waits for its runner to start, and `launch_app`, `open_link`, `type_text` and `list_devices` answer sooner.
- `logs` reads what a crashed Android app wrote as it died, `crashes` reads Android's exits by the device's own clock and a simulator's reports of that simulator alone, and the Android agent clears what its old builds and recordings left on the device.
- Xcode's tools leave nothing behind: no `DTServiceHub` after a runner or a recording, no `instruments*.ktrace` in the temp folder, no runner build of older sources, and no simulator booted again after a person shut it down.
- `scroll_to` no longer runs past its row on a simulator, and `perf_scroll` goes on into new rows while a list moves, where a round past its end read as smooth.
- Measures read true on more devices: a Xiaomi with HyperOS has its frames counted once, and an iPhone's CPU share is its instrument's own.
- On a Samsung a tap on plain text no longer waits out its 3 s, and the edge panel is no longer taken for an alert.
- Android 17 is driven as earlier versions are: a finger a killed agent left down no longer blocks every touch, and its credential prompt reads as a passcode.

### Security

- An input on the system's power, emergency or erase controls asks the person first, from any tool, `steps` or a replayed flow: Android's power menu, iOS's power-off screen and Control Center in any language, Settings' resets, and a third press of the power key in 5 s. Only `--allow-power virtual|all` lets these go ahead unasked, not `--allow-data-loss`.
- Placing a call asks too: a `tel:`, `telprompt:`, `facetime:` or `facetime-audio:` link, a touch, key or text in a phone app or Android's own default dialer, and a button of iOS's call prompt, shown as an alert or as a sheet.
- The guard reads the screen again after an input that may have changed it or failed on its way, and after another client's input to the same device, and sends nothing it cannot judge. An iPhone's `inspector` `press` passes it too: each press asks, and under `--allow-apps` or `--no-home` it is refused.
- What loses data asks the person first, by the client's own prompt: `app uninstall`, `clear`, `replace_data` and `revoke`, `grant` on an iPhone, and `device_setting` `keychain`. A no does nothing, and the answer never says a person declined, as a client may answer by itself.
- Where the client cannot ask, and always over `--http`, these are refused unless the person started the server with `--allow-data-loss` or `--allow-power`. The command line asks on its terminal or takes `--yes`, which no MCP refusal names.
- `--allow-apps` holds every input, not only a tool's arguments: a touch, key or text that would land outside an allowed app is refused, and `open_link` and `app install` reach only an allowed app, Settings only with its id in the list.
- `--no-home` holds Settings by any route, `open_link`, a link to it, `launch_app` and a `perf_` measure among them. An allow list given empty, or one that matches empty text, is refused at the start, and `simulator` `create` is off under `--allow-devices`.
- Logs, requests and console lines hide more credentials, a token in a query, an `Authorization` or `Cookie` header whole, a JWT and a password in a link among them.
- What is typed on an iPhone or a simulator stays in no file: XCTest's result bundles held each key, so delete the old ones, `~/Library/Developer/Xcode/DerivedData/temporary-*`.
- `react_native` calls Metro on this Mac alone, `webview` opens a page's socket only on the DevTools port it asked, and neither follows a redirect.
- `flow run` on a server takes no value from the server's environment, `flow save` and `flow export` write only in the server's folder or its state folder, and a kept run's `compile` reaches a device only as `speed`, `speed-profile` or `verify`.
- A window passes nothing to a device until a person clicks in it.
- Report a vulnerability privately, as [SECURITY.md](SECURITY.md) says.

## 0.6.0

The first version run on all four kinds of device together: an emulator, a simulator, an Android phone and an iPhone.

Found when the parallel branches ran together:

- Neither fixture built: two branches had each added a network screen. One screen now, on each.
- `moving` read true in every answer with animations off, as the system's answer was merely not back yet.
- `--animations off` and `device_setting animations` could restore over each other: only one holds the scales' old value at a time. With `reduce_motion` as well, the newest is put back first.
- `perf_snapshot` `also: energy` on Android no longer resets the battery history: a window is what the count since the last charge grew by.
- iPhone: dark mode and reduce motion read empty or as an object, so a restore put back nothing; `crashes` always refused, as `devicectl` stops copying the folder at a file it cannot take (`19:24.spindump.txt`), and reports now copy one by one.
- iPhone: a signing profile that cannot be read says so, not an internal error; `record` says this phone has no recording capability and what to do.
- A locked simulator is opened by its lock state: a read under the lock held the runner up for 15 s.
- With an app selected and another in front, the answer shows what is in front, not 0 elements.
- The Xiaomi's lost first touch, found: its screen goes off by itself after 60 s, and once woken the app reads as on the screen before it can take a touch (6 of 14 touches lost, up to 1.5 s after the wake). The host now waits for the focus to hold (0 of 15), and the agent refuses a touch on a dark screen so that the host wakes it first. A long measure wakes the phone too: a dark one starts no app, and `am start` reads `UNKNOWN (0)`.
- A simulator's clipboard is set from the Mac: the runner's own call at times held it up for 15 s.
- Energy reads Android 16's row, whose parts follow on the next line.
- A packet trace with nothing in it says so, not "0 of 0": on a Xiaomi with Android 16 the source records nothing for any app.
- A web page's element that the tree has by id is not listed again as missing from it.
- `app install` wakes the phone, and names HyperOS's on-screen question when no one answered it.
- `app install` answers the phone's prompts by itself during the install it started, and says so in its answer and in `report`: yes to a Xiaomi's USB install prompt, for the app in the file and with its remember box left alone, and no to Play Protect's prompt to send the app to Google, always. A Play Protect warning is left alone and quoted, unless the server runs with `--accept-install-warnings`. `--no-install-consent` turns it all off. Earlier taps on that prompt were lost because it slides up with its buttons already read at their last place: a touch took nothing, or fell above the dialog, which cancels the install. A screen timing out as it opened lost it too. A prompt still open from an earlier call refuses the next install, as a touch on it would answer that earlier one.
- A pulled recording waits in the state folder, not beside the video.
- Answers: a control and its own text with the same words are one target; a launch or a found scroll carries no "no change seen"; refusals have no filler and no wire method's name; keys typed with no keyboard on iOS are refused as on Android.

- Evidence and reach, with no new dependency. Each answer says what a device cannot do and why.
- `record`: screen video on Android (segments of `screenrecord`, joined with no dependency), simulators (`simctl`) and iPhones (`devicectl`, not yet run on one). It outlives its process, one per device. `stop` reads the file: one that does not play is a refusal.
- `report`: a folder with `index.html`: steps, the screen and an image after each, video, logs, crashes, measurements. Secrets hidden, images painted over where an element holds one, nothing loaded from the network.
- `network`: a bounded list of an app's traffic, through a proxy you run (`http_proxy` on Android, put back; the Mac's on a simulator; read from Proxyman's export or a HAR file), an injected `NSURLProtocol` on a simulator, `dumpsys netstats` and Perfetto's packets on Android. `paths` says what each sees, and no certificate is installed.
- `webview`: pages, the DOM as elements, click and scripts, through DevTools on Android and Safari's inspector socket on a simulator. `screen` marks a web view's elements as `web` and adds what the accessibility tree does not hold.
- `react_native`: targets, the JS console and reload, through Metro. Flutter's Dart VM service is not built: no SDK here to test it on; see the README.
- `visual`: a baseline, a comparison with a tolerance and masks, a diff image. The PNG decoder moves to `core`, with an encoder.
- `device_setting`: `proxy`, `battery` (put back), `fold`, `call`, `sms`.
- The catalog leaves out what says nothing to a client: each tool's schema URL and task setting, and length limits, which the server still enforces. 42 tools, 24,814 characters.
- A device's refusals are async: a phone's `push`, `biometric`, `clear` and `grant` reached a client as an internal error.
- An op with `action` takes it as its first word on the command line: `appdyno record stop`.

- Flows. `flow` records what a session does to a readable file (`start`, `stop`, `save`), replays it with no model (`run`, `--from`, `--param`) and exports it to Maestro YAML, refusing what has no form there. `appdyno test` runs flows on each `--device` in turn: JUnit, a failure's screenshot and tree, exit code 1. A miss or several matches stop the run with the nearest candidates, the step and the file's line; nothing is guessed. Passwords and `APPDYNO_SECRETS` become named parameters and are in no file. New package `flows`. `flowsFor(ctx).replay` takes `onStep`, for measuring each step.
- `scroll_to` answers once the list has stopped: on a simulator a tap right after it was often lost, as the settle does not see a list coasting and UIKit takes a touch on one as "stop". Measured: 3 of 6 lost before.
- `ActionOut.settleMs`: from the action to the settled screen, as the device timed it.
- The nearest elements of a refusal are also judged by their ids, so a mistyped id finds its neighbour.

- Driving. Every action takes a ref, coordinates or a selector; `steps` runs across screens with `wait_for`,
  `assert` and `scroll_to`; `scroll_to`, `assert`, `gesture` (double tap, long press, drag, pinch, free plan), `keyboard`,
  `alert` (any system alert), hardware buttons in `press_key`, `app`, `simulator`, `device_setting`, `clipboard`.
- Device claims for parallel agents, with no daemon. Conditions the tool changed are put back.
- Protocol 1.3: the agent's `wait`.
- `long_press` and `pinch` are now kinds of `gesture`, `dismiss_alert` is `alert`, `set_clipboard` is `clipboard`.

- Performance: `packages/perf` keeps every measure with its context; baselines and budgets under `.appdyno/perf/`; `perf_compare` and `appdyno perf compare|baseline|budget` as a gate; `perf_query` on a kept trace; Android launch by state with compile control and a start trace, frame stats, threads, network, energy, exits, size and heap profiles; an opt-in frame probe on iOS simulators; hitches, hangs and launch on an iPhone on an app of our own. `docs/perf.md` has what works where.
- Docs: a README for new users, CONTRIBUTING, SECURITY and a CI workflow (lint, typecheck, unit tests, agent unit tests).
- iOS simulators take their touches and answer their reads directly: `SimHID` (the simulator's `dtuhidd`, from the Mac) and `SimAX` (accessibility snapshots, inside it), compiled on first use, checked against the runner, which answers whatever they refuse. `docs/protocol.md`, `docs/perf.md`. `appdyno doctor --serial <simulator>` reports them; `APPDYNO_SIM_DIRECT=off|read`.
- Two-finger gestures on simulators.
- The runner's `hello` and `visible` flag no longer take `UIScreen`'s 320 x 480 for the screen: everything below that line was marked not visible.
- `launch` brings a running app forward as it is, on a simulator and a phone; terminate it first for a fresh start.
- iPhone signing found by itself: a development profile naming the phone with a wildcard app id, its identity in the unlocked login keychain. `APPDYNO_IOS_PROFILE` still wins; a keychain and password are optional; `APPDYNO_IOS_TEAM` lets Xcode provision the runner.
- iPhone measures: memory and CPU (Activity Monitor), CPU profile and hangs (Time Profiler), launch time. `perf_profile` on simulators uses the Time Profiler: `sample` sees no busy samples of a simulator app under macOS 27. `xctrace` recordings wait for the tool's own "started" notification and their stop is bounded.
- Hitches on a phone answer UNSUPPORTED when the trace has no frames, never "no hitches" (Xcode 27.1 on iOS 27.0.1).
- `Device.virtual`: an iPhone is no longer called a virtual device.
- A starting runner says where it has got to on stderr.

- Android settle: reads only when one can decide something (none between two screens or before a transition's new window, as WMS tells it; an event brings the next one forward), and on API 34+ an answer during a window's slide with every place and visibility as they will be at rest (`settle.moving`); the next action or screenshot waits for the slide's end. See `docs/protocol.md` "Settle".
- An action or a read answered between two screens no longer says "0 elements": it waits for the next screen, else fails with `NOT_FOUND`.
- Compose `testTag` is the id of a node with no resource id, from its extras: no app change needed.
- `--animations off` (`APPDYNO_ANIMATIONS=off`): the device's animation scales are off for the session, back when the last host leaves or by a watcher process if the agent dies; on for performance measurements; `doctor --serial` warns if left off.
- Packages by module (`core`, `driver-android`, `driver-apple`, `ops`, `mcp`, `cli`, `appdyno`), the import rules enforced by a test. Commands: `appdyno` (with `appdyno mcp`) and `appdyno-mcp`.
- One definition per operation: every MCP tool is also a command (`appdyno screen`, `appdyno long-press --x 1 --y 2`, `--json`, `--out`).
- Device ports and measure sources: a device without a measure says which one it lacks. `perf_snapshot` answers `memoryKb` and `memoryKind` instead of `pssKb` and `footprintKb`.
- A device failing at open reaches the client with its cause and hint, not as an internal error.
- The iOS runner reads its port and token again (`TEST_RUNNER_APPDYNO_*`).
- `screen.window` is known in landscape with the navigation bar on the left, so swipes there use the real screen.
- Accessibility audit (`device.audit()`): the iOS platform audit through the runner (`audit`), and on
  Android the host's checks of a tree, a screenshot and the characters each text does not show
  (`a11y.read`, which also brings the nodes' traversal hints): touch targets, text and icon contrast, names, duplicate names, clipped text.
- Android tree flags: not important for accessibility, and read as one unit by a screen reader.
- A simulator opens, reads and takes touches with no runner: it starts for a system alert, text entry, an image, an audit or a control found at different places.
- A first `launch_app` starts the app alongside the agent or helper. `am start`'s `Status: timeout` is no failure: at load 500 an app still drawing was refused as not started.
- A ref is touched where the screen has it just then, not where the last answer did: an app can move things with no action.
- An answer's image is 800 px at quality 60, and an answer says a row once when a control of its name stands at its place.
- A new Android agent waits out one that was killed, which the system keeps as UI automation's holder for about 2 s: a start in that moment was refused with `AGENT_CONFLICT`.

Still open:

- `simctl pbcopy` writes nothing on Xcode 27.1, even on a new simulator, so a simulator's clipboard depends on the runner, whose call can stall on a loaded Mac: `clipboard` then refuses and says so.
- The gate on a Xiaomi takes no baseline: its device load stays over the limit of 8.
- `network` `packets` records nothing on a Xiaomi with Android 16; why was not looked into. The answer says so.
- `record` on an iPhone 13 Pro Max with iOS 27.0.1: `devicectl` has no such capability. It has not been seen working on any phone.
- HyperOS's install prompt needs a person: see "Reaching a phone".

## 0.5.0

- Packaging: `scripts/install.sh` installs the MCP server and the `appdyno` command from this
  checkout; the package carries the prebuilt Android agent and the iOS runner's sources (built once on
  first use where no build is). One version for every part, checked by a test.
- `appdyno doctor`: Android SDK and adb, Xcode, the runner builds, the iPhone signing, and the
  devices that are connected (adb, booted simulators, iPhones over USB).
- iOS: a system alert or sheet that came up during a settle counts as busy while it animates in; with
  that, the tap through XCTest's event synthesizer is the default (about half the time of XCUI's tap on
  a phone; `APPDYNO_FAST_TAP=0` turns it off).
- The iOS runner shows as "appdyno" with its icon on the simulator and the phone.
- The adb client starts the adb server again after every outage (another tool's `adb kill-server`
  between calls is harmless).

## 0.4.0 — real iPhone

- The runner on an iPhone over USB: re-signed for a development profile (bundle ids from the profile,
  the identity from a keychain that is only unlocked), installed when the phone has another build under
  that id, started by xcodebuild, reached through the Mac's USB multiplexer.
- Apps and links on the phone through devicectl; text as keys (the runner cannot reach the clipboard
  there).
- Animation hitches on the phone through Xcode's trace tool; a memory graph with its leaks on the
  simulator; MCP's perf_trace and perf_heap answer on iOS.

## 0.3.0 — iOS simulator

- The runner: a UI test serving the protocol on a loopback port; public snapshots with XCUI's idle
  waits off (one shim, public fallback); paste-first typing; settle from reads alone.
- Simulator perf from the Mac: memory, CPU, launch, CPU profile (the app's own functions ranked by busy
  time).
- MCP: simulators listed and driven by id.

## 0.2.0 — Android, hardened

- Settle: a tap on something that cannot react settles after 80 ms; the window stretches on a loaded
  device (slow reads, late wake-ups); stillness is proven only up to a read's start.
- Perf tools with accuracy tests: frames, frame timeline, memory, CPU, launch, CPU profile, heap dump.
- Output schemas and annotations on every tool; local CI with a latency history and regression gate.
- Real Android phones: injection permission, typing, mock location (gps, network, fused), reconnect,
  screen off and keyguard.

## 0.1.0 — Android emulator

- The on-device agent (shell user, UI automation), the wire protocol, the host library and the MCP
  server with act-and-read answers and a local policy.
