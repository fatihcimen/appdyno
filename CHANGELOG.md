# Changelog

[Türkçe](CHANGELOG.tr.md)

## Unreleased

## 1.3.9

appdyno 1.3.9 keeps tool calls out of its own state files and keeps their reads in the folders they write in; on Android it no longer types into a field the touch is not on, nor stays stuck after a slow UI automation connect; and it reads a Flutter switch, a like-named control and a field named by its label as they are.

### Fixed

- A tool call writes in appdyno's state folder only in its folders for what tools make (`exports`, `measurements`, `reports`, `video`). Before, it could write who holds a device, the HTTP token, what appdyno puts back and a push service's key. Any other path there is refused `POLICY_DENIED`, whichever folder it is reached through.
- A file a tool call names to read (a mock rule's `body=@file`, a HAR, media, `capture_network read`'s `har`) is read only from the folders a tool writes in. Before, a server started at the disk's root or in the home folder read any file of this Mac, and `capture_network read` read a HAR from any folder. No file of appdyno's own is read.
- `appdyno test share --zip` and `appdyno test merge` leave out the links in a run's folder and say how many. Before, they copied what the links led to.
- A flow run on the command line hides each value it took from the environment, as it does one from an env file. Before, it showed them in answers and reports.
- A switch that an app gives as a row and a switch at one place (Flutter) is listed once, as the switch with its state. Before, an off switch read as a plain row.
- `type_text` by a label that names both a text and its field types into the field. Before, it was refused as ambiguous.
- Like-named elements with nothing around them to tell them apart say the ids the app gave them, in the screen list and in a refusal that lists several matches.
- A row whose label is cut short no longer lists the text it already holds on a line of its own.
- On Android, typing at a point that is on no field, as a Flutter note's page, no longer goes into the screen's one field, its title, answered as typed: the field must be at the touch, or the touch inside the field's own small holder, as a text-input layout; else it is refused with `NO_FOCUS`.
- On Android, a second `type_text` in Chrome goes into the field it touches, where Chrome's late word of the new focus had the text go into the field typed before, answered as typed.
- On Android, `type_text` types plain ASCII as keys into an editor the app draws, as a Flutter rich-text page, where it waited 5 s and refused; other letters, and `replace`, are refused at once with `UNSUPPORTED`, saying why.
- An Android agent whose UI automation connect ran out of time on a loaded device lets that connection go: every later call was refused for minutes with `AGENT_CONFLICT`, naming another automation server, while the holder was the agent itself. One it cannot let go is said with `AGENT_UNAVAILABLE`, and the agent ends, so the next call starts another.
- An Android screen no longer lists the view that holds a Flutter app, nameless, for its focus while its keyboard is up.
- Replacing the text of a field that formats what is typed, such as a phone number, through the iOS runner (a hosted CI Mac, a simulator whose helpers do not answer, or text a US keyboard cannot type) could leave digits of the old text in front of the new on a slow Mac and answer `verified: false`. What select-all leaves is now deleted one key at a time, each seen gone.

## 1.3.8

appdyno 1.3.8 replaces an older iOS runner it finds on a simulator, where one left by another appdyno process refused every touch; it also waits out an app's start in its launch on a slow Mac, and keeps a device held by a process that runs in another language.

### Fixed

- A server went on using the iOS runner it found on a device while another live appdyno process used it, whatever build that runner was. One built before `tree.get` took `pkg` read the app in front where the home screen app was asked for, so the power guard refused touches with `AGENT_VERSION_MISMATCH` and a hint to build the runner again from a checkout, which an install from npm does not have. The runner now says a `protocol.minor` in its hello, and a server replaces a runner older than its own by itself, whoever uses it, and goes on; the other process finds the new one in its place and is told why. A runner the server started itself that is still older says how to make it its own again, by where it came from: a checkout, the variable that names it, or the state folder's `ios-build`.
- **iOS: the first read after a launch could run out of time on a slow Mac, and the runner was then restarted as stuck.** A process just started loads its accessibility before the runner can read it, which took 15 s to over 30 s on a GitHub-hosted Mac. `launch_app` returned as iOS put the app in front, so that wait fell to the next read or tap, whose 15 s ran out (`tree.get did not answer within 30000 ms`). Where the runner reads the screen, a launch that starts the app now returns once the runner has read it, waiting up to 60 s, as Android's launch waits for the first screen.
- A device, a lock or a place in line held by a running process is no longer taken for abandoned when another process runs in a different language, as the Mac app beside a terminal set to Turkish.
- A refusal names the tool, action and argument to give as the catalog has them: `compare_performance` with no runs points at `measure_performance`, `read_screen` `views` at `read_screen`, `check_screen` `visual` at `check: visual_baseline`, and `transfer_files` and `inspect_app` name their own actions and `path`. Seven refusals still used names from before 1.3.0.

## 1.3.7

appdyno 1.3.7 reads an iPhone's `increase_contrast` as the phone has it, so a `restore` no longer turns off a contrast a person had on; it also says the iOS runner's start in plain lines and keeps a flight recorder's ring while a second session of its process opens.

### Fixed

- On an iPhone, `set_device` read `increase_contrast` as `off` whatever the phone had, as devicectl gives that one switch as a bare true or false. A `restore` could so turn off a contrast a person had on. It now reads as the phone has it.
- The iOS runner's start progress went to stderr as JSON, which `appdyno test` showed on a terminal. It is now a line led by the device's id, as the device's other lines are.
- A flight recorder lost its ring when another session of the same process opened on the device, as a program's second `connect()` to that device does. It now keeps it while it runs.

## 1.3.6

appdyno 1.3.6 hides a secret that a flow holds as it is in all a test run writes and answers.

### Changed

- A measured step that held a secret is now kept under a new name, so its earlier baseline is not compared with.

### Fixed

- **A secret written in a flow as it is was in the test run's record, page and JUnit.** A value of `APPDYNO_SECRETS`, or one given for a flow's `secret`, that a step held as it is, as `type "the-password"` where `type "${PASSWORD}"` was hidden, was in the step's line in `run.json`, the run's page and JUnit, and in what `test merge` and `test share --zip` copy of them; in `run_flow` `run`'s answer; and in a measured flow's numbers, the names they are kept by and its lines. A file whose line did not parse had the line's value in its error, which `verdict.txt`, the pull request's text and the lines `appdyno test` prints showed too. It is now `•••` there, as everywhere else. If a run of such a flow was shared, change that secret, and write it in the flow as `${NAME}`.

## 1.3.5

appdyno 1.3.5 leaves the Mac's clipboard alone, and keeps it out of appdyno's answers, while Simulator.app syncs a simulator's; on an iOS simulator it reads back each key pressed into a field, presses again one that did not go in, says one that still did not, and types a letter pressed after text in the case it has.

### Fixed

- **iOS: a simulator's clipboard that appdyno wrote replaced the Mac's, and one it read handed out the Mac's.** While Simulator.app runs with Edit › Automatically Sync Pasteboard on, as it is by default, it syncs a simulator's pasteboard with the Mac's both ways: what appdyno put on a simulator's clipboard replaced what the person had copied on the Mac, and a read of a simulator's clipboard returned the person's own Mac clipboard, a password or a token as much as anything, into answers, flow reports and the model's context. While that sync runs, appdyno now refuses both with `UNSUPPORTED` and says how to turn the sync off. A write is refused by `set_device` `clipboard` with a value, a flow's `clipboard` step, `press_key` Command-C and Command-X, and letters with no key typed or pasted in a window, which says why. A read is refused by `set_device` `clipboard` with no value and a flow's `clipboard` check, both from the Mac and by the runner, and by `press_key` Command-V, which would put the Mac's clipboard in a field, before the key goes. Simulator.app reads the setting only at its launch and from that menu, so appdyno cannot turn it off for a session without restarting Simulator.app, and does not restart it. With Simulator.app not running, or the sync off, both go as before.
- **iOS: a key pressed into a field could be lost on a slow Mac, and nothing said so.** On a hosted Mac XCTest's keys now and then reached no app: `command+a` selected nothing, so the `delete` after it took one letter and the field read "h5" for "5", and a letter pressed after an arrow went nowhere. XCTest's first key with a modifier to an app just started came without its modifier, which a key sent before it made rare, not gone: `command+a` then did nothing and `shift+arrow_left` moved the cursor alone. On a simulator, with its helpers or without them, a keyboard's key into the field with the focus is now read back by the runner, from the field's text and selection; an iPhone's keys go as before, as no run on a phone has proven it there yet. One the field shows nothing of after 1.5 s is pressed again, and the field is read 1.5 s more, so that a first that comes late is taken back and the key goes in once. One gone in as its plain key is taken back and pressed again, and one still not shown is said in the answer, "but the field read back does not show it", of each press of a `count`. A key whose doing cannot be read, as `enter`, `escape` or another shortcut, is pressed once, as before. A key pressed with no field holding the keyboard focus goes to the screen as before, and the answer now says so, but for `enter`, `escape` and `tab`, whose doing is the app's.
- **iOS: a letter pressed after `type_text` could come as a capital.** The keyboard's shift stays on for a while after text is typed into an empty field, and `press_key` `x` then typed "X", in four goes of four on iOS 26.5. A plain letter or digit pressed into a field on a simulator now goes as typed text, in the case it has.

## 1.3.4

appdyno 1.3.4 lets a recording that has ended by itself give way to the next, keeps text typed on a simulator as typed, tries a phone's stopped picture again for a while, no longer for ever, and makes its Try Again work, names the switch a Xiaomi refuses installs over USB by, and names the device window Appdyno.

### Changed

- **A recording or a capture that still runs is refused `DEVICE_CLAIMED`.** A `record_session` start of a video, a timeline or the flight recorder, and a `capture_network` `start`, were refused `INVALID_ARGUMENT` with "stop it first" while one ran on the device. The code is now `DEVICE_CLAIMED`, as a second trace's is, and the hint says how that one ends.

### Fixed

- **A recording that had ended by itself refused every one after it.** A recording that ended at its `maxSeconds`, at Android's screenrecord limit or as its process went stayed written down as the device's, and a `start` hours later was refused. A start now finishes one that has ended as `stop` would, keeps its file, and its answer says when it ended and where the file is; one whose file cannot be kept says why, and the start goes on. Ended means its loop on Android said so or no screenrecord runs, its recorder's process on a Mac has gone, or the time it was given has passed, which a Mac that slept can outlast. A timeline and the flight recorder start the same way, and a video start is refused while they hold their own.
- **Android: a packet trace that had ended by itself refused the next capture.** The trace ends after 10 minutes. A `capture_network` `start` after that reads it as `stop` would, and its answer says when it ended and what it saw.
- **iOS: text typed on a simulator changed once its field let go.** The simulator's keyboard rewrote text after `type_text` had read it back as typed: autocorrection made "Grace Hopper" "Good" as Send was pressed, in two goes of five on iOS 27.2, two spaces became a period and quotes curled. A session's first `type_text` on a simulator now turns autocorrection, prediction, the period shortcut and smart punctuation off, written down first and put back as any condition: at the session's end, by `set_device` `restore`, and by the next session after a process that died. An iPhone and Android are left as they are.
- **An iPhone's window tried a stopped picture again for ever.** A stream that ended as it began, with no reason, read as a phone gone: the window said to connect a data cable to a phone on its cable, and tried again each second for ever. It now says the picture stopped, to unlock the phone and keep it awake, tries again after 0.2 s and then twice as long each time up to 5 s, and after ten tries stops with Try Again, which opens the device's session anew where before it asked the stopped stream and did nothing. What the stop says is in the window's language: a Turkish window showed it in English. A phone that is gone still reads as gone.
- **Android: an install a Xiaomi refused with no prompt said no one had answered it.** With Developer options › "Install via USB" off, a Xiaomi, Redmi or POCO refuses each install over USB at once and asks nothing, and the refusal said the phone had asked on its screen. It now reads the phone's switch and names it, with that HyperOS can ask for a Mi account to be signed in before it turns on. Any phone that refuses before anyone could answer is told the same, and a phone that asked keeps the words it had.
- **A device's window was named Appdyno Window.** A device's window and the hub's are a helper app inside Appdyno.app, in a folder named `Appdyno Window.app`. Its bundle named it Appdyno, but macOS shows a bundle by its folder's name where that differs from the name the bundle gives, as for an app a person renamed. The helper's display name is now localized as Appdyno, which macOS takes whole; its folder and bundle identifier stay as they were. Its app menu has had the hub's own About Appdyno, Check for Updates… and Settings… since 1.3.1, and the viewer's self-test now checks a device window's menu as it does the hub's.

