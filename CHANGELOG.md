# Changelog

## Unreleased

- **Links** offers what the app in its field opens, as `open_link` `links` lists it: schemes, domains and Android's filters, a domain with its state.
- A recording writes no step for `open_link` `links`, which reads what an app opens and opens nothing: it wrote an empty `open_link`.
- **Links** in a window names the app to open a link in, the app in front first, through the server's list of apps: an iPhone opens a link only in a named app, and its window could not open one. Run on an iPhone 13 Pro Max with iOS 27.2 and a Samsung Galaxy A52 with Android 14.
- A window's Inspector has **Push**: a push to an app by `push`, as an agent sends one, from **Send Push…** (⇧⌘P), the File menu or More. The types are the op's for the device, one it does not take shown with why; the fields follow the type, or the op's template is edited as the payload. Run on an iPhone 17 Pro simulator with iOS 27.2 and an API 34 emulator.
- `open_link` no longer says it opened a link the system asks about first: a simulator asks "Open in …?" before an app's scheme first opens it, and nothing opens until that is answered. The answer says `sent`, with the alert's words and buttons, and to answer it with `alert`; a window's Links pane says the same. Run on an iPhone 17 Pro simulator with iOS 27.2, just erased.
- A window's Inspector has **Links**: a link typed there, of any scheme, goes to the device by `open_link`, as an agent's does, from **Open Link…** (⌘O), the File menu or More. Its answer comes as it goes, a refusal whole with its hint, and the links opened stay for the device. A person's own link no longer reads as an AI client driving. Run on an iPhone 17 Pro simulator with iOS 27.2 and an API 34 emulator.
- What loses data asks the person first: `app uninstall`, `app clear`, `app replace_data`, `app revoke`, `app grant` on an iPhone, where it resets the permission to ask, and `device_setting keychain`, by the client's prompt (MCP elicitation), naming the device, the app and what goes, and a no does nothing. A client that cannot ask, and any over `--http`, is refused unless the server runs with `--allow-data-loss virtual` or `all`; a command asks on its terminal or takes `--yes`. Run over stdio on a simulator with the fixture. A test fails if any source gains a reboot, an erase, a factory reset, or a deletion of a simulator it did not make.
- Push notifications have a tool of their own, `push`, and leave `device_setting`. It takes a type (alert, rich, background, tapped, live_activity, and Android's inbox, messaging and media), fields or the platform's own payload, and answers with the screen after. With no type it lists what this device takes, by which route, with which fields, and the payload it would send. A simulator's alert reaches the app's code when the app is in front, and the answer says when it is only shown, with the app in the background or not running, or allowed no notifications; a rich push is refused, as `simctl push` runs no Notification Service Extension, and so is a Live Activity's, which it cannot make; Android's styles are drawn by the shell, and `tapped` opens the app as a tapped push does, with its data as extras. What only Apple's or Google's servers deliver is refused with why. Run over MCP on an API 34 emulator and an iOS 27.2 simulator.
- `open_link` `links` lists the links an installed app opens: its schemes, its domains, and on Android its filters and each App Link's verification state, as lines and as `data.links`, each with its url, its kind and a domain's state.
- A change in behaviour: `locale` on a simulator with an app given or selected holds that app in the language for every launch this tool makes, and the simulator itself is left alone. It set the whole simulator, which `app ""` still does, and the answer says which it took. What no longer changes with an app selected is the system's own text, such as permission prompts and Settings, and a launch this tool does not make. `launch_app language` on a simulator holds until `restore`, as on Android, where it lasted one launch. A condition held for one app is refused for another until `restore`, as the first could not be put back. Run on an iPhone 17 Pro simulator with iOS 27.2.
- `network slow` on an Android phone from Android 13 caps what it downloads at 30 kB/s, by Android's own `ingress_rate_limit_bytes_per_second`, where a phone was refused; a number of bytes a second sets the cap on an emulator too. It adds no delay and leaves uploads alone, and the answer says so. Written down and deleted at `restore`. On an API 34 emulator a megabyte took 778 ms, then 11.2 s under a cap of 100,000.
- `fold` on Android goes by `cmd device_state` on a phone and an emulator alike, from API 31, where only an emulator's console folded. The request outlives the tool, so it is a condition now, read back and reset at `restore`, and it takes any state the device lists, such as `half_opened`. Run on a 7.6" foldable emulator with API 34; no real foldable has been run.
- `locale` on Android below API 33 sets the whole device's language, by the agent as Settings does, where it was refused: apps have no language of their own there. Android keeps it through a reboot, so the old one is written down and put back. Run on an API 30 emulator, where Settings read Turkish, then English after `restore`.
- `biometric enroll` on an emulator with no fingerprint takes one by itself: it sets the screen lock to PIN 1234, written down first, goes through Settings' enrolment and touches the sensor. `restore` takes the PIN off, and Android deletes the fingerprints with it. A real phone, and an emulator with a lock of its own, are refused with why. Run on an API 34 emulator.
- `type_text` into a field on iOS no longer waits for a focus to appear before the tap and after it: 3,236 to 1,220 ms on an iPhone 17 Pro simulator, 4,398 to 2,262 on an iPhone 13 Pro Max, medians of 5 through MCP.
- `scripts/speed.mjs <device id>` times the common calls an MCP client makes, on the fixture app, on any device: a new server each run, each call proved by its answer, the median and the worst beside the server's own time, the settle and the host's load.
- The app is signed with one Developer ID and the hardened runtime, and is notarized when credentials are given. A release refuses to be anything less.
- A window by Wi-Fi, opt in: `appdyno pair` makes this Mac's pairing with a phone once, with a person accepting on it, on its cable for an iPhone, and a phone's serial may be an address. A dropped network reads as a pulled cable, and the window comes back by itself, though a phone whose own Wi-Fi goes loses Wireless debugging with it on Android, and takes a hand. In the hub a phone on a cable is paired from Connect a Phone, one phone is one row by whichever way it has, and the row and the bar say Wi-Fi. A window by Wi-Fi is run on a Samsung, where a touch shows in about 200 ms for a cable's 105. An iPhone is run with its cable in, its letters through tunnels on the network. Nothing has been run with a cable out.
- A second measure on an iPhone waits out the trace tool, which does not find a process for about 3 minutes after a recording attached to it: the wait ended at 180 s, just before the tool came back at 189 to 196.
- An iPhone's CPU share is the instrument's own: reckoned from its running total it read 1.8 times too high, 88 % for a core at 50.
- On an iPhone the gate sees a scroll that is steadily slow. A steady 25 frames a second is no hitch, so such a list read no regression against one at 120: `frames.p95_ms` is now a frame's time on the screen there.
- `perf_compare baseline` is not done while it can call nothing: three runs of a sample each, as `perf_snapshot` gives, read as ready, and every comparison after them said too little to call. It says how many samples it holds of the five a comparison needs.
- On a simulator the look for a Face ID or passcode sheet over the app starts no runner: `screen` after `launch_app` or `open_link` hid a start of the runner, or its first build.
- A read tries a lost connection once more, and no longer a start that failed, which took as long again for the same answer.
- A start of the iOS runner ends as soon as the runner it started speaks another protocol, and says which build to make again. It waited out its 180 s for an answer it already had.
- An Android start ends at the first answer from an agent of another version, which no wait changes: it was asked for 60 s.
- What a person or `type_text` types on an iPhone or a simulator stays in no file. XCTest wrote each key, a secure field's as well, and each field's value it read into the result bundle `xcodebuild` left in DerivedData for every start of a runner, and a plain field's text into the runner's log. Those lines are off, `type_text` goes by the event synthesizer, and `xcodebuild` keeps one folder for each device in the state folder, replaced at each start and gone at a stop. Bundles from before stay where they were, in `~/Library/Developer/Xcode/DerivedData/temporary-*`: treat them as holding what was typed, and delete them.
- What is typed in an iPhone's window goes by its runner as a string, so the letters are the ones typed whatever the phone's keyboard layout: keys go by position, and on a Turkish layout `quick` went in as `quıck` and `-` as `*`, with no word. Text with no key needs no paste. With no runner to be had the window says that the layout decides them.
- Letters typed just after a tap in an iPhone's window name the field under it and go once that field has the focus, or are dropped with a word: they were lost, could take the focus with them, and after a tap from one field to the next a password reached the field before it, 8 rounds of 36 at 100 to 300 ms.
- A client's search finds a tool by the words people use, such as emulator, performance, deep link and dark mode, none of which was in any description.
- `appdyno mcp` is the one way to start the server: `appdyno-mcp` is gone.
- `bench` times this tool alone: `--driver` is gone.
- `pnpm build` goes on with no Android agent, so a clean clone passes `pnpm run ci` with no JDK. `npm pack` and the Mac app's build refuse without one.
- The docs are an index, guides and a reference, with an architecture page and diagrams. The README keeps what a newcomer needs.
- A tap on an iPhone that changed nothing watches for a system alert on a screen with a hidden copy of a control too, where it did not run at all, and its answer says no alert came.
- The hub wears one palette, light and dark: a ground of deep blue, violet and rose painted behind the system's glass, tiles and capsules that keep their colour, a card for each reading, and Tools rows that say how they stand. The device's picture is never tinted: its colours reach the ground around it, as hue only. Reduce Transparency gives a plain ground and solid cards, Increase Contrast stronger lines and words, and Differentiate Without Color a shape for each state.
- The dashboard and reports wear the same palette, on the same ground, and a test holds the two together.
- The app's icon is glass on macOS 26 and later, drawn by the system at every size, with no grey plate at 16 and 32 pt. A Mac below that has the drawn icon.
- A run in Tools turns while it runs and lands when it ends, a step passes with a ring, a result arrives in its list, and the capsule crosses over for a state, where it did so for every new number, once a second. A spring that took 500 ms to come to rest now keeps within 300 ms.
- On macOS 13 the viewer no longer calls what only macOS 14 has, in a toolbar, a spring and a path, any of which ends a process, and two symbols that drew nothing there have older ones in their place. A test holds every source to the floor.
- A client of no name no longer ends the hub, and a name that begins with an emoji keeps it whole on its tile.
- The keyboard starts on the hub's list, where a caret blinked in Search on a window with no device.
- A failed read of the app in front no longer blanks the figures for a second: the app last named is read on.
- `perf_snapshot` on an iPhone says when another app, or a locked phone's home screen, stood in front, and keeps no CPU number from it: an app the phone had stopped read 0 %, and the gate called a real cost no regression. It asks only if a runner is already up.
- `perf_scroll` goes on into new rows for as long as a list moves, read from the screen, and brings it back only once the list has ended, which the answer says. A round past a list's end read as smooth on Android, from frames of nothing, and on a real iPhone it failed the call with its good rounds lost.
- An agent that stops under a session says so, on the call's progress and on stderr, where a read used to start another and go on as though nothing had happened. A device suite that loses one fails, unless the test ended it on purpose.
- An iPhone's runner lives through a keyboard closing and a home screen settling: a read of what had gone by then ended it, a new start hid that, and an action caught in it failed. A read of the home screen no longer asks a widget's process about its copies, which took 7 s and then stopped answering.
- A runner no state remembers, as a host killed during its start leaves, no longer comes back some seconds after a new one starts and takes the device from it.
- The Inspector shows contrast on a simulator and an iPhone: it asked for a kind of audit only Android has, and the whole audit was refused.
- `install --remove` leaves a client's settings readable whatever comments stand around its entry: a closing brace under a `//` comment was pulled into it, and the client could no longer read the file. An entry no longer goes into a comment that opens on the line of the brace, and an edit that does not read back as asked is refused, with the file left as it was.
- A client's file reaches the disk before it replaces the old one, so a power cut leaves one or the other whole.
- A move or an undo keeps a TOML entry's inline table, literal string or date word for word: it wrote them as strings, and the client refused its whole file. Strings in a JSON entry keep their brackets and spaces too.
- `install` leaves alone a TOML list written on one line, a file not in UTF-8, a link that leads nowhere and a file closed to writing, each of which it damaged or replaced, and `--remove` no longer takes a server whose quoted name begins with this one's and a dot.
- What a phone or a simulator sends that cannot be read ends that connection, not the server, and a plist or an archive that names itself ends with an error, where a few small objects ran the process out of memory.
- A long answer from a phone's service no longer stops at 1 MB when another stream speaks last: each stream gets back the window it used.
- A failed update leaves none of its copy beside the app, says why when the failure is this Mac's own, and refuses an app whose signer it cannot read.
- A flight recorder or a timeline that cannot start leaves nothing running, one turned off waits for the trace coming up, a crash is looked for by the device's clock, and a timeline left open stops reading its device at the 180 s it can hold.
- A store edited by hand no longer takes the whole dashboard down: what cannot be shown is left out.
- On Android a read that finds no window says what the agent found, that the app in front is not answering, or that the screen is off: both read as `no window to read`.
- An Undo in the hub that a client's file refused says it did not happen, and stays to be asked again: it said Put back as it was, with nothing changed, and went.
- A client that reaches an iPhone as something else starts its runner shares that runner: each started its own, and the one that lost heard nothing for 3 minutes.
- A hub with a device in it ends within a second of being closed, dark screen or not: a timer for a window that had already gone held the finished process for 5 s.
- A start's phases are kept once: a run keeps the stamp of the newest start it read, on that phone, and a start is new when it is not that one, which asks no clock of the phone's to agree with another.
- A phone that has slept keeps a start's phases: its starts are stamped on the clock that stops in sleep, so each read as older than the last run and none was kept. A service's start no longer shows a phase of minus 29 hours, as its launch is stamped on the other clock.
- A client asking for the window of a device that stands in the hub no longer closes the hub: it died of the signal that brings a window forward.
- A hub and a client of two builds share a device, as an update leaves them: each used to replace the other's agent, and calls failed on Android. An agent of another build now stays until its last host on this Mac has gone, and the host that starts later is told.
- A device that stops answering adb no longer holds up the hub's list of every device, or a window on Connecting until the hub is restarted: a request to it fails in 15 s, where nothing ended that wait.
- A hub does not take an Android device from a run with a state folder of its own: it stops and says so, where it replaced that run's agent.
- The viewer a Mac compiles on first use, and the one in the app, hold no test code: about 14 % less to build, and no test switch in what a person runs.
- On an Android phone an arrow leaves a text field, as it does from a keyboard with arrows: a key that named a keyboard alone was held by the field, and only an emulator's window went another way.
- A watch on a window that goes while it runs says so at once, in place of waiting out its time, and a request from another process is whole or not there.
- What runs from the hub's Tools ends with the hub, however the hub ends: a hub that crashed left it driving a device with no window. A command that refuses to stop now ends within seconds, and can no longer hold the hub's own end.
- On an Android window the arrow keys reach the device, as the agent has them, and a recording writes the key that was sent: Esc is Back there, so a replay does what was done, and not `KEYCODE_ESCAPE`.
- `exits.crashes`, `exits.anrs` and `exits.user_anrs` are what happened in a run, counted from the last run of the same key, and no longer all the system still holds: an ANR from last week made every later session "count". What it holds is said as such and feeds no gate and no Play line. A first run keeps none, and a baseline taken before this holds the old stock, so take it again.
- A count that rises from none is no longer `ok`: with one sample a run it is `few-samples`, which stops a gate, and with five it is a regression.
- A journey's step that never settled keeps no time, and its iteration no whole: the tool's deadline was kept as a reading. `journey.unsettled` counts such steps, so a step that stops settling is what the gate calls. A baseline holding those deadlines should be taken again.
- `frames.frozen_percent` and the guards on how many frames a round needs go by the frames there were, read from the rows, where a phone's summary counts each frame twice. Take a baseline of frozen frames on such a phone again.
- An iOS step's time no longer holds the runner's wait of up to 800 ms for a system alert, which it says apart as `idleMs`. Such a step reads shorter: take its baseline again.
- A phone whose state could not be read says `device-state-unread` beside its numbers. It stops nothing.
- A kind every run of a baseline of three or more holds, and a run does not, stops the gate: a screen that stopped drawing kept no frames, and read as clear. A flow whose steps changed does this until its baseline is taken again.
- What was not really measured is kept nowhere. A frame recording with no frames keeps none of its numbers, where it kept zeros, and one of under 60 frames no share and no percentile. A surface that stopped drawing keeps nothing, as its frames are of any age, and neither does one of few. A start's phases are kept only if it began since the last run, so the first run keeps none. A count that fell between its reads, a thread reading of one read and an app whose size could not be read keep nothing, where they kept a negative or a 0. An iPhone trace without the table of hangs or hitches is refused, where it read none. `perf_trace` answers no `frames` and no `worstMs` where it counted none.
- An export to Maestro takes `press_key volumeUp` and `volumeDown`, which it refused under names no flow has.
- `--last` above 1 refuses runs of more than one build, whose median is of neither, and a pool carries the marks of any run in it. A scroll keeps no `frames.p95_ms` from a round of too few frames, as with its jank.
- Every percentile in a measurement is one definition, interpolated: frames, the frame timeline, its overrun and CPU, and the iOS probe each had their own. On few frames a p95 reads lower than it did: take such a baseline again. A trace whose CPU column held nothing keeps no `frames.cpu_p95_ms`, where it kept 0.
- Connect a Phone in the hub, where the empty state stood: it finds the phone in your hand from the Mac's USB registry, asks only what that phone needs, and shows its one current step with a diagram, moving on as the phone's state changes. Android: adb with Google's terms first, Developer options by maker, USB debugging, Allow, and a Xiaomi's two switches. iPhone: Trust, Developer Mode, said to restart first, and what a runner needs. A cable that only charges is said plainly.
- A phone that got ready there opens by itself, with one sentence on what to try and AI Clients a click away.
- Tools in the hub: the gate, flows, the timeline, the flight recorder, the dashboard, trace tools, updates and the PATH, each the very command, spawned from one table, with what it says and how it ended in words. The gate's row goes by what the gate printed, so what it could not judge is never green. `docs/mirror.md` lists what stays out, and why.

- AI Clients in the hub: every client `appdyno install` knows, each as it truly stands. Connected is earned only by a real call: the server keeps a client's name, version, way in and last call, and nothing it sent. A client not in the list still gets a row of its own once it has called.
- Adding or removing a client from the hub shows the exact lines first, by `install`'s own code, and Undo takes that one entry back, flags and all, as a client may have written its file since.
- Test runs what a client's entry runs, as far as its list of tools, and says what to do next: no such command, a short `PATH` from the Dock, a package the registry has not got, no answer in 60 s. It calls no tool, so it touches no device and earns no Connected.
- The hub starts and stops `appdyno mcp --http` for a client in a browser: its address, its token hidden until asked and copied so that a clipboard manager leaves it, a new one when one got out, and in plain words what a token gives and what a tunnel means. The server ends with the hub, however the hub ends.
- The capsule names the client driving a device, as a person knows it.
- Help in the hub, in the Mac's language: what appdyno is, prompts by goal filled with the device and app, what each does to the device, what each panel and number means, and `doctor`.

- The hub is one window: the system's Inspector, edge to edge, in place of a floating pane; one capsule in the toolbar for everything a device is at; four symbol tabs; and measures as one grouped list.
- What a window says holds its strength behind other windows, as it usually is: from a title and symbols at 2:1 to every word at 4.5:1 and every symbol at 3:1, read from the real window, dark and light, but for what stands disabled while a measure runs.
- Every word of the hub in Turkish and English by the Mac's language, from one table. A viewer's own words and what the parent sends pass through it at the label.
- Results has a history: what was measured on this device before, judged by the gate's method, in words.
- An agent shows on the device: a purple ring, a dot where each tap landed, and Activity as runs of work in words, not a list of tool calls.
- A device that cannot show says why, with a next step: asleep, locked, held up before its first picture, unplugged, and a cable that only charges. A phone unplugged stays chosen and comes back by itself.
- Motion for what changes and nothing at rest, under 300 ms, with Reduce Motion a plain cut, and VoiceOver told of a device arriving or leaving and of a regression.
- `pokeClick` clicks by real `CGEventPostToPid` events, through the window's own hit testing, and says truly what was under the point.

- A window a person did not click passes nothing to a device. Started from a terminal someone was typing in, a viewer could be handed the keyboard: its keys, dictation, ⌘V with the Mac's clipboard and device shortcuts such as ⌘L all reached the device, as being the key window was all that was asked. Now a viewer cannot be activated until it has launched, one kept behind cannot be at all, and a device hears nothing until a person's mouse comes down in that window.
- A first read of a simulator's home screen starts no runner in a session that boots it, new or not. Three things sent it to the runner: a widget, which is another process's; a widget and its app's icon, taken for copies of one control; and the seconds of a first boot with nothing in front. Spotlight, and another process's content in an app, still go there.
- A new icon, drawn from one source: `pnpm icons` regenerates the runner's and fixtures' icons, the Dock tile, the pages' mark, the logo and the social preview from `scripts/icon-art.mjs`, and `scripts/build-app.mjs` builds the app's `.icns` and menu bar glyph from it. Below 128 px it is a separate drawing, as the large one reads as a letter there. The Android and iOS fixtures now have an icon, and a signed runner rebuilds once to take the new one.
- `app/appdyno.icon` holds the icon for Icon Composer, compiled by `actool` on every `pnpm icons`, and is not in the app: it has one drawing for all sizes, so its small sizes bring the letter back.
- A recording on a phone with no encoder free, as a Samsung A52 under an open window, refuses at its start, in under a second: it used to run and fail only at its stop.
- A device whose own window closed within 20 s of opening goes back to the hub: it stood chosen there with no picture, and a click on it did nothing.
- The flight recorder keeps a stall on a phone of one encoder, such as a Samsung A52: a second recording died there, and the save lost with it left the recorder off. The old segment now ends first on such a phone, a save goes on without a segment that holds nothing, and a recorder goes on after a save that failed.
- `refused` fails the gate too, saying what is not comparable, and `new` stays a pass. The job in `docs/perf-gate.yml` waits for the load before the pull request's own run, where it waited only at the start.
- `noisy` fails the gate as `few-samples` does: `perf compare`, `perf why` and the job in `docs/perf-gate.yml` exit 1 on a change seen under load, and say to measure again. It went green.
- `Appdyno.app` and a disk image, from `scripts/build-app.mjs` and from `release.yml`. It carries its own Node, the Android agent and a prebuilt viewer, and runs on a Mac with no Node and no developer tools, where the Mac's own dialog offering to install them is never raised. A double click opens the hub, its devices are in the menu bar, and it is in the Dock only while a window is open. With no Developer ID it signs ad hoc; `APPDYNO_SIGN_IDENTITY` and the notary's variables sign and notarize.
- `adb` is not in the app: Google's terms forbid passing it on, and it holds LGPL code. `appdyno tools install adb --accept-license` downloads Google's platform-tools, checked against a pinned hash.
- `appdyno path` puts the app's command on every shell's PATH, and `appdyno install` gives MCP clients the app's own path. A moved app is fixed on the next open: its entries and its link follow, and all else in them stays.
- `appdyno update` and `doctor` know the app. It updates itself on a signed appcast, verified with a key it was built with, and changes nothing until the download, its signature, its signer and its version all hold. Nothing checks in the background.
- A Homebrew cask, `appdyno.rb`, made for each release.
- A baseline or a comparison that cannot judge never looks done: `perf baseline` exits 1 until it holds the runs a comparison needs, saying how many it has and how many are missing, and `perf compare`, `perf why` and the job in `docs/perf-gate.yml` fail on `few-samples`, which says the gate could not judge.
- `screenshot` `watchMs`: what moves on a screen, as words and with no image, for what one picture cannot show: which regions moved, which way, how fast in the units a `tap` takes, smoothly or with jumps, stops and runs backwards, and where something is cut. For example `y 716-860: moves left at 209/s, jumped 105 at 0.7 s`. `strip` adds one image of 8 timed frames. It reads the frames a window shows, once, in the viewer, and shares a window's stream where there is one. `assert` `check: moves` says a thing must move within a time, or with `expect: false` that it must not. It reads motion, not intent; a video or a game reads as noise, and says so; a device with no stream refuses. The tree comes first, then this, then a video.
- `appdyno hub` is one window: a sidebar of devices, the one chosen live and controlled beside it, the system's own toolbar, and the Inspector a click away with Performance first. A window of its own comes on request, two devices split the window, and a viewer that dies is brought back with what stood in it.
- A window keeps its pictures through a decoder's stall on a busy Mac: pictures already decoding were thrown away with the frame that did not fit, and a stream's first burst could leave a window black until the next key frame.
- The library is one function, `connect`, shown in the README by an example a test runs: every tool by name, typed from its schema, and `replay`. The 347 names it exported, the README's `flowsFor(ctx)` that was not among them, and the need for zod's types are gone.
- `bench` says it is for an Android device, in its help and to an iOS one, where it spoke of adb.
- `perf baseline` counts a run once, takes `--last`, and says how many runs it holds of the 3 a comparison needs. The README's lines left one run in it, so that a regression could only be `few-samples`.
- `perf compare --device-class` with no runs of that class says which classes have them.
- `scroll_to` and `swipe` `exact` move a row across a page: the finger went through the page's middle, whatever x,y said, and a banner changing by itself was called the list moving.
- A first read of a simulator with no app named starts no runner: it asked for the runner where nothing was named, and a new simulator's home screen took a build to read.
- A touch on a turned simulator lands where the read says: it takes the path a window's touch takes, turned by what the app in front says of itself, and it left that path for one that missed and said tapped. A process started after the turn knows it too. The runner's tap on a turned screen is XCUI's own.
- `mirror stats` says a dash where nothing was counted, not -1, and a status has no such number.
- A journey's `frames_p95_ms` is of the step's own frames, as its `frames_worst_ms` is: it could pass the worst, from gfxinfo's buckets. A baseline kept before this moves.
- `mirror --record` makes its movie as a window's Record does, by the device's own recorder where the picture is no stream, so that an emulator and a simulator get one. A movie that does not start, or ends with nothing, fails the run with exit 1.
- `mcp --http`: a second client is refused at its call, by who is calling: one that connected before the first tool call was served on the same context. Each client gets its name back as its session id, and a call with none is refused while another holds the server. A refused client no longer keeps the holder's time running.
- `press_key` `app_switch` on a simulator opens the switcher, by the input a window's control sends: the drag it made showed none, and it said pressed.
- A failed action says `dispatched: "unknown"` once its touch has left for the device: the read after a touch can fail too, and `false` told a client to press again. An app in front that does not answer says so, in the words of a screen that is off.
- `restore` and the end of a session bring Android's Wi-Fi back: its old value was read while the radio came back from airplane mode, and written down as off.
- `press_key` `power` and `lock` press with no look at the screen first: on a dark Android screen the look woke it, and the key put it back to sleep.
- A `wait_for` that ran out answers `TIMEOUT` and an `alert` answer with no alert `NOT_FOUND`, both refusals, and exit 1 on the command line. In a flow an `alert` step with no alert still passes, as a prompt comes once.
- `audit` `types` is kept to on Android. On iOS a type the platform audit has not is refused by name: none of its types it knew meant every one.
- `doctor --serial` asks the driver that would open the device, so that a booted simulator is no longer "not connected", and a missing runner's fix is `appdyno ios build`.
- `--help` answers on every command, `--version` prints the version, a flag with a default is not called required, and a command's line is its first sentence, not its first colon.
- The package holds the README, and `THIRD_PARTY_NOTICES` holds the notice of each package bundled in it.
- A point past the edge of the screen is refused, with no touch sent: `tap`, `swipe`, `type_text` and `gesture`. It was called tapped.
- `screenshot --out a.png` writes the format its name says, as `file` does, and answers `saved`.
- `perf_snapshot` gives no percentile on no frames: gfxinfo's was the top bucket of an empty histogram.
- Arguments a tool does not take answer `isError` with `code: INVALID_ARGUMENT`, a hint and `dispatched: false`. `type_text` says it takes up to 500 characters.
- `perf_launch` `compile` is refused on iOS, where it was ignored.
- A click on a window's toolbar does what it says, the first one included: on macOS 27 no button of it did anything, as a button answers `representedObject` with nil, and a window not yet in use took a first click for itself.
- `appdyno mirror`: **Record Flow** writes what a person does on a window as a flow, by selector: clicks, double clicks, long presses, swipes, typing, keys, Home and Back, and Launch and Quit from the Apps pane. A password is written as a secret's name, never as its text, typed on the Mac or on the device's own keyboard. What has no step is said at that moment and written as `unrecorded`, and a place nothing names is marked as coordinates. Swipes that reached what is clicked next become `scroll_to`. The recording is the one `flow` keeps, so an agent's `flow start` takes a person's clicks too.
- The Inspector's **Flow** pane: the steps as they are written, and what is under the pointer, with its role, words, ref, id, contrast and what a click there would write. A click can copy its selector, or add an assertion, in place of touching the device.
- `scroll_to` no longer runs past a row: on a simulator a list went on coasting from each stroke, and could reach its end with the row behind it. Each stroke now slows to a stop and takes 0.7 s, from 0.5 s. One stroke that moves nothing no longer reads as the list's end: it may land as a screen still arrives, and two in a row are asked for.
- `--quality auto` stops at the smallest picture a person can read, 1.12 pixels for each dp of the screen, and says the device cannot keep up, and it grows again when a device has room. It no longer goes down to 360x800.
- `report` `timeline`, `appdyno timeline`: a journey's video, touches, steps, frames, requests, traffic, log and memory on one clock, in one HTML file that loads nothing and can be sent to someone. Click a slow frame and the video goes to that moment, with the requests and log lines around it. The offset between the device's clock and the Mac's is measured at both ends, the page says how far apart two rows can be, and a row a device cannot give stands empty with its reason. A URL keeps no query and no body is held, unless a person passes `--full-urls`. See `docs/perf.md`.
- `report` `flight`, `appdyno flight`: a flight recorder, off until a person turns it on. It keeps the last 30 s of an app, `--flight-seconds` from 20 to 120, and saves them as a timeline on a crash or a stall. Saved pages go by the rules of kept traces. What it costs is in `docs/perf.md`.
- `perf_trace` on Android: `stalls.worst_ms` sees a main thread held while the render thread draws, which left no long frame: a 1500 ms hold read 38 ms. The number comes from Choreographer's `Skipped frames` line in the app's log, and the answer has `heldMs` and says so. A Samsung with One UI writes no such line, so there a hold still shows nowhere.
- An agent's `ping` says the device's time, and is answered past the queue.
- A timed log query: `logs` of a platform can say each line's place on the device's clock, and a process's lines can be read after it has gone.
- A window's rotate says when the app in front does not turn, as a launcher may not, and leaves no turn asked for.
- Two devices at once: **Open Beside…** in the hub or `appdyno mirror --device A --device B --pair` opens two windows side by side. A touch goes to the same thing on both, wherever it stands on each, each window says where it went and turns red where it failed, and one flow runs on each with their numbers compared.
- **Journey…** in a window's Performance pane measures a flow, kept with every other run.
- A window's colour holds when it is not in front: it was the glass's tint, which glass gives up. Its words stay on one line.
- A recording no longer fills a Mac: each `xctrace record` left an `instruments*.ktrace` of up to 0.7 GB in the user's temp folder, 86 GB in two days of work, and now what it made goes when it ends, however it ended. What another process has open stays, and with another recording or Instruments running only what this run held goes.
- `perf why` and `perf reference` take `--dsym`, as a function on a phone is an address without it. A phone's gate goes by the phone: where it called its own numbers, one timed through a loaded Mac is a note, and neither fails the job nor calls the run unread.
- A device is busy by the share of its CPU at work over 2 s as a run ends, where that can be read, and no longer by its load: a Xiaomi at rest read a load of 23.35 at 6 % of its CPU, and a run was refused for it.
- A phone that leaves during a recording is said to have gone, `DEVICE_GONE`, and not to be unable to record. A trace the tool cannot read says that nothing is wrong with the device.
- A measure on an iPhone no longer ends in a crash of Xcode's trace tool: the tool dies now and then as it loads a trace, and the read is made again.
- A person's touch reaches the app on a dimmed screen: on a Xiaomi the touch that brightened it was lost, with a tap reported.
- `--quality auto` on a phone takes the largest size that keeps up with a person, by what its encoder takes on motion, and starts the next stream there. `high` and `standard` keep the display's size.
- Reads of the window dump take the phone's own display: under a mirror they read its virtual display, with no focus and no lock.
- An iPhone's numbers each second for a live panel, by its own instruments with no runner and no `xctrace`: frames, and the app's CPU, memory and threads. Nothing runs until a panel asks, as reading takes about 6 % of a phone core. Frames count the display, not the app, and a mirror keeps them near 20 on a still screen.
- `appdyno perf why`, `perf_compare` `action: why`: on a regression the gate finds the cause by itself, on the same device, build and journey, and writes one answer: what got worse, how sure it is, against which baseline and run, and the likeliest cause with what shows it: a function by the diff of two profiles, a phase of a start, a frame's cause or a hang's. A cause is named only with the evidence that shows it; otherwise the answer says what is missing. Only a regression is looked at, so noise touches no device, and what a look reads never becomes a run. `perf_compare` is no longer marked read-only, as this replays a flow and restarts the app.
- `appdyno perf reference`, `perf_compare` `action: reference`: the other side of a function or phase diff, taken on the baseline's build and kept beside the baseline, as only one build is installed once a regression is there.
- `appdyno perf comment --out file`: the gate's newest answers as Markdown in a file, with no device. Nothing is posted: `docs/perf-gate.yml` is a job to copy, which posts the file with the repository's own token.
- The gate's comparisons keep a modelled number and one timed through the host marked, in every format.
- `clipboard` works on an iPhone, by Xcode's `devicectl`, with no runner and nothing asked on the phone.
- `screenshot` keeps to its size on an iPhone: the phone's own service has one size, and it gave the whole screen whatever was asked.
- Notification Center on an iPhone reads as what it is: it has the lock screen's date, and a read took it for the lock screen and pressed home.
- `app` `install` takes an `.ipa`, and says when a build is for another kind of device than this one, before trying it.
- `simulator` `create`: a new iOS simulator of a model, on the newest runtime that runs it, started, selected for the calls that follow, and counted among those this tool started. An Android emulator refuses, naming what makes one.
- `screenshot` `file`: the whole picture, `.png` or `.jpg`, or into a folder under a new name. What is there stays unless `overwrite`.
- `launch_app` takes an app by its name as well as its id, in any case and with or without accents. A name that no app has, or that several have, refuses, and the second says their ids. `app` `list` gives names on Android too.
- `launch_app` `language`: restarts the app in that language, for that launch on iOS, and on Android as the app's own language, put back with the other conditions.
- `press_key` takes `mute` and `siri`: on Android the media mute and the assistant, on an iPhone simulator the Action button and the side button held. On an iPhone `mute` needs an Action button, doing what it is set to, and `siri` refuses and names `appdyno mirror`.
- `screenshot` `points`: an image where 1 pixel is 1 tap unit, with no scale to apply. `width`: an image that wide in the answer, up to the screen's own.
- `set_location` `clear: true` ends a fixed position, on every kind of device.
- `gesture` `drag` takes `holdMs`: a press before it moves, which lifts a list row or an icon.
- `device_setting` takes `increase_contrast` and `reduce_transparency`, read back and put back at the end. On Android the first is high contrast text, and the second refuses: it has no such switch. Off on Android takes the key away, as a device that never had it left it.
- `set_orientation` takes `landscape_left`, `landscape_right` and `upside_down`, where `landscape` was. An iPhone with Face ID does not turn upside down: the answer says no change was seen.
- `steps` takes any tool but `steps` and `flow`, 30 steps, and answers with what each step answered, images in order. A touch reads the screen with `read` on its step, or last; an image asked for at a step is given, changed or not.
- A Face ID, fingerprint or passcode prompt is said in the answer of the call that met it, on Android by the system prompt's own ids in any language, on iOS from the home screen app's words, which `screen`, `screenshot`, a launch and any action that changed nothing look at. A first sheet can take 3 to 5 s, after the action's answer: the next read says it. Android's permission controller pages no longer read as wanting a person for mentioning a password.
- A screen with no word in its tree (a game, a canvas, anything drawn) is read from its picture, by the Mac's own Vision and nothing on the device: its accurate level if it answers within 3 s, which takes any language, else its fast level, whose letters are those of English, French, Italian, German, Spanish and Portuguese, and the answer says so. A late accurate scan goes on in its own process, one at a time and for 10 minutes at most, and leaves its words for the next look at that picture, as the system's Neural Engine compiler can take minutes and a kill throws that away. They are a person's screen: in a file for this user alone, gone once read and after 5 minutes anyway: its words get refs, and `find`, `tap`, `wait_for` and `assert` take them. The answer says they came from the picture, and that their places are near. A screen with any word of its own is read as ever, and takes no picture.
- `swipe` `exact`: the content moves `distance` and stops, in several strokes if long, each slowing to a stop before it lifts and measured on what the reads share. The answer says what was measured, and where the list ended, which is no failure. A screen that shares nothing between strokes refuses by name.
- `open_link` `settings`: Settings at a page, 39 by name, each opened on a device before it was listed, or at an app's own, by `am start` on Android, by `devicectl` on an iPhone, and a link through a small helper with the entitlement it needs on a simulator. A page a device has not got refuses by name. Off when the server turned home off.
- `press_key` opens `control_center`, `notification_center` and `spotlight` by name, and reads what they show: on a simulator by the drag a window's control sends, on an iPhone by the runner's drag and the keyboard's shortcut, on Android as Quick Settings, the shade and the system's search. `home` closes them and the app is read again. Off when the server turned home off.
- `press_key` takes `escape`, `space`, the arrows, and a letter or digit, with what is held during it (`command+a`, `shift+arrow_left`), and `count`, with one settle after the last press. On Android `command` is Ctrl. A server with home off refuses the shortcuts that leave the app as well.
- `list_devices` says what blocks each device, with the fix, in the words `mirror` uses: a lock behind a credential, a phone that does not trust this Mac, Developer Mode off, an OS too old for the agent. It only reads.
- A mirror on a phone runs on its hardware encoder where it was refused for a key that is a decoder's: on a Samsung's `OMX.qcom` encoders every step of the ladder failed down to software, and its 90 Hz panel now gets 89 frames/s.
- Android reads of the window dump skip its last ANR section: after any ANR they read a dead window's focus and a stale lock, until the next one.
- `tap` on plain text settles where a read outlasts the quiet window with no load: on a Samsung each such tap waited out its 3 s.
- A system window with no focus is no alert, and a strip at a side of the display is no screen: a Samsung's edge panel handle was both, on every screen.
- `record` joins a segment of one frame, as a near-still screen gives.
- A device's load of three zeros reads as not known, and the thermal status is read wherever the dump has it, which on a phone it was not.

- `inspector`: an iPhone with no signing identity lists what is on its screen, by its words and ids, and presses it by name, through the phone's own accessibility service, with nothing installed.
- `appdyno mirror`: a window with the device in a frame drawn in code, by model, with buttons that press, off by a setting. It stands on a backdrop of its own picture's colours, with its status, controls and Inspector on Liquid Glass; before macOS 26 a material stands in.
- A window's controls: Home, App Switcher, Lock, volume, Siri, Control Center, Notifications, Spotlight, rotation, screenshot, recording and zoom, in one table for its bar and menus, each kind of device showing only what it has. The Inspector has Stats, Activity and Apps, which lists, launches, quits and removes.
- A person's gestures: a right click is a long press, a pinch two fingers, a drag from the bezel an edge gesture, and text goes through the system's own input, so that dead keys and held accents work. ⌘V pastes up to 4,096 characters.
- `--behind` keeps a window off every screen, and it can write itself to a PNG as the window server draws it. `packages/appdyno/scripts/mirror-shots.mjs` does so for each state, in light and dark.
- `LiveMetrics`: a port for a device's numbers each second, in one `perf` message. A measure a device cannot give stays out with its reason, and is never a 0.
- A window's live numbers (⌥⌘P): frame rate, jank, frozen frames, CPU, memory and network beside the device, each with its last minute, a state in words, and the reason where a device has none. Nothing is read until they are open.
- The dashboard and the report share one look; rows no device has said anything of fold into a line, trends stand side by side, and a report's steps are cards.
- `appdyno hub`: every device of this Mac in one window, to start, stop, make, and open a window on.
- A window's Performance pane: readings over ten minutes, a real launch or scroll measure of the app in front by the tools an agent calls, its result, and the dashboard a click away.
- A simulator says what is in front with no runner, and the home screen can be measured: it read as not running.

- `app` `build_and_run`: builds an Xcode scheme or a Gradle variant for the device, with progress and what the build said was wrong, installs it and launches it. Off under an app allowlist, as a project's build runs its own scripts.
- `app` `download_data` and `replace_data`: an app's data into a new or empty folder and back, by its container on a simulator, `devicectl` on an iPhone and `run-as` on Android. A replace takes away what the folder does not hold, and on Android goes only once the app has read the new data.
- `perf_launch` on an iPhone refuses a launch that shows no screen within 20 s, as a simulator does: it was kept as a launch of about 20 s. Both now say what to look at.
- `appdyno update` moves to the latest release, and `--check` says what it would do and changes nothing. A release is verified before anything changes: the exact version in a temporary folder with none of its scripts run, then `npm audit signatures`, which must have verified a provenance attestation for that release itself, built from this repository. One that cannot be verified is refused with a code and a hint, and there is no flag to skip this. It upgrades with the manager that installed it, npm in its own prefix or pnpm, refuses a source checkout, a one-off `npx` run and a prefix another manager owns, and never goes back or to a prerelease. Nothing looks for a release in the background. It takes npm 11.12 or newer. See `docs/clients.md`.
- `appdyno doctor` says the version, where it is installed and by what, with no network.
- `.github/workflows/release.yml`: a version tag runs the gate, then publishes with `npm publish --provenance`. `ci.yml` packages the agent before it builds, which a clean checkout needs.
- `crashes` on Android counts every exit the system keeps, by its reason in full with its status, and what memory it died with where that was kept.
- `perf_snapshot` `also: surface`: an Android `SurfaceView` or game's frames from `dumpsys SurfaceFlinger --latency`, where `gfxinfo` has none, with its frame rate and Play's slow sessions, read in whole refreshes of the display.
- `appdyno mcp --http 127.0.0.1:PORT`: the same server over Streamable HTTP, for a client that cannot start a program on this Mac. Off unless asked, on loopback alone, with a token required and generated if not set, and an `Origin` check. A client holds it from its first tool call until 10 minutes after its last, when its conditions go back; another is refused by name. A tunnel is yours to run. See `docs/clients.md`.
- `docs/clients.md` and `docs/clients.tr.md`: each client step by step, the ones in a browser, and a phone from nothing, signing included, in English and Turkish.
- `appdyno install` adds one more client, and gives the entry that a desktop app shares with its command line the times a first run needs, where its own defaults would stop it. Times set by hand stay.
- `perf_launch` `baselineProfile`: an Android release build's Baseline Profile, present in the APK, applied by the device's status, and what it is worth, in cold starts with it and without taken in turns and called as the gate calls a change. A `.dm` that delivered a profile and compiled nothing is called that.
- `crashes` `symbols` names a release build's stack: `atos` from the dSYM whose UUID is the crashed image's, by `dwarfdump`; `ndk-stack` from a folder of libraries with their symbols. A dSYM or library of another build is never read, and the answer says which it wanted. A tombstone's signal and frames are its `detail` now, not its headers.
- `device_setting`: Android's `airplane`, `wifi` and `mobile_data`, read back from the device, put back at the end, and refused with what the device said. A device reached over its network refuses to cut it.
- `biometric` on an emulator: `match` and `nomatch` touch its sensor and are done only when the fingerprint service counted the touch, and `enroll` touches until one is held.
- `device_setting` `keychain`: empties a simulator's keychain and counts what apps held, from the store's own rows.
- Android: a system UI window with the focus is read: a biometric prompt was an empty screen.
- User-perceived ANRs count one the app recovered from: it ends in no exit, and read 0 for three real ones. The dropbox has them.
- One flow can run another: `run shared/login.flow` puts its steps in place. All are read before the first step acts, a file that runs itself is refused with the way round named, and a failure names the file and line it is on.
- Kept traces are pruned, to a limit that is said and can be changed (10 GB, `--trace-limit-gb`), oldest first and never what a baseline or a recent run names. It goes by one state folder, removes nothing when what it reads is empty or unreadable, and logs what it removes; `appdyno perf prune [--dry-run]` lists the same.
- A unit test can no longer reach this Mac's own state folder: it has one of its own, and a call on the real one fails the run.
- No silent success: a failed action says whether its touch went out (`dispatched`); a touch reads a screen nobody has seen first; a locked phone refuses by name (`DEVICE_LOCKED`); two recordings at once refuse by name, not an empty trace; an iPhone's thermal state is read from what it recorded.
- Android 15 and later: `perf_snapshot` `also: startInfo` says why the app last started, and where the start went, with no trace.
- `perf_snapshot` on a process with no window, up for a broadcast or a job, reads 0 frames: it failed on the summary such a process does not print.
- `appdyno install` adds the server to the MCP clients on this Mac: the ones you pick, or all with `--yes`. It changes that one entry and keeps every other byte, writes a backup first, does nothing when the entry is already right, and refuses a file it cannot read. `--dry-run` shows the change and `--remove` takes it out.
- Conditions go back only for their owner. Each entry records its process: the start of a session puts back only what a dead one left, and its end only its own, so a new session no longer undoes what a live `--share` process or the command line set. A command line's change stays until `restore`, even across sessions, which is new. `restore` leaves alone what another live process changed, and says so.
- A recording, a network capture, an open report and a flow recording that a dead process left are ended at the next session and said, not left running. What a live process runs, or a command line started, stays.
- State files are whole or not at all: written to a temp file and renamed, and checked by a schema. One that cannot be read is said at the start of a session and kept as `.bad`, where it was once silently written over.
- Tool calls in parallel can no longer lose a condition's old value, and open a device once.
- SIGTERM and SIGINT end the server as the client closing stdin does, so a killed server puts its conditions back.
- The command line's selected device and diff baseline are kept per working directory: two terminals in two folders no longer share one. The old `cli-session.json` is no longer read.
- iPhone: `perf_trace` `what: hangs` says whether each hang was busy or blocked, in which function, from what a Time Profiler trace holds already; `dsym` names the functions of a build with no symbols, on `perf_trace` and `perf_profile`.
- `perf_compare` `action: functions` and `appdyno perf functions`: which functions moved between two profiles.
- Android: `perf_trace` says why the slow frames were slow: a monitor lock and who holds it, a binder call and to whom, the garbage collector, work, a starved or blocked thread, or that they are unexplained.
- Tags: `tag smoke login` in a flow, `appdyno test --tag smoke --exclude-tag slow` to select. A file that cannot be read stays and fails, and selecting nothing is a failure.
- `--env-file` on `appdyno test` and `flow run` (`envFile` in the tool): a flow's values from a `.env` file, under `--param` and over the environment. A secret from it is hidden as any other.
- `appdyno flow run --iterations` and `--scenario` work: the command line took their values for stray words.
- `appdyno test --retries N` runs a file that failed on a step again, whole. One that passes then is reported as flaky, in the log and in JUnit (`flakyFailure`, `flakes`), never as a plain pass, and exits 0; each failed attempt's evidence stays.
- Android memory as Play judges it: `perf_snapshot` `also: anonMemory` reads anon RSS and swap by process state, and bitmaps, against Play's table for the device's RAM, and says a device is no P90.
- Android battery signals with no power model: `perf_snapshot` `also: battery` reads wake locks by tag, the longest one, wakeups and jobs over a window, on a phone on a cable and on an emulator. Nothing is reset and the phone is never told it is unplugged.
- Numbers against Play's definitions, in the answers and on the dashboard: slow frames over 16 ms (a session above 50 %), frozen frames (above 0.1 %, from 1,000 frames), a state's longest start of the day, user-perceived ANRs. A local run says "this session would count", never a rate.
- A journey measured and gated: `appdyno test <flow> --measure [--iterations N]`, or `flow` `run` with `iterations`, keeps a flow as a scenario with a time and what the device reads for each step. `perf compare` names the step that got slower, and the dashboard has a row `Journeys`, with one bar split by step.
- A `perf_*` call during a recording no longer stops a replay: what it did to the screen is written as the plain steps that do the same, and what left the screen alone writes nothing.
- A baseline takes what a run measured clean and names what it left out, rather than refusing the whole run for one number that went through a loaded Mac.
- `appdyno mirror`: a live native window on a simulator, an emulator or an Android phone, driven by mouse, trackpad and keyboard, with an agent on the same device if it shares. One viewer per device, compiled by `clang` on first use, with no server, daemon or port of ours. What stands in the way is named with its fix, and it goes on by itself when it clears. See `docs/mirror.md`.
- An iPhone in `appdyno mirror`, experimental, on iOS 27 and by USB: its own display service in 4:4:4 at its own size, nothing on the phone. It rests on undocumented services, so the runner stays, and its code can be left out of a build as a whole.
- The `mirror` tool: open, close, status, stats. No frames over MCP.
- `hand_off`: asks a person, and waits. A pill on a window while an agent drives, and an Activity panel of its calls.
- `perf_*` on a mirrored device gets the noise mark `mirrored`, as a stream runs an encoder there.
- The Android agent: a stream with an encoder ladder and bounded backpressure, on a connection of its own, and `touch`, with no settle.
- `simulator` boots an emulator with `-grpc <free port> -grpc-use-token`, for a window's picture with nothing in the guest.

- Protocol 2: the host parses every request by its schema, so the agents have no defaults of their own, and a value out of range is refused before it reaches a device. A dark screen is `SCREEN_OFF`, an unknown method `UNSUPPORTED` on both platforms. `device_info` no longer lists capabilities: there are none.

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