## 1.3.3

appdyno 1.3.3 types into a search field that moves as it takes the focus again, taps a selector on the dialog in front, gives another emulator behind a serial a session of its own, and ends a server whose client has gone.

### Changed

- **A claim says its holder's last call.** `DEVICE_CLAIMED` and `list_devices` say how long ago the holder last made a call on the device, so a server left open for days shows as one.
- A server that shares another live process's agent says in the answer that it is of another build, with its version and that process's pid.
- The tools reference says an Android device takes one UI automation client at a time: `uiautomator dump` gets nothing while appdyno's agent is connected, and `read_screen` reads the screen.

### Fixed

- **A search field that moves as it takes the focus refused its text.** iOS: Settings' search field on iOS 26.5 and 27.2 rises with the keyboard and makes room for its close button, and since 1.3.2 it read as a field that had let go of the focus, so `type_text` with `replace` was refused `NO_FOCUS` before a key. A field with no identifier still holds the focus where the focused one overlaps where it was found or has its words.
- **A tap by selector was refused STALE with its button in front.** A selector the device refuses because another window came in front between its read and the touch, as a dialog the app opened again, is looked for once more on the screen in front and touched there. A ref or a point is still refused.
- **Another emulator behind a serial kept the last one's session.** An AVD booted on the port of one that ended answered `use_device` with the other's Android and SDK. A call that finds the agent's connection gone now asks the device's AVD name, and another device gets a session of its own: its own facts and agent, and the allow list matched again. The last session's changes are not put back on it, and the answer or refusal says so. The same AVD booted again keeps its session.
- **A server whose client had gone could hold its device for good.** A server that wrote an answer after its client had gone stopped reading stdin and lived on with its claim; a broken stdout now ends it. SIGHUP ends a server as SIGTERM does, with what it changed put back.
- **Android: an installed app whose launcher activity does not resolve read as maybe not installed.** The answer now says which, and to install the app again.
- What a call found on its way is said with its refusal too.

## 1.3.2

appdyno 1.3.2 keeps a slow Mac's runner alive and its typing whole, says first what stands over the app when a step finds nothing, holds a wait until its element stays, and brings a more detailed dragon.

### Changed

- **A more detailed dragon.** The dragon of the site, the disk image's window and the welcome is made again: the same character, now with eyes that have depth and catch the light, fine scales, crisper spikes and claws, and larger wings that fold back behind it. The site's model is 332 KB, from 270 KB.
- **A wait holds.** A wait for an element to show passes only once the element is still there after the settle's quiet window, so no frame of a screen on its way in or out passes it; one that saw its element go says the screen changed, and to what. On a still screen a wait takes about 200 ms more.
- A `run_steps` tap on the home screen, as on an app's icon there, says once a call that `launch_app` opens an app more steadily.
- **A call past its time on a slow device.** iOS and Android: a call the device's agent is still working on when its time is up is waited for 15 s more as long as the agent answers a ping, and its answer says the device was slow, naming the call and how long it took. On a hosted Mac a read of an app that had just launched went past its 15 s and a touch past its 18 s; the runner was then restarted as stuck, a start of 40 to 70 s there, and the step failed. A call still unanswered after the 15 s is given up as before, and a stuck runner is restarted about 36 s after the call instead of 21 s.

### Fixed

- **A step that found nothing never said what stood over the app.** A step that finds no target, a wait that runs out and a check that finds nothing now say first what the app shows over its screen and how to close it, as `a bottom sheet is open over the app: "Choose a plan"; close it (back, or a tap outside) or act in it`: Material's modal bottom sheet and a dialog on Android, the app's own alert, action sheet or sheet on iOS.
- In `run_steps`, a step whose target is gone after a wait of the same call showed it says on the next line at which step it was shown and that the screen changed before this one.
- **The runner ended when a field let go of its keyboard focus.** iOS: text is typed into a field only while it holds the keyboard focus. A field that let go of it is tapped once and waited for, and one that does not take it back answers `NO_FOCUS` before any key, or `verified: false` where its first typing went in. On a hosted Mac a phone field lost the focus before its text was cleared, and XCUI's delete into it ended the runner; the next step then found another one. Deletes and Return now go by XCTest's event synthesizer, as the text does.
- **A field that formats what is typed lost a key on a slow Mac.** iOS: text a field read back as other is typed again a key at a time, each once the field shows the one before it: a phone field that formats what is typed lost a key on a hosted Mac on the second typing too, which went at 15 keys a second. The read-back waits while the field's text is still changing, up to 10 s. Text with a line break is never typed a second time, as its Return may have sent a form.

## 1.3.1

appdyno 1.3.1 closes several ways a run could read PASS for what it did not check, puts back a simulator's turn, and adds a guide for the move from 1.2. The Mac app now lists every simulator and emulator with Start, makes a new simulator, looks for its own updates, and gives an AI client started from the Dock a command it can run. A simulator types, launches and brings an app to the front sooner.

### Added

- **A welcome the first time the Mac app opens.** The dragon breathes the word alight, then three first steps wait, each a button: connect your AI client, start a simulator, connect a phone. Help → Welcome opens it again, and with Reduce Motion on it shows its last frame.
- **The Mac app's menu bar is a Mac app's.** Appdyno, File, Edit, View, Device, Window and Help, in English and Turkish, each key used once. The app menu has About, with the version and how the app updates, Check for Updates… and Settings…, where the automatic check is turned on or off. File makes a simulator (⌘N) or an emulator (⌥⌘N), connects a phone and opens a report. Device starts or shuts down the chosen device and holds its own actions; one that device cannot do is dimmed with its reason, as Shake on a simulator. Edit is the system's own, so Cut, Copy, Paste and Undo work in a field, and Copy Screen moves to ⇧⌘C.
- The library exports `ScreenNode`, `CallOptions` and `StopSignal`.

### Changed

- **Faster on a simulator.** The first typing on a new simulator no longer waits 5 s and falls to the runner: its keyboard's slide-to-type introduction stands where the keyboard would, and keys typed then go into the field, 7.9 s to 2.9 s. A launch with `restart`, `args`, `env` or `language` waits for its app in front through the read helper, as a plain launch does, so a server's first launch with `restart` no longer waits for the runner to start: Settings restarted with no runner running, 7.3 s to 5.5 s. A first call that needs the runner, as a web page or a system alert, still waits for it, and a launch's wait for its app stops at a system alert over it. Waits for a selector, a launched app and a first-run sheet read the screen through the read helper where it reads the app. Whether a system app runs is read from the Mac's processes, by its simulator's launchd_sim: bringing a running app to the front, Settings 2.5 s to 1.7 s, Maps 1.6 s to 1.0 s.
- **The disk image's window** is redrawn in the house's light look: the site's dragon waits beside Applications, one stroke of the accent shows the way, and the names under the icons sit on plates that read in light and dark. The window no longer scrolls, and its line no longer says the app lives only in the menu bar.
- A scroll measured under a `scenario` reads 5 rounds, as many as the gate needs on each side, instead of 3, which could only come back `few-samples`.
- Turkish: the docs and the Mac app keep one list of terms in English, among them simulator, emulator, flow, crash, runner and host (`Flow'u Kayda Al`, `Crash'ler`, `Runner'ı Derle`), and a test holds it.
- Docs: every page was checked against the code, and they gained a table of refusal codes, every flag and variable, each way to install up to a first call, Homebrew among them, and the desktop extension's five fields. The Turkish pages say what the English say.
- [Upgrading from 1.2 to 1.3](docs/guides/upgrade-1.3.md): the old tool names and the new, saved permissions in a client and how to allow the server whole, the commands, `run_steps` keyed by `tool`, the library, and what stays the same. The README, the docs index and 1.3.0's Breaking section lead to it, and the table of old names moved there from Tools.
- `answer_alert`, `open_link`, `run_flow` and `compare_performance` say what each does, when to use it over its neighbour, its key parameters, what it changes and what it returns. `read_screen`, `take_screenshot`, `check_element`, `check_screen`, `run_steps` and `run_flow` each name in one line the neighbour to use instead. The catalog a client reads is 26,838 characters, from 26,851.

### Fixed

- **Network strict passed on a capture nobody read.** An action under `capture_network` strict passed when the capture could not be read, as its read error was taken for a list with no request. It now fails, `network strict: the capture could not be read: …`, and with strict off the answer says the capture could not be read. A run whose `request` steps cannot read the capture as it begins is refused, where they would take a request from before the run for one of its own, and a simulator's capture whose folder is gone is refused where its log read as empty.
- **A setting not put back left the run PASS.** What `appdyno test` could not put back after a file was only logged. It now fails the run as a cleanup failure: `CLEANUP FAILED` in the log and in `verdict.txt`, a JUnit case of its own named `<file> (cleanup)`, `cleanup` in `run.json` and on the page, and exit 1, while the file's own outcome stays what its steps came to. That file is not retried, and the files after it on that device do not run: each is `not_run`, with `why`. `run_flow run` refuses with `CHECK_FAILED`, and `replay` answers `passed: false` with `cleanup`, where the mock rules their steps added cannot be taken out, and the library's `close`, silent before, answers `{ cleanup }` with what it could not put back and writes it to stderr, still resolving.
- **Checks that passed on what they could not read.** A flow's `alert` step passed on any `NOT_FOUND`: a button that is not on the alert, or a screen that could not be read, now fail it, and only no alert open passes. `check_element` `absent`, and a wait for an element to go, passed on a screen whose words come from its picture where that picture could not be read: they now fail and say so. An Android `check_screen` `accessibility` skipped contrast with no word where its screenshot could not be decoded: it is now refused, unless contrast is not among the types asked. An action whose look for its app's end could not read what it needed, as whether the app still runs, says so in a line, `not checked for a crash: …`, where it said nothing.
- **A simulator's turn is put back.** `set_device` `restore`, a session's end and a test file put a simulator's turn back as they put Android's rotation lock back: the runner reads the turn before one is made. On an iPhone 17 simulator, iOS 26.5, 9 checks of 9 held.
- **A link to an app on a simulator could say `opened` while the app never got it.** Where the simulator's helper does not read, as on a Mac with no HID service for a simulator, `open_link` looked 3 s for iOS's "Open in …?" and then said `opened`: a prompt that came later stayed up, with the link waiting behind it, and a touch on the prompt was taken for the link's screen. The app's screen is now read before the link and followed until it changes, no sooner than a second and up to 10 s, the prompt answered whenever it comes. A link held to the app that leaves the screen as it was says `sent`, with no change seen, on every device, whether or not a prompt was answered on the way. A link whose screen comes at once no longer waits the 3 s.
- **The Mac app showed no simulator.** Shut-down simulators were folded under a closed header, and the first window opened on Connect a Phone. The sidebar now has a Simulators and an Emulators section, always shown, running devices first and each shut-down one with Start; a section folds only past 8. The window opens on the device list. Where Xcode cannot list simulators, as with none selected, only the Command Line Tools, its license or first launch not done, CoreSimulator out of date or no runtime installed, the app says so with the command that fixes it, where it showed an empty list.
- **New Simulator made nothing.** Its models were not matched to the chosen system, its errors went nowhere, and the new device fell into the folded list. The sheet now asks for its choices as it opens, offers each runtime only the models it runs, shows its error, and on success starts the new simulator and chooses it.
- **The Mac app looked for updates only from its menu bar item.** It now looks at launch, hourly against a 24 h clock and on waking, offers a newer release in a sheet on the hub's window, and says "You're up to date" when asked. A copy run from the disk image or Downloads, which cannot update itself, says once that a newer release is out and to drag Appdyno to Applications.
- **An AI client started from the Dock could not start appdyno.** The Mac app tested and wrote a client's entry with the short PATH an app opened from the Dock has, so `npx` was not found. The hub now takes the person's PATH from their login shell, with Homebrew, nvm, mise, asdf, Volta and Bun, and names a command it still cannot find with where it looked. Add and Update write an absolute command and a PATH with Node, as `appdyno install` does, and an entry that runs a bare command is marked, with Update to fix it. All 11 clients passed find, add, Test and remove with the Dock's PATH.
- **A wait for a web page on a simulator could run out before the runner came up.** The read helper left a page to the runner only once the page was in the app's tree, which comes some seconds after the web view shows. So `check_element` or a wait for a page's words, with no runner running yet, could time out seeing only the app's own controls. A web view on the screen now sends the read to the runner, and the call waits for it: `open_link` onto a web page with no runner running answers with the page once the runner is up (5.9 s on an iPhone 17 simulator, iOS 27.2, where it answered in 1.6 s without the page).
- **⌘V and ⌘C in an Inspector field went to the device.** They now edit the field.
- **An iPhone connection that carried nothing for about 30 s was reset by the phone**, as appdyno did not answer its keepalive. It now does, so a quiet connection stays open.
- An iPhone's screenshot asks the phone's capture service for PNG where it refuses JPEG (iOS 27.2), makes the JPEG on the Mac, takes one capture at a time, and says which path took the picture.
- `set_device` with no `value` reads the orientation, by the turns the device reports or else by the screen's shape, and the location this tool fixed, as its description says.
- A failed `run_steps` with `read: none` shows nothing past its own lines.
- `appdyno perf compare|baseline|budget` lists `--kind`, `--max` and `--min` in its help, and `perf prune` no longer lists `--measurements`, which it refuses. `appdyno run-flow test` takes `--retries N` and `--tags T`. `appdyno test` exits 2 for a flag it does not take and for `--measure` with `--retries`, and so do `test merge`, `share` and `comment`.
- Library: a `replay` stopped in its flow's setup says `dispatched: true` once a setup step was done.
- A report's page shows pictures and video only from its own folder.

## 1.3.0

appdyno 1.3.0 renames its tools and does more with an app's network. The 48 tools are now 28, named verb_noun, and the old names are gone: a call by one is refused, with the new name in its hint. On an iOS simulator it inspects, mocks and throttles an app's requests. Foldables fold on both platforms, a tool writes and builds only where a person allowed, and each release is held to a run on a simulator in CI. It is a breaking release: the table of old and new names is under Breaking.

### Highlights

- The catalog is 28 tools, from 48, each named verb_noun, as `read_screen`, `tap_screen` and `manage_app`. A client reads 26,851 characters, from 29,451 in 1.2.0 and 30,865 with 1.3.0's new parts under the old names, and `--toolsets` lists only the groups named: `core`, `device`, `apps`, `evidence`, `network`, `perf`.
- Network on the iOS simulator: `capture_network` keeps headers and bodies and writes HAR 1.2, answers requests by rule (`mock`, also made from a captured answer or a `.har`), slows them (`throttle`), waits for one (`check`), and an action's answer names the requests that failed under it. The Mac app's Network pane works on the same capture.
- Foldables: `set_device` `fold` takes every pose an Android foldable lists, and `closed`, `half` and `open` on an iPhone Duo simulator, where reads, touches, screenshots and recordings follow the inner display.
- Security: a tool writes a file only inside the server's folders or `--allow-write`'s, `manage_app build_and_run` asks the person each time unless `--allow-build` is given, what an app wrote is quoted and escaped on its own line and the server's instructions call it data, a link by a scheme the selected app does not take asks first, and a listed secret is hidden before a long label is cut.
- A release is held to a device run: CI boots an iOS simulator and runs 21 named cases before anything is published. Each release has `SHA256SUMS` and a build provenance, and npm takes it by trusted publishing, with no npm token in the repository.
- iOS is faster. A screen whose repeated controls keep moving reads in 25 ms where it took 237 ms, a tap beside a part that never stops moving settles in about 0.3 s where it took 3.1 s and never settled, and a simulator's runner is fetched prebuilt and checked by its sha256: a first read answered in 4.8 s fetched and 20.5 s built.
- Library: `appdyno/device` gains `aim`, `screenshot`, `logs`, `openLink`, `windows`, `setOrientation`, `audit`, `clearData` and `stopAgent`, a touch takes its settle's `quietMs` and `maxMs`, and `connect` and `openDevice` take a `policy` and an iPhone's `signing`.
- Flows: a flow has a setup and a teardown, its own or its folder's `_setup.flow` and `_teardown.flow`, and the teardown runs even when the flow failed. `prepare` runs a project's own data command, and the new steps `only`, `clipboard`, `audit`, `mock`, `request`, `network strict` and `setting fold <pose>` keep a step to one platform, check the clipboard and the screen's accessibility, answer and await requests, and fold a device.

### Breaking

**The 48 tools are now 28, named verb_noun. The old names are removed, with no aliases.** A call by an old name is refused, and its hint names the tool to call. [Upgrading from 1.2 to 1.3](docs/guides/upgrade-1.3.md) has all there is to change: names, saved permissions, commands, `run_steps` and the library.

- A client's saved permission by an old name (`mcp__appdyno__screen`) no longer matches: allow the server whole (`mcp__appdyno`).
- Commands follow the names with dashes (`appdyno read-screen`, `appdyno manage-app stop`, `appdyno run-flow run a.flow`, `appdyno record-session video start`). `appdyno perf compare|why|reference|baseline|budget|functions|prune`, `perf dashboard|survey|comment`, `push setup`, `mirror`, `timeline`, `flight`, `devices` and `test` keep their words.
- `.flow` files are unchanged.
- A step of `run_steps` is `{ tool, ...arguments }`, not `{ action, ... }`, and any tool but `run_steps` and `run_flow` can be one.
- A wait that runs out fails with `CHECK_FAILED`, not `TIMEOUT`, and a wait names its `timeoutMs` (there is no default of 5000).
- What asks the person first: `manage_app uninstall`, `manage_app clear`, `transfer_files push`, `manage_app revoke`, `manage_app grant`, `set_device keychain`.
- `--toolsets` (`APPDYNO_TOOLSETS`, and a field of the desktop extension) lists only the groups named: `core`, `device`, `apps`, `evidence`, `network`, `perf`.
- `openWorldHint` is true where a tool reaches beyond the device and this Mac.
- The catalog a client reads is 26,851 characters, from 29,451 in 1.2.0, and from 30,865 with this release's new parts under the 48 old names.

| before                                                     | now                   | arguments                                                                                             |
| ---------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `device_info`                                              | `list_devices`        | `selected: true`                                                                                      |
| `set_orientation`                                          | `set_device`          | `name: orientation`, `value`                                                                          |
| `set_location`                                             | `set_device`          | `name: location`, `value: "lat,lon"` or `none`                                                        |
| `clipboard`                                                | `set_device`          | `name: clipboard`, `value` for `text`                                                                 |
| `device_setting`                                           | `set_device`          | same; `media` is `transfer_files` `action: media`, `path`                                             |
| `simulator`                                                | `manage_simulator`    | same                                                                                                  |
| `screen`                                                   | `read_screen`         | same                                                                                                  |
| `find`                                                     | `read_screen`         | `selector`                                                                                            |
| `wait_for`                                                 | `check_element`       | `gone: true` is `check: absent`; give `timeoutMs`                                                     |
| `assert`                                                   | `check_element`       | same                                                                                                  |
| `screenshot`                                               | `take_screenshot`     | same                                                                                                  |
| `audit`                                                    | `check_screen`        | `check: accessibility`                                                                                |
| `visual`                                                   | `check_screen`        | `compare` is `check: visual`, `baseline` is `check: visual_baseline`                                  |
| `tap`                                                      | `tap_screen`          | same                                                                                                  |
| `gesture`                                                  | `tap_screen`          | `double_tap` is `count: 2`; `long_press` `durationMs` is `holdMs`                                     |
| `gesture`                                                  | `swipe_screen`        | `drag`: `to`; `pinch`: `scale`; `plan`: `pointers`; no `kind`                                         |
| `swipe`                                                    | `swipe_screen`        | same                                                                                                  |
| `scroll_to`                                                | `swipe_screen`        | `selector` is `until`                                                                                 |
| `keyboard`                                                 | `press_key`           | `dismiss` is `key: hide_keyboard`, `enter` is `key: enter`; `status`: `read_screen` lists `@keyboard` |
| `steps`                                                    | `run_steps`           | each step's `action` is `tool`                                                                        |
| `alert`                                                    | `answer_alert`        | same                                                                                                  |
| `terminate_app`                                            | `manage_app`          | `action: stop`                                                                                        |
| `app`                                                      | `manage_app`          | same, but for its two data actions                                                                    |
| `app`                                                      | `transfer_files`      | `download_data` is `pull`, `replace_data` is `push`                                                   |
| `push`                                                     | `send_push`           | same                                                                                                  |
| `logs`                                                     | `read_logs`           | `maxLines` is `limit`                                                                                 |
| `crashes`                                                  | `read_logs`           | `source: crashes`                                                                                     |
| `record`                                                   | `record_session`      | `kind: video`                                                                                         |
| `report`                                                   | `record_session`      | `kind: report`; `timeline` and `flight` are `kind`, with `action: start`                              |
| `mirror`                                                   | `show_mirror`         | same                                                                                                  |
| `inspector`                                                | `inspect_app`         | `ax_list`, `ax_press`                                                                                 |
| `hand_off`                                                 | `ask_person`          | same                                                                                                  |
| `network`                                                  | `capture_network`     | same                                                                                                  |
| `webview`                                                  | `inspect_app`         | `web_pages`, `web_elements`, `web_click`, `web_eval`                                                  |
| `react_native`                                             | `inspect_app`         | `rn_targets`, `rn_logs`, `rn_reload`                                                                  |
| `perf_snapshot`, `perf_launch`, `perf_scroll`, `perf_heap` | `measure_performance` | `metric: snapshot`, `launch`, `scroll`, `heap`                                                        |
| `perf_trace`                                               | `measure_performance` | `metric: frames`; `scroll` is `direction`                                                             |
| `perf_profile`                                             | `measure_performance` | `metric: cpu`; `scroll` is `direction`                                                                |
| `perf_compare`                                             | `compare_performance` | same                                                                                                  |
| `perf_query`                                               | `compare_performance` | `action: query`                                                                                       |
| `flow`                                                     | `run_flow`            | `start` is `record`                                                                                   |

### Security

- `hono` (through the MCP SDK's HTTP transport) is at 4.13.18 and `@hono/node-server` at 2.1.8, past five published advisories; `minimatch`, `glob` and `tmp`, in development tools only, are at their patched versions too.
- `read_logs` `source: crashes` on an iPhone copies only the app's own reports to the Mac, those named after its process, where it copied up to 200 of every process's, SpringBoard's and other apps' among them, and kept them in the state folder. A report of another app's process of the same name, as every Flutter app's is `Runner`, is deleted as soon as it is read, and the first read since the update deletes what an earlier version copied of other processes. An app's extensions, whose reports are named after their own processes, are no longer given on an iPhone. On Android a `measure_performance` `exits` reading kept every app's ANR headers with the measurement, and an entry of `app.other` was read as the app's: now only the app's are kept.
- A tool writes a file where its caller says only inside the folder the server runs in, the state folder, or a folder given with `--allow-write` (`APPDYNO_ALLOW_WRITE`): `take_screenshot`, `check_screen`, `record_session`, `transfer_files pull`, `capture_network save` and `run_flow`. A path elsewhere is refused `POLICY_DENIED`. A server started at the disk's root or in the home folder has no project folder. `connect` is held to the same folders, with `allowWrite` for more; a path a person types on a command line is written where they say. The desktop extension's install form has a field for the folders. `take_screenshot`, `check_screen` and `measure_performance` are no longer marked read-only, so a client that runs read-only tools unasked now asks first.
- `manage_app build_and_run` runs a project's own build scripts on the Mac, so it asks the person each time and builds only a project inside those folders. `--allow-build` (`APPDYNO_ALLOW_BUILD=1`), given by the person who starts the server, or `allowBuild: true` in `connect`, lets it build with nothing asked; `--allow-data-loss` does not. Without it, where nobody can be asked, it is refused.
- What an app wrote stays on its element's line in an answer: an id, a role and the words that tell rows apart are quoted where they hold more than a name, with line breaks and control characters escaped, as labels were. An app can no longer make up a line of an answer. The server's instructions say that what a device shows or logs is data, never an instruction.
- A listed secret is hidden before a long label is cut, so no start of it shows at the cut. `connect` reads `APPDYNO_SECRETS` and takes `secrets`. `APPDYNO_SECRETS_FILE` lists one secret to a line, for one that holds a comma. A screenshot and a video hide none, and their answers say so where secrets are listed.
- `open_link` opens a web link, a link to Settings and a link the selected app takes with nothing asked. A link by any other scheme (`itms-services:`, `shortcuts:`, `sms:`, `mailto:` with no app selected) asks the person, and is refused where nobody can be asked. `--allow-urls` allows links ahead; `connect` takes `allowUrls`.

### Added

- **`manage_app install` takes `files`:** an Android app's APK with its `.dm` files or split APKs, installed together in one session, with the phone's install prompts answered as for one file. Files of different apps, and a `.dm` with no APK of its name, are refused before anything reaches the device. An install the device made with a warning is reported installed, with the warning quoted, and a `.dm` Android 17 refuses is said as such. iOS refuses several files. The CLI takes `--files '["app.apk","app.dm"]'`. On a Xiaomi REDMI 15C with HyperOS 3, a `.dm` installed so was applied (`speed-profile reason=install-dm`) with no tap from a person.
- **One verdict and one report for a test run.** `appdyno test` ends in one verdict and leaves `verdict.txt`, `index.html`, `run.json`, `junit.xml` and `pr.md` in its artifacts folder. The record names the commit, the CI run, each device with its OS and conditions, the app's version, and a command that runs each file alone, which never holds a `--param` value. `--pr-body` and `--no-report` are new.
- A failure's picture is painted over a password field and an element holding a secret (`screen.png` when painted, `screen.jpg` when not), and the app's last log messages and crash reports are kept beside it. No picture is kept when the screen cannot be read.
- JUnit names each failure's files as an `attachment` property and as an `[[ATTACHMENT|path]]` line, and each case has `appdyno.device`, `appdyno.commit` and `appdyno.rerun`. A failure's text no longer lists saved files.
- `appdyno test --shard i/n` runs one part of the files, the same parts on every machine. `appdyno test merge` makes one report of the parts and fails when one failed or is missing.
- `appdyno test share` says what a run's folder holds before you send it and packs it with `--zip`, leaving out the kinds `--without` names; a folder with a video is not packed until you say whether it goes. `appdyno test comment` writes the pull request text again.
- `run_flow` has `test`: a file or a folder of flows on the selected device, answered with the verdict and each failure.
- In the Mac app, Run Flows offers the run's page to open when it ends.
- **Network on the iOS simulator.** `capture_network` keeps a request's headers and text bodies when asked (`start` with `bodies`), gives one request whole by `id` with what the session measured of it, shows requests still in flight, filters by `method` and `status`, gives what is new since an id by `after`, and writes the capture as HAR 1.2 (`save`). Headers, bodies and addresses are cleaned as a log is.
- **Mock rules.** `capture_network mock` answers, fails, delays or sends elsewhere the requests a rule takes, by host, path (glob or regex), method and query. The flow step `mock` holds a rule while its file runs.
- **Throttle.** `capture_network throttle` slows the app's requests on a simulator: latency, bandwidth and loss, by the names `set_device network` has on Android, and `3g` and `offline`.
- **Mac app.** The Network pane shows a request whole, filters the list, copies a request as cURL, makes a rule of an answer, saves a HAR, edits the rules and sets the speed, on the same capture an MCP client uses. Show real values, off by default, shows what was sent in that window only.
- A `capture_network read` of all requests is folded: failures first, each host once, repeats in one line. Under the probe, the app's own certificate check (pinning) and its answers to a login or client-certificate challenge are not asked; background sessions, WKWebView, Network.framework and dart:io are not seen.
- `set_device` `fold` takes every pose a foldable lists, not only `open` and `closed`: `half_opened` (also `half`), `rear_display` and `dual` where the device has them. A read lists them after the state. A change answers with the display size and density apps then see, and whether the activity in front was recreated or kept. Flows record and replay `setting fold <pose>`.
- On an iPhone Duo simulator (Xcode 27.1 or later), `set_device` `fold` takes `closed`, `half` and `open`, put back at `restore`, the session's end and each flow file's end. While it is open, `read_screen`, touches, `take_screenshot` and `record_session` work on the inner display. It uses private API of the simulator; any other simulator refuses as before.
- In the Mac app, the Device pane's fold row lists the device's own poses, and the live window follows the display a foldable shows, at its size, with touches that land on it.
- `appdyno/device`: an element has `parent`, `pkg`, `notImportant`, `screenReaderFocusable` and `order`, its place in the order the tree gives a screen reader.
- `appdyno/device`: a device has `aim` (waits for an element still coming), `screenshot` (bytes, or a file inside the folders it may write in), `logs` (each line as data, with its time where the platform tells it), `openLink`, `windows` (with the keyboard's bounds), `setOrientation`, `audit` (its issues, the elements the checks ran on and their reading order), `clearData` (emulators and simulators only) and `stopAgent`, which ends the device's agent where `close` lets the device go.
- `appdyno/device`: a touch takes `quietMs` and `maxMs` for its settle, and with `tree: true` answers the screen it left from the read the settle made. Every touch answers `ms`. `key`, `launch` and `openLink` take the same options.
- `connect` and `openDevice` take `policy: { secrets, apps, urls, write }` and, for an iPhone, `signing: { profile, keychain, keychainPassword }` for that device alone.
- `nameOf` takes `clean` and `shownAs`, so its words pass a caller's masking and can be said in another language.
- On iOS a `tap`, `longPress` or `swipe` whose `before` names a read that no longer has in front what it had is refused `STALE`, with nothing sent. It is compared on the Mac by one more read before the touch; what comes in front between that read and the touch is not caught. Checked on a simulator for another app in front, not yet on an iPhone.
- On an iOS simulator the first action that needs appdyno's runner no longer builds it. Each release builds the runner and attaches it, under 1 MB; appdyno fetches it once from the release's page on GitHub, uses it only if its sha256 is the one the package carries, and keeps it where a build is kept. With nothing kept, a read through the runner answered in 4.8 s fetched and 20.5 s built. It is built as before, with the reason in one line, where the download fails or has another sha256, the Mac is an Intel one, its Xcode is more than one major version from the release's, or the fetched runner does not start. `--no-fetch` on the server and on `appdyno ios build`, or `APPDYNO_NO_FETCH=1`, asks the network for nothing. `appdyno doctor` says whether the runner was fetched or built here. The request is a download of a public file: GitHub sees the address it comes from, and the release and the runner's sources in the file's name; nothing else is sent.
- **A failed request with the action that caused it.** While a probe capture runs on a simulator, a tap, `type_text`, `launch_app` or `open_link` answers with the requests that failed since it began (4xx, 5xx, transport errors), one short line each. `capture_network` `strict`, and the flow step `network strict`, fail the action or the step for a 5xx or a transport failure no rule made.
- **`capture_network check`** waits for a request by `contains`, `method`, `status` and a body value (`has`), and on a miss names the nearest request and what differed. The flow step `request` does the same for requests since the run began.
- **Rules by body and header.** `has=` (a JSON path with its value, or any text) and `when="Name: value"` let one address, as a GraphQL endpoint, be mocked per operation.
- **A rule from a real answer.** `capture_network mock from=<id>` makes a rule of a captured response and `from=<file.har>` a rule for each answer of a HAR; `unmatched=fail` fails what no rule takes. In a flow: `mock from=checkout.har unmatched=fail`.
- **Body tools.** `capture_network read id` with `path` gives one value, `shape` the JSON shape with no values, `diff` what differs from another request.
- `capture_network read` ends with what the app made that the probe cannot see: web views, background sessions and WebSocket tasks, counted.
- **Mac app.** The Network pane lists requests under their hosts, shows a request in flight, edits a rule by fields beside its line, and has switches for strict and for failing unmatched requests.
- **Mac app.** The Network pane is laid out around its list. A capture row holds Stop, the time gone and the speed; Requests and Rules say how many each holds; the filter has a Failed scope with its count. A request is one line: a mark whose shape and colour say how it ended (the app's fault, the server's, one that never arrived, a rule's doing), its status, method, path and time, under a host heading that counts its requests, closes over them and stays in sight. A request chosen opens on a card under the list, the line between them movable: its address, how its time was spent, and Headers, Request and Response one at a time, JSON set out to be read. Return opens it to the whole pane, and Esc closes it. Copy as cURL, Mock This Answer, Copy Address and Show Only This Host are on a row's menu, in the card's head and among VoiceOver's actions. A rule reads as a sentence with a switch and what it took, and is written in fields with names. ⌘F goes to the filter. Headers and bodies are kept unless turned off.
- **Flow setup and teardown.** A `setup` or `teardown` line among a flow's first names another flow to run before or after it, and a folder's `_setup.flow` and `_teardown.flow` wrap every flow under it. The teardown runs even when the flow failed.
- **`prepare <name> gives=<var>`** runs a project's own data command, named in `.appdyno/test.json`, and hands what it prints to the steps after it. Over MCP, `run_flow run` asks the person first, and `--allow-build` allows it ahead. `appdyno test` runs it unasked and prints the command first. Its value is kept out of JUnit.
- New flow steps: `only ios|android … end` keeps steps to one platform, `assert … check=count` counts the elements a selector names, `clipboard "text"` sets or checks the clipboard, and `audit` runs the accessibility audit.
- A recording now writes steps for `swipe_screen` with `to` (a drag), `send_push`, `set_device orientation`, `inspect_app web_click`, `set_device clipboard` and `check_screen accessibility` (`audit max=<found> !review`). Still not recorded: `swipe_screen` with `scale` or `pointers`, and `inspect_app web_eval`.
- Library: `replay` answers `setup` and `teardown` beside `steps`. `passed` is `false` when the teardown failed, with `teardownFailed: true`.
- **A release is held to a device run.** CI gains a simulator job: on each pull request, on `main` and before every release it boots an iOS simulator on GitHub's runner, builds the runner and the fixture, and runs 21 named cases of the `ios`, `keys`, `views.simulator` and `flows-ci` suites: reads, taps, typing, an alert, a settle, keys, native views and flows replayed. A tag whose commit fails it publishes nothing, and each release carries that run's `device-summary.md`: the device, its OS, the Xcode, the date, whether the simulator's helpers or the runner alone did the input and the reads, and each suite's counts. The Android suites and the rest of the simulator's still run on a Mac, by `scripts/ci.sh`.
- **A release's files can be checked.** Each release has `SHA256SUMS` for its files, and GitHub keeps a build provenance for the disk image and the desktop extension: `shasum -a 256 --ignore-missing -c SHA256SUMS`, and `gh attestation verify appdyno-<version>.mcpb --repo fatihcimen/appdyno`.
- npm takes a release from the release workflow as the package's trusted publisher, and the repository keeps no npm token. Provenance is as before.
- [How the tools were tested](docs/reference/tools-tested.md#tested-versions) lists the device, OS, Xcode and date of each run in one table.

### Changed

- Tested on a real iPhone 13 Pro Max with iOS 27.2 and Xcode 27.2, and on a real Xiaomi REDMI 15C with Android 16 and HyperOS 3.0, every suite that takes a phone: see the tested versions.
- A touch refused as `NOT_FOUND` or `STALE` holds the screen as it is now, as an answer does: what differs from the screen shown last, or all of it. It took a `read_screen` call and a turn before the next try. A `run_steps` call that fails shows the screen the same way, where it always showed all of it; `read: full` still does. Neither hint sends to `read_screen` any more.
- The server's instructions say that `launch_app`, `open_link` and every action answer with the screen, so `read_screen` is for when no answer has shown it, and that the actions already known go in one `run_steps` call, with `check_element` last where a result takes time. A `check_element` wait that runs out with the screen in its answer no longer says to read the screen.
- Over MCP, an answer's structured content leaves out each warning its text says, and `warnings` where none is left: a client that hands a model the structured content alone read every warning twice.
- A whole screen folds rows that only their context tells apart under one header, with the context in a column of its own: twelve `Add` buttons took 1,248 characters and take 1,044.
- `read_logs` says the day, and the process where one wrote every line, once under its first line and not on each line: 200 lines of logcat took 19,014 characters and take 16,458.
- A refusal that holds why the app died says so in its hint, where it sent to `read_logs` with `source: crashes` for it.
- A `run_steps` call refused for a step that is no tool says that nothing was done.
- `node scripts/efficiency.mjs` prints what eight tasks cost in calls and characters with no device, and `node scripts/bench.mjs <simulator id>` runs five with a real model; see CONTRIBUTING.
- The tools and `appdyno/device` aim, wait and settle by one rule in core, so a correction reaches both.
- An element from `appdyno/device` holds the fields its type names and no other; fields the type never named (`name`, `nameKind`, `context`, `refContext`) are gone, since they carried the element's words unmasked.
- `openDevice` hides the secrets, and may write in the folders, that `APPDYNO_SECRETS`, `APPDYNO_SECRETS_FILE` and `APPDYNO_ALLOW_WRITE` name.
- `capture_network` `read`, `paths` and `check` no longer wait their turn on the device.
- A flow file whose name starts with `_` is no longer run as a test.
- A failed teardown is a JUnit case of its own and makes `appdyno test` exit 1. `run_flow run` names a failed teardown beside a failed step.
- `setup`, `teardown`, `only` and `end` are now words of the flow format.
- A recorded `audit` can fail a replay.
- `--allow-build` also allows `prepare`.
- A library caller that reads only `passed` now sees `false` for a failed teardown.

### Fixed

- iOS: on a simulator, text typed by ref goes into the field it names when the keyboard moves the form. On a simulator on its side the keyboard lifted the form and brought the password field to where "Your name" had been read, and the text went into the password field with an answer that it had been typed. The field touched is now followed by what it is, at its place while it stands there and else by its focus, and read back so.
- `inspect_app` `web_click` waits up to 1.5 s for its selector, as a tap by selector waits for its element: on iOS 27.2 a web view's page is listed while it is still about:blank, and a click right after the link that showed it found nothing.
- Mac app: New Simulator offers every runtime of this Mac, two of one name too (iOS 27.2 and the iOS 27.2 of a single model). The menu kept one item of a name, so nothing was chosen and Create did nothing.
- `measure_performance` `launch` with `mode: hot` or `warm` starts the app again only once the system has stopped it: on an emulator still pausing the app it answered `UNKNOWN` and measured nothing.
- On Android, a turn of the screen that appdyno puts back, by `set_device` `restore`, at a flow's end or as its agent lets go, leaves auto-rotate as it was found, also on a phone that writes a rotation lock of its own after a turn (a Xiaomi REDMI 15C with HyperOS 3).
- Android: an app brought to the front is answered once its window has grown to its place. A read waits while a window is drawn smaller than its size, sticks out of the display, or slides with nodes that have no place, so a tap by ref right after lands where it should.
- iOS: the keyboard over a web form closes in any language: the Done of the bar over it is found by its place, not its English word.
- iOS: scroll bars are left out of the screen's list wherever they stand, told by the percentage they hold, in any language.
- iOS: a launch that starts the app shows a first-run sheet that comes just after its first screen held still. A fresh start is watched 1 s more; an app brought to the front is not.
- Android: the flight recorder kept no crash when the system held the crashed app for its "keeps stopping" dialog: the process stays, with its pid, until the dialog is answered, and it was read as the app still running. A process held so is now read as a crash, and its last seconds are kept.
- Android: `send_push` `tapped` to an app held for its crash dialog said it had opened the app, where `am start` had waited 10 s on the dead process and opened nothing, so the data never reached it. It now stops such an app first, as `launch_app` does, and opens it anew with the data as extras. `open_link` held to such an app does the same.
- Android: `manage_app install`, on a phone that asks before an install, lost about 5 s of the prompt's 10 when the screen went dark just as it read the prompt, waiting for a focus a dark screen does not have. It now wakes the screen at once, and reads the file's names before the prompt, so that its touch follows the read.
- **Big real apps drive right first time.** On Android 16, an app that holds its intents to their filters now starts: `launch_app`, a push's tap and a measured launch send the launcher's action and category, where a bare component was refused as "does not exist".
- An Android tap whose reaction comes after the settle's window is answered with that reaction, as on iOS. A tap on a control that changes nothing is watched 0.8 s more, so it answers 0.8 s later.
- A touch on an element under the on-screen keyboard is never typed as a key. The keyboard is closed first, on iOS by the Done of the bar over a web form's keyboard; where it stays open, the touch is refused as `UNSUPPORTED`.
- `open_link` with a web link no app holds answers with the browser and its page, or with the app that takes the site's links, not with the screen it left. It waits up to 3 s for that.
- A screen with no words in its tree, as in the middle of a transition, is read once more before its picture is, so the answer has controls, not picture words.
- A screen's web lines hold only what is on the screen. An inspector that does not answer is not asked again for 30 s, and with no app selected only the app in front is asked; an Android read of a screen with web views went from about 3 s to under 0.1 s.
- A named field says what it holds (`textField "Search" ="shoes"`), never its placeholder; an editable web text area is a field.
- Like elements are told apart by their own row's name, so their refs no longer move when one changes.
- An icon and the text beside it, of the same words, are one target, not `AMBIGUOUS`.
- The screen's text leaves out views that only hold what is listed, and a toggle that holds its own switch is one line instead of four.
- iPhone: a measure whose trace tool keeps not finding the app's process for 240 s says what to do, measure again in a few minutes, where it said the device had not answered and to read the screen.
- In the Mac app's Network pane, saving, removing or switching a rule changes that one rule in the list as it stands, so a rule an AI client added meanwhile is kept, and a change made elsewhere is said. The list says when it shows the latest 200 of more requests. After Stop the list can still be searched, and what needs a running capture is off and says why. The filter finds `failed`, `başarısız`, `5xx`, `mocked` and a request's number (`#12`) in either language, in capitals and without the marks on a letter. A request's detail is in the window's language.

- iOS, by the runner (a real iPhone, and a simulator without its helpers): the first key with a modifier sent to an app that had just started lost its modifier, so `command+a` selected nothing and `shift+arrow_left` moved the cursor without selecting. It now keeps it. This did not depend on the Mac's load: it happened on a simulator no hardware key had reached.
- iOS, by the runner: `type_text` with `replace` lost its select-all in an app that had just started and deleted the old text character by character, which a field that formats what is typed can scramble. It now selects all and deletes at once.
- iOS, by the runner: `delete` with a modifier held (`option+delete`, `command+delete`) did nothing and said nothing. XCTest cannot send it, so `press_key` now refuses it and says to select first, then delete.
- The simulator smoke runs the keys with a modifier again (21 cases).
- A live window on a foldable Android emulator kept the inner display's shape after the device folded: it now follows.
- `tap_screen` on an iOS switch row by its ref or a selector toggles it: the row is touched on its own switch even where that switch stands a little out of the row's frame, as in Settings on iOS 26, and a cell that holds one switch is touched on that switch too.
- **iOS: a screen whose repeated controls keep moving is read fast.** A carousel whose slides carry one id was asked of XCUI at every read, and every read through the simulator's helper went to the runner. The verdict on a control's copies is now kept by the control and the number of its copies, holds while they stand within 4 points of where they were asked of, and is asked again only once moved copies stand still. On the fixture's carousel (iPhone 17 simulator, iOS 26.5) a runner read went from a median 194 ms to 63 ms and a read through the helper from 237 ms to 25 ms. A tap there still waits out its settle.
- **iOS: a release that changes nothing in the runner no longer rebuilds it.** The runner's sources held the release number, so every release, an Android-only one too, cost each iOS user a full `xcodebuild`. The runner now says the digest of its sources in its hello (`checkout` in a checkout's build), and `list_devices` with `selected` shows that in place of a version number on iOS. 1.3.0 builds the runner once more; later releases do so only when the runner changes.
- In the Mac app, two quick presses of rotate no longer leave a device turned: a window's turns go one after another, where a second press while the first waited put back what it saw and left the device in landscape.
- A slow hello no longer ends an agent that another process uses: it is asked once more with 10 s, and left running if still silent.
- An Android agent is restarted as stuck twice in a row at most, as an iOS runner is, and the other processes that used it are told why it went.
- A call waits its turn on a device for 5 minutes at most, then is refused `TIMEOUT` with `dispatched: false`.
- The iOS runner takes a frame of 64 KiB at most before its hello.
- Each error code keeps its own number on the wire. `ErrorCode` is exported by `appdyno` and `appdyno/device`.
- Android: the launcher activity is quoted in every command it goes into.
- **iOS: a tap beside a part that never stops moving settles.** A carousel or a turning banner moved the layout at every read, so a tap on such a screen ran to `maxMs` and answered `settled: false`. The runner and the host's settle of a simulator now learn the part, as the Android agent does since 1.2.0: reads that differ only under one view under half the screen, or, where SwiftUI gives a row no view of its own, only in one strip across it, for 1 s with never 300 ms between two reads, make the part known to cycle for 30 s, and a change under it alone no longer holds the settle. Only a tap, a press or a key with no action in the 3 s before can teach it; a row thrown by a swipe, a slide that ends and a change anywhere else are waited for as before. On the fixture's carousel on an iOS 26.5 simulator a tap took 3.1 s and never settled; a tap that changes the layout now takes about 0.3 s (0.66 s by the runner alone), settled every time, after 1.4 s the first time. A tap there that changes nothing in the layout is watched 800 ms for a system alert, as on a still screen, so a permission prompt that comes after the tap is in the answer. A launch or a link onto such a screen still waits its full `maxMs`.
- A WebSocket task opens with the network probe in the app. The probe took its handshake, and the socket never opened.

## 1.2.0

appdyno 1.2.0 reads what a screen is made of and does more to the app: the native views under an iOS simulator's app or an Android activity, memory warnings, a shake, photos and videos added, and an app ended as the system ends it. A program gets the device itself through `appdyno/device`, desktop installs come as one `.mcpb` file, and a screen with a part that never stops moving no longer slows Android down. It is tested on Xcode 26.5 and Xcode 27.2.

### Highlights

- `screen` with `views` gives the app's native views with their kind, rect and framework, on an iOS simulator by a probe in the app and on Android from the activity, and names what draws the screen: UIKit, SwiftUI, Android views, Compose, Flutter or React Native.
- `device_setting` takes `memory_warning`, `shake` and `media`, `terminate_app` takes `background`, and flows record and replay each of them, so an app's low-memory path, its shake handler, its photo picker and its restore after a background end can be tested.
- Library: `appdyno/device` is the device itself for a program, under semantic versioning, and `connect` shares a held device, stops on an `AbortSignal` and gives the raw tree after an action.
- Each release carries `appdyno-<version>.mcpb`, a desktop extension that installs appdyno with no terminal.
- On Android a screen with a part that keeps moving, as a turning banner, reads in 25 ms where it took 1.1 s, and a tap on it settles in 0.6 s where it ran 4.2 s unsettled.
- `appdyno test --fail-on-flaky`, a recording that says at once when an action will not replay, and photos put back after each file.

### Added

- Flows have three more steps: `screenshot home` keeps a picture of the screen (under a test's artifacts, else `./appdyno-screenshots/`), `visual home [tolerance=] [mask=]...` compares the screen with `baselines/home.png` beside the flow, and `setting dark_mode on` or `setting restore` changes a device setting as `device_setting` does. `appdyno test` and `appdyno flow run` take `--update-baselines` to save the baselines, and a missing one is refused before the first step. A picture step waits until the screen has looked the same for 500 ms, at most 5 s: taken 272 ms after `setting dark_mode on`, a dark baseline was saved light. A recording writes these steps where it wrote `unrecorded`, and the Maestro export writes `takeScreenshot` and refuses the other two with the reason.
- `appdyno test` puts back what each flow file changed on the device (a setting, a fixed location, the rotation lock) before the next file, after each retry too, and a measured file after its iterations.
- On Android, `screen` with `views` gives the native views of the activity in front, read from the system's own dump of it, of any build and with no probe: each view's class, place, resource id and flags, under the framework that draws most of the screen, and after them what they leave out: places under a container that scrolls, a dialog or a menu over the activity, and, where a minified build's shrinker named the views that hold the screen, the framework by what the app ships: Flutter's or React Native's engine, or Compose where a renamed view takes the focus and draws as Compose's own does.
- On an iOS simulator, `screen` with `views` reads the app's native views through a view probe that `launch_app` with `probe` puts in the app and this tool's later launches of it keep until the session ends: each view's class, place, id, label and text, never a secure field's, folded into lines under the framework that draws most of the screen, as `UIKit inside SwiftUI`. An app started without the probe is refused, naming Flutter or React Native where its bundle holds one; a hung main thread is said after 2 s. An iPhone gives no views.
- On Android, `launch_app` with `probe` launches as asked and says that `screen views` needs no probe there; a device that gives no views still refuses it.
- `device_setting` takes `memory_warning`, `shake` and `media`. A memory warning on an iOS simulator reaches every app that runs there, one a call, as Simulator's own menu's does; on Android `value` is the trim level `am send-trim-memory` takes, `RUNNING_CRITICAL` unless given, which Android takes only above the level it last gave the app, and a background level only once the app is in the background: a refusal says which. On an iPhone it goes by `devicectl` to the app's process. `shake` reaches the app in front on a simulator, and on an emulator moves the accelerometer from side to side and puts its reading back; a phone refuses it.
- `device_setting` `media` adds a photo or a video, or a folder of them inside the server's folder, to the device's library: a simulator's Photos by `simctl addmedia`, with how many it then holds, and Android's `Pictures/appdyno`, scanned into MediaStore, with how many it lists. On Android `restore` and the session's end delete exactly the files it pushed, by path and size; a simulator's Photos has no delete, and an iPhone refuses it.
- `terminate_app` with `background` ends an app as the system ends one in the background for memory: home, 1.5 s once it has left the front to save its state, then its process killed, refused where it still runs. The fixture's saved state came back at the next `launch_app`, in a new process, on API 35 and 36 emulators and an iOS 26.5 simulator; a simulator that once discards the saved scene at a launch does so until it boots again.
- Flows record and replay `stop background`, `launch probe`, and `setting shake` and `setting memory_warning` with no value, where a recording wrote a plain stop, ignored the probe or dropped the setting; the Maestro export refuses `background` and `probe` with the reason.
- Library: `appdyno/device`, a second entry point for a program that drives the device itself: `openDevice` reads the screen as elements and touches a point, and `aim`, `select` and `nameOf` give the touch point, selector and naming rules the tools use. It follows semantic versioning; docs/reference/library.md says what a release may change.
- Library: `connect({ share: true })` drives a device another process holds, as `--share` does for a server; `APPDYNO_SHARE=1` asks the same.
- Library: an `AbortSignal` stops a call or a replay (`tool(name, args, { signal })`, `replay(file, { signal })`). It rejects with `CANCELLED`, and `dispatched` says whether its touch went out. A call cancelled while it waited its turn now says no touch was sent, over MCP too.
- Library: `tool(name, args, { raw: true })` adds `nodes`, the tree of the screen the call left, from the read its answer made.
- A desktop extension: each release carries `appdyno-<version>.mcpb`. Open it to install appdyno in an MCP client that takes `.mcpb` extensions, with no terminal and no `npx`; docs/guides/clients.md says which. Its install form takes the devices it may drive, the apps it may touch and the links it may open, each optional. The file is not signed.
- appdyno.dev: a website in English and Turkish, built from `docs/` by the new `site/` package and published to GitHub Pages. Its landing page opens with what appdyno is for beside a real run of it, then one demo where a job's calls play on a phone, a terminal and three dials, three bugs from report to regression test, the Mac app, the open source facts and the questions; the docs share its light and dark colours. Example numbers are marked as examples.
- appdyno.dev: a small dragon roams the landing page. It hops and flies between perches on the top edges of the page's headings and blocks, walks along them, looks at the pointer, scratches, sits, sleeps and breathes a weak puff of fire, sometimes only smoke, and now and then flies across the screen; it follows a visitor down the page and never rests on text or a control. A tap gets a breath toward it or a startled hop, and a number the demo sends to a dial has it fly there and breathe at the number. A button in the corner and one in the footer send it to rest, and it stays at rest on the next visit. With reduced motion, Save-Data or no WebGL the page shows one still picture of it and the scene is not fetched.
- `appdyno test` takes `--fail-on-flaky` beside `--retries`: a run in which a file passed only on a retry exits 1, and its last line names each such file. Without it a flaky file still exits 0.
- While a flow is recorded, an action it keeps no step of (a pinch, a drag, `set_orientation`, a clipboard's text, a push, a click in a web view) says so in its own answer, in a line that begins `not recorded:`, and names the action that is recorded in its place where there is one: `swipe` for a straight drag, `type_text` for a clipboard's text, `tap` for a click in a web view. The end of the recording lists them as before.

### Changed

- On an iOS simulator, every launch appdyno makes of an app carries the probes held in it: `launch_app`, its restart, a flow's stop and launch, perf's relaunch and XCTest's launch metric. The frame probe's relaunch keeps a running network capture, and a restart keeps both: each relaunch dropped the other probe. A session's end or `device_setting restore` lets them go; a probe stays in the running app until it next starts. On Xcode 26.5 the two probes added 33 ms to a launch (median of 20 against 20).
- On an iOS simulator, `network read` says when the app runs as a process the probe is not in, as frames already did.
- A soak suite, `device-tests/soak.test.ts`, holds one session on one device for 30 minutes or more, with crashes, a lost agent, turns and web views among the calls, and writes each tool's success rate, p50 and p95, the recoveries and the slow calls to `soak.json` and `soak.md`. It runs only when `APPDYNO_SOAK_DEVICE` names a device.
- In `appdyno/device`, `launch` waits for the app's first screen to come to rest, as `launch_app` does (its layout held for 200 ms, 3 s at most), and answers `settled`, where it returned nothing. A read right after it on iOS could catch a screen still laying out, and a tap aimed on it opened another row.
- `appdyno test` takes out the photos and videos a file's `setting media` added before the next file, with the conditions it puts back, where the device can take them out (Android). They stayed until the session ended.

### Fixed

- On an iOS simulator, the network and frame probes no longer share one Objective-C class name, so both can be in one app: loaded together, the runtime ran one of the two.
- On Android, a screen with a part that keeps moving by itself, such as a banner that turns, no longer holds reads for a second and settles for three: on an API 35 emulator a read went from 1.1 s to 25 ms and a tap from 4.2 s, unsettled, to 0.6 s, settled. A screen that changes as a whole is still waited for.
- On a simulator, `device_setting` `media` refuses a file that Photos cannot import by its name (`INVALID_ARGUMENT`), with what may help (an H.264 video in an `.mp4` or a `.mov`, a `.png` or `.jpg` photo) and simctl's own line under it, where it answered `INTERNAL` with the last lines of simctl's crash. Each file now goes by a call of its own, so the others of a folder still go in, and the answer says how many.
- On an iOS simulator, `screen` with `views` of an app that does not run, ended by `terminate_app` or before a restart starts it again, is refused with `APP_NOT_RUNNING`, saying that starting it puts the probe in: it said the app ran without the view probe, with `launch_app restart:true probe:true` as the hint, though the probe was held in its launches.
- The `visual` tool takes its picture once the screen has looked the same for 500 ms, at most 5 s, as a flow's `visual` step did, and a replay's step waits once, in the tool: a baseline a recording saved right after a setting held the change under way, and the replay, which waited, failed against it.
- On an iOS simulator, a launch that failed while CoreSimulator was too slow to say where the app is installed says the launch's own failure: `launch_app` answered `NOT_FOUND` "is not installed" after 120 s for an installed app.
- On an iOS simulator, `launch_app` with `restart`, `args`, `env`, `language` or `probe` makes its app the one reads take, as a plain launch does: after a probed launch of one app, `screen views` refused in the name of another app launched before it.
- On an iOS simulator, where simctl's last line only points at the lines above it ("Multiple errors were returned; see stderr"), a refusal gives those lines: `device_setting media` with a WebM now says "File type unsupported.".
- On an iOS simulator, a probe the command line holds (`launch-app --probe`) while a server holds others leaves those to the server, whose end lets them all go: the server's end let none of its probes go, and every later launch of those apps carried them until `device_setting restore`.
- Library: an action stopped by its signal while the app in front was watched for its end rejects with `dispatched: 'unknown'` and says the touch may have been sent: it had no `dispatched`, and the touch had gone out.
- On a simulator, `perf_scroll` and `perf_trace` with `probe: false` say when their frames are by the probe the app already runs under, held in its launches; the perf page says what `probe: false` does: it puts no probe in and relaunches nothing.
- On a simulator, `launch_app`, and the library's `launch`, right after `home` bring the app back: the launch was skipped while the app still read as in front, and the home screen stayed up.
- On a simulator, `press_key` `app_switch` and `siri` whose input helper ended are refused `UNSUPPORTED` with the helper's own reason, not `INTERNAL`.
- `screen` with `views` says when a system alert is in front of the app's views.
- `device_setting restore` and a session's end keep the network probe of a capture that still runs, and restore says so: the capture went on, and the app's next launch was no longer probed.
- `DEVICE_CLAIMED` names the caller's own way to share: `share: true` for the library, where it named `use_device` and `--share`.
- The command line's `launch-app --probe` says its probe stays until restore, or until a server that holds probes on the device ends.
- `device_setting media` given a file that is not a photo or video says so.
- A selector no longer answers `AMBIGUOUS` for a button and its own text that stands a point outside it.
- On an iOS simulator, `press_key` `spotlight` drags the home screen down where Command-Space brought no Spotlight within 3 s, and is refused with `TIMEOUT` where neither opened it: it answered "opened spotlight" over the home screen, about every second time on iOS 26.5 and 27.2 simulators under heavy host load. An iPhone's is as it was.
- On an iOS simulator, `screen` with `views` of an app iOS suspended while its probe answered is refused with `APP_NOT_RUNNING`, as an app behind another is: asked 1 s after `home` on an iOS 27.2 simulator it waited 10 s and answered `TIMEOUT`.
- `perf_profile` leaves the Swift compiler's thunks out of the app's own functions: of an app built with Xcode 27.2 it named a `thunk for @escaping @callee_guaranteed @Sendable () -> ()` the busiest, above the closure that did the work.
- On an iOS simulator, `screenshot` says a prompt that needs a person, as `screen` does: with a Face ID sheet over the app, the picture's answer said nothing. The look costs a picture about 10 ms there; an iPhone's takes none, as before.
- A simulator on a runtime of one model's own, as Xcode 27.2's for the iPhone Duo, is listed with its iOS version: it read "iOS 27.2.iPhone19.4".
- On Android, `screen` with `views` no longer counts the splash screen's window, which the system still lists above the activity for a while after the app has drawn its own, as a dialog over it.
- On Android, `terminate_app` with `background` sends home an app that another app's window lies over, as its permission prompt: it stayed on the screen, and `am kill` ends no app there.
- On Android, `device_setting` `media` takes out MediaStore's row of the `Pictures/appdyno` folder with the folder, and no longer writes over a file there that it did not push: a photo of that name goes in beside it, as `photo-2.jpg`.
- On Android, `screen` and `launch_app` under the assistant's sheet no longer say that the app in front is not answering: they say that the assistant's sheet is in front, to read again in a moment, and that the home key closes it.
- On Android, `launch_app` of an app that ended behind its permission prompt no longer answers "the app died … no crash report": a start only brings the prompt forward, and the refusal names the app in front and says that the app starts once that window is answered or closed.
- `screen` with `views` reads the screen first: on Android a lock that asks for nothing is opened, as `screen` opens it, where the answer was "no view is drawn", and a lock behind a PIN, pattern or password is refused with `DEVICE_LOCKED`.
- A recording keeps a text that finds a tapped control alone: a control and its own text inside it were counted as two matches, so `tap text="For you"` was recorded as `tap id=NiaNavItem index=0 !ambiguous`, an index that names another element where that id's matches differ.
- `appdyno test` and `flow run` with `--update-baselines` save no baseline of a flow whose `visual` step comes after a step that acts on a target picked by its index (`!ambiguous`): the flow is refused before its first step, naming both lines, where it saved the screen another element led to and passed.

## 1.1.3

appdyno 1.1.3 fixes one regression of 1.1.2 on Android: `logs` with no `since` could leave out the newest message.

### Fixed

- On Android, `logs` with no `since` gives as many of the newest messages as `maxLines` asks: since 1.1.2 it left out the oldest message whenever logcat gave as many lines as were asked, so `maxLines` 1 gave no line, as `[]` for a lone `E App: Checkout failed`, and `maxLines` 3 gave two. It now reads 200 lines past the count, so that a message the count begins inside is left out while whole ones are kept.

## 1.1.2

appdyno 1.1.2 fixes what more open-source apps showed after 1.1.1 on iOS simulators and Android emulators. Two of the fixes are about safety: `screen raw` and `find` gave a secret in an element's id uncleaned, and `record` wrote over whatever file it was given.

### Security

- `screen` `raw` and `find` hide a secret the server was told of in an element's id as in its words: `raw` gave `identifier: "account-user@example.test"` beside a label that read `account-•••`.
- `record` `start` writes over no file that is there unless `overwrite` asks, and only to a file of the video kind the device records (`.mp4` or `.mov`): given any path, it replaced whatever file stood there, of any kind. `report` with a `dir` that already holds an `index.html` is refused rather than writing over that page.

### Fixed

#### The iOS runner and simulator

- An iOS runner that answered a read again on a new connection counts its stuck restarts anew, as one that answered on its own connection did: after two stuck restarts, a read retried on a new connection and answered, and the next stuck call left the runner running, as if the two had come in a row.
- On an iOS simulator, a touch that brings another app up, as a link the app opens in Safari, answers once that app is in front and says which app came to the front, and the runner asks no copies of an app that is not the one under test: Ice Cubes' "View in Browser" timed out after 25 s and the runner was restarted.
- On an iOS simulator, the app's crash that XCTest notes late, during the next request, no longer fails that request with `INTERNAL "XCTest: <app> crashed in …"`: with a runner another process started, a link after a crash and relaunch was refused so.
- On an iOS simulator, `webview` finds the pages of an app built with no signature (`CODE_SIGNING_ALLOWED=NO`), which the inspector names by its executable (`process-Fixture`): it said there was no web page to inspect with the page there.
- On iOS, a trace tool that has not said in 90 s that it started recording is stopped then, and `perf_profile` says it did not start, with no word of the Mac's load: a 3 s profile waited 213 s for an `xctrace` that had hung before it recorded.

#### Screen, selectors and touches

- A touch by a selector acts on a window that came in front by itself after the screen was last read, a dialog or a permission prompt, where the selector finds its element there: the touch was refused `STALE`, as aimed at the screen read before, though the selector had been looked up on the new one. A ref or `x`,`y` read before the window came is still refused.
- A hidden element, or one of no size, no longer names the elements beside it in the list: a gallery's grid cells all read `— handleImage`, the label of its fast scroller's 0×0 hidden thumb.
- A selector's `index` past its last match says how many match, with `NOT_FOUND`: it was refused `AMBIGUOUS`, as `1 elements match … index=1`. A `scroll_to` that swiped and then found several says its swipes went: it said `no touch was sent`.
- `scroll_to` swipes once more for an element that the edge its swipes bring things in from cuts to less than half of what its like neighbours show: sideways it said found for a card of which 35 px showed, and a tap on it then missed.
- A touch on a control whose middle is a smaller control of other words goes to a point of it clear of that one, and says where: a tap on a mini player that opens the full player landed on its Pause at the middle and paused. A switch row that holds its own switch, as SwiftUI's Toggle, is touched on that switch: a tap on the row's middle, its label, changed nothing.
- A tap on a ref whose words changed before the touch names it by both, its words at the touch and those it was shown with: NewPipe's answer named the element by its new words beside a diff of that change, as if the tap had renamed it.

#### Android

- On Android, `open_link` with a web link the selected app does not open sends it to whatever opens it, a browser most often, and says the app does not open it; under `--allow-apps` it stays held to the app. A link that does not open is said in words, with `open_link` `links` as the hint: it failed with `am`'s own line, `Error: Activity not started, unable to resolve Intent { … }`, and no hint.
- On Android, `logs` gives a message of several lines whole, a stack's frames joined to its first line, and `maxLines` never starts inside one: NewPipe's answer began with two frames of a throwable.
- On Android, a window animation that WMS answers only at its 5 s cap, one that does not end, of an app in front or behind, holds the first action and no later one, until WMS answers sooner again: with a React Native dev client running behind, every action took some 5 s more (a swipe with no read 5.5 s against 0.6 s, a tap 8.2 s).

#### Apps and the library

- `app install` names the app it installed, by the id the file holds: it said `installed <path>` alone.
- `press_key back` that leaves the app no longer warns "if it crashed": a back that takes the app out of the front is the person's leaving, as home is.
- `react_native` `logs`, and a `reload` through the runtime, send Metro the Origin it asks of a debugger since React Native 0.88 (`http://localhost:<port>`): Metro refused the connection for having none, and the refusal blamed the device and its agent. A runtime socket Metro does not open is said to be Metro's, with its terminal to read.
- The library's `connect` refuses an `allowDevices` that is not a regular expression with `INVALID_ARGUMENT`, saying what it takes: a string from plain JavaScript made every call throw `TypeError: this.policy.devices.test is not a function`.

## 1.1.1

appdyno 1.1.1 fixes what a long run of seven builds of five open-source apps showed on iOS simulators of four sizes and on Android emulators, phone and tablet, and adds `screen raw` for a program that needs the screen's tree itself.

### Highlights

- An iOS runner stays fast and alive: a screen with a control drawn twice under something that moves no longer makes a read take 25 s and more, a runner restarted as stuck twice in a row is left running rather than started again in a loop, and an iPad app read in landscape after a sheet no longer ends the runner.
- `screen` with `raw: true` gives a program every element of the tree, with its rect and its parent, and every ref it gives is one `tap` takes.
- Landscape is read as it shows: a system alert is read and answered where the turned screen has it, a screenshot stands and scales as the screen stands, and `set_orientation` turns a tablet wide as it stands to the shape each name says.
- A selector's text reaches an element's whole words, not only the first 59 characters the list shows.
- On an iOS simulator, `webview` `elements`, `eval` and `click` answer, over one connection to the web inspector, where 0 of 9 calls went through on a Safari page.
- Performance numbers say what they rest on: a frame row timed to end after it was read is left out, a launch median says how many starts it is of, a kernel address is not named as the app's top function, and memory swapped out to zram is said.

### Changed

- `screen` takes `raw: true` and then also gives every element of the tree in its structured answer: its ref, type, words, rect, flags and its parent's index, for a program that drives the device through appdyno and needs the tree itself rather than the folded list a model reads. Its words are cleaned as the list's are, and a password field's text is left out.
- `logs` and `crashes` take `since` as how long ago, `30s`, `5m` or `2h`, as well as an ISO 8601 time: `since: "5m"` was refused.
- `perf_scroll` takes `x` and `y` or a `selector` for the list to swipe, as `swipe` does, and swipes through that list's middle: on an iPad's split view it swiped the pane beside the list and was refused as if nothing moved. Swipes that move nothing on a screen with a scrollable elsewhere say where they went and where that one is.

### Fixed

#### The iOS runner

- On an iOS simulator or an iPhone, a screen with a control drawn twice and something that moves elsewhere, as a turning banner over a grid of cells, no longer makes every read ask XCUI of each copy again: which copy a tap reaches is kept by the copies' places and what is over them, not by the whole screen's layout, and one read asks for at most half a second more of a few groups (always of one), leaving the rest to the next read. On such a screen a read took 25 s and more, past the 15 s a read has, and taps 15 to 27 s.
- A runner that answers a quick call with its own TIMEOUT, as one does when the call came too late to start, is not taken for stuck and restarted: only no answer at all is stuck.
- An iOS runner restarted as stuck twice in a row, with nothing answered between, is left running at the third: a screen that held every new runner as it held the last made a loop of them, a start and then 15 s of nothing, 13 times in one session. The timeout says the runner was left, and why.
- On an iPhone, a runner restarted as stuck is no longer first asked to shut down: the ask waits on the lane that is stuck, and each restart spent 6 s on it for nothing.
- On a simulator, a runner started in place of the helper says why the helper was not used when that was a refusal, a turned screen or no screen size: the reason was left empty, and a failed start ended its message with "after the simulator's helper did not answer: ".
- On iOS, `press_key` `delete` or `tab` with no field focused and no keyboard up is refused with `NO_FOCUS`, as `type_text` is: XCTest's own typing failed the runner's test and ended it, and the call answered `AGENT_UNAVAILABLE` with a hint to try once more, which ended the next runner the same way (3 of 3, on Wonderous and NetNewsWire). With a field focused they type as before.
- A new iOS runner keeps the last one's log as `ios-<udid>.log.1` in the state folder, and the line that says another runner took the last one's place says why the last was taken as gone, where the process knows: five such lines on an iPad had left no trace of why.
- On an iPad, a runner reading an app in landscape after a sheet or an alert dimmed it no longer ends: XCUI could not tell whether a copy of the dimming overlay on the screen's edge could be touched, and that failure ended the runner's test whatever `continueAfterFailure` says. NetNewsWire replaced its runner at 8 of 9 calls, 7 to 11 s each; a copy XCUI cannot tell of now stays shown, as on a screen with no copy, and 0 of 30 reads replaced it.

#### Screen, selectors and refs

- A selector's text reaches an element's whole words: it matched only the first 59 characters the list shows, so `find`, `tap`, `wait_for`, `assert`, `scroll_to` and flows missed a word further along a paragraph ("Nabataeans" in Wonderous's Petra history read `not found`, and `scroll_to` swiped past it six times). A cut label a flow kept still matches, and an element whose label shows the words comes before one that holds them only past its cut, as a panel named by every row inside it, which took a tap meant for a row. A run of spaces in a text matches one typed.
- Every ref `screen raw` gives is one `tap` takes: one the list leaves out, as a container, a navigation bar or a window, is tapped at its middle, where it was refused as stale. A nameless control inside a named one at its point, as Now in Android's check boxes, now has a ref too (11 of 77 had none). A flow records such a tap as what is at that point. A stale refusal always says what to do: its hint was empty.
- `appdyno screen --raw` prints the tree's elements after the screen, one JSON line each: it printed only the folded list.
- A screen's answer says a web link once, not again as its text (`tappable "Constantinople"` and `text "Constantinople"` at one point), a footnote as `[b]` alone, an element the app gives twice in one box once (NetNewsWire's scroll bar, an iPad alert's texts), and an alert's title once, at the title. A row named by the words inside it says a name that comes right after the same once: "Search Wikipedia Search Wikipedia Voice input search" reads "Search Wikipedia Voice input search", and "Headlines Headlines" reads "Headlines"; a value with no letter or of one character, as a score of 3 to 3, stays as it is.
- A `wait_for` that runs out names what it waited for, as one in `steps` does. A tap or `scroll_to` that found its text only as a part of a paragraph says so: `tap {"text":"Home"}` tapped "of over 15 million, it is home to 18% of the" with no word that nothing read "Home" alone.
- An action that changed nothing, whose diff lists a change the screen had before it, says so: it said `no change seen` above a `screen changed` list.
- A pinch that changed no element says a zoom may change only the picture, which `screenshot` shows: on a photo that zoomed it said only `no change seen`.
- `scroll_to` sideways turns a carousel past its next card where nothing the screen lists lies on the finger's line, as Wonderous's cards on an iOS simulator, drawn as one picture with their names below: only what that line crosses said the list moved, so every swipe read as still, and a card two to four away answered `NOT_FOUND … the list did not move after 2 swipes` (5 of 5), once with that card in its nearest. With nothing listed on the line, what changes in the list's box says; a row on the line is still judged by itself alone. A swipe whose read holds the target answers `found`.

#### Landscape and screenshots

- A screenshot's scale to tap units, its `width` and `points`, and the screen `device_info` and `use_device` give are of the screen as it stands now, which the device is asked: they were of the screen as the agent's hello found it at the connect. On an Android phone turned to landscape, 2400x1080 in tap units, a picture at full size said its pixel was tapped at x × 0.450, the 1333 px image at x × 0.810, `width: 600` gave an image 1333 px wide, and `device_info` said `screen 1080x2400, rotation 0`. A picture that stands otherwise than the screen gets no scale, and the answer gives the screen's size instead.
- On an iOS simulator, a picture taken in landscape stands as the app in front does, and its scale and `device_info`'s rotation are of the screen as it stands: the picture was portrait with the app sideways in it, said to be tapped at `x/3` on an iPhone and `x/2` on an iPad, and an iPad in landscape said `rotation 0`.
- `screenshot` with `file` saves the picture as wide as `width` asks, or a pixel to a tap unit with `points`: it saved it at full size whatever was asked.
- `set_orientation` turns a tablet wide as it stands, as a Pixel Tablet, to the shape each name says, as Android's own portrait and landscape are: both landscapes turned it tall, 1600x2560, and `portrait` left it wide. The note that the window kept its shape is judged by the screen the answer lists: a turn slower than the 3 s wait for it was said to have left the window wide above a listing that was tall.
- `set_orientation` with an app other than the one under test in front, as the home screen, says so, and that the app may come back turned its own way: it said only `orientation: portrait`.

#### System alerts and links

- On iOS, `alert`'s answer to a system alert over an app, and a `tap`, `double_tap` or `long_press` that closes one, read that app once it is in front again: as the alert goes, the home screen app is in front a moment, showing only the app's card in its switcher, and the answer was that card, with a warning that the app was not in the foreground (5 of 5 for `alert`, 3 of 3 for a touch).
- The warning that the app is not in the foreground names the app expected beside the one in front.
- On an iOS simulator or an iPhone in landscape, a system alert is read where the screen shows it: the home screen app keeps its windows upright, and the alert's frames were given as they stand there. An iPad's notification prompt listed Allow at 356,664 where the picture had it at 664,465, an iPhone's listed no Allow at all, and `alert` said `answered the system alert: "Allow"` while the alert stayed (3 of 3). `open_link` now answers a link's "Open in …?" in landscape too, where it said `the system asks` after 16 to 19 s.
- A system alert is read once when the runner's app is the home screen app: `find text=Open` gave `@4q51` and `@4q51-2` at one point, and a location prompt listed 12 elements for 6.
- On a simulator, `open_link` with a link in the selected app's own scheme answers its "Open in …?" and says so. Where the simulator's input helper finds no input service, the touch that answered it went nowhere and the call said `sent` after 15 s (4 of 4); it now goes by the runner, which reads the prompt itself before it touches Open, so that it answers in landscape as in portrait (12 of 12 on an iPhone in either landscape, from the command line and a library session). With the app already in front, the first look came before the prompt; the app is now watched for a second for it.
- On Android, `open_link` `links` writes a wildcard host with its `*`, `https://*.wikipedia.org/wiki/*`, and each path as it matches: a glob as it is written, a prefix with one `*` after it and a suffix with one before. It printed `http://.wikipedia.org/wiki/*` and `/zh.**`, and left out a glob that holds a `}`.

#### Web views

- On an iOS simulator, `webview` `elements`, `eval` and `click` answer: they read the pages on one connection to the simulator's web inspector and ran the script on a second, which the inspector serves only some 10 s after the first closed, while appdyno waited 5 s; on a Safari page 0 of 9 calls went through. One connection now serves a call and the calls in the minute after it, and a new one is waited for as long as the inspector takes, up to 15 s and once more on a fresh connection. On the command line, where each call is a process of its own, a call within 10 s of the last still takes up to those 10 s. The timeout names the inspector and says to ask again, where it said the device did not answer. `screen` waits at most 3 s for a web view's page, and says when it left it unread.
- On the command line, `screen` on a screen with a web view ends as soon as it answers: a call within 10 s of the last took 10.4 to 10.7 s, as the process waited for the web inspector to serve a connection nothing needed any more. Such a call still leaves the page unread.
- On an iOS simulator, `webview` `pages` marks only the tab that shows as `(showing)`, by what each page's own document says, and `webview` and `screen` read that one: every Safari tab was marked, and the first was read, shown or not.
- `webview` with no page to inspect says that a page that is loading is listed once it has loaded, and to ask again; a `page` that matches none listed is said to go by its new title and URL if it loaded another.
- On Android, `webview` `pages` lists a page once: the system lists a web view's socket once more for each connection made to it, appdyno's own just-ended ones among them, and each was asked, so calls a few seconds apart listed one page 1, 2, 4, then 17 times, each slower than the last. Reading the pages no longer keeps its connection open once its port is gone.

#### Apps, crashes and logs

- `launch_app` of an app that ends as it starts is refused with `APP_NOT_RUNNING`, the crash report's reason and the app's last log lines, whatever `read` is and whichever app is selected: with `read: none`, or with another app selected, it said `started` (6 of 10, Wikipedia aborting at its launch), and a report written while the launch waited was not found. On a simulator such a launch answers in about 6 s, not 15 to 25.
- `launch_app` of an app that ends as it starts, and an action the app dies under, name the report of the app's own crash at that moment, by the time the report itself gives: they went by the file's time, which macOS moves on for an old report at each new crash once it keeps 25 of the app's, so 11 of 16 launches of Wikipedia named a report three hours old, and 3 its widget extension's. Where macOS keeps no more of the app's reports, the answer says so rather than waiting for one. `crashes` `since` goes by each report's own time too.
- An app's log line that says why it died is given whole, up to 1,000 characters: an uncaught exception's reason was cut at 200, before its words.
- `crashes` gives an uncaught exception's report by where it was thrown, not by the abort that ended the app, and on an iPhone the exception's reason after the signal.
- On Android, `app` `list` names an app with two launcher activities by its own, the first, which `launch_app` starts: Wikipedia's debug build was named "Leaks", the name of the activity LeakCanary adds.

#### Performance

- `perf_snapshot` and `perf_scroll` leave out a frame row timed to end after it was read, and say how many: an emulator times some frames to end 2^56 ns on, and Now in Android's worst second read `mean 3836934962.6 ms` (Wonderous's 14410861859.9 ms). It now reads 163.3 ms, with 2 frames left out. In `perf_scroll` such a row was also a frozen frame.
- `perf_launch` says how many starts its median is of where the system timed the others as another state: a cold run on a loaded emulator answered `? ms (UNKNOWN), 9654 ms (COLD), 5428 ms (WARM)` and `median: 9654 ms`, with no word that it was of 1 start of 3. `launch.ttfd_ms` keeps only those starts.
- `perf_scroll` that judged nothing says how many frames the app's own surface drew in a round: it gave the 127 SurfaceFlinger keeps of any age, which read as a surface drawing well where it drew 3 to 5 a second. `perf_trace` says of a timeline of few frames that the app draws on its own surface: of a Flutter app it said `0 frames` and no more.
- `perf_snapshot` says when most of the app's memory is swapped out to zram, which its Java and native heaps leave out: Wikipedia on a loaded emulator read `PSS 191.0 MB, Java 0.0 MB, native 0.6 MB` with 136.3 MB of it swapped.
- `perf_scroll` names as the app's top function the first that is not a kernel address, and `perf_profile` says what such a line is: on an emulator, which hides the kernel's names, `[kernel.kallsyms][+ffffffc07a5f3500]` at 40 to 60 % was named the app's top function. Shares read `59.91%`, not `%59.91`.
- Each refusal of `perf_query` says why and what to give, as does `perf_trace` `what: hangs` where a device has no such trace, XCTest's metrics, the probe where a device has none, and `dsym` on Android: several were refused with no hint, and a Perfetto trace asked with `table` with no word that `table` is for an Instruments trace.
- A trace Xcode's trace tool did not finish recording by itself, and then cannot read, says the tool did not finish and when it was stopped, and asks for a quieter Mac only where this Mac's load is high: at load 4 to 8, `perf_profile` blamed the load after 244 s of a hung tool.
- `perf_query` given what is not a kept trace, as a measurement's id, is refused with `INVALID_ARGUMENT`, not `POLICY_DENIED`, with a plain hint.

#### Evidence and settings

- `report` `stop` with the flight recorder and a report both open ends both, and writes the report: it said only `flight recorder off, 0 kept`, and the report took a second `stop`.
- `record` `stop` says how long the file plays: a simulator writes no frame while the screen holds still, and the answer gave its frames' time, 8.3 s of a file that plays 9.9 s.
- `audit` names an issue's kind once where its rule says no more: `textClipped XCUIAccessibilityAuditType.textClipped` reads `textClipped`.
- `device_setting` reading an app's `locale` that none holds it in says `none set`, and `device_setting restore` names a condition that read empty before by its name alone: each said `locale: ` with nothing after it.

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
