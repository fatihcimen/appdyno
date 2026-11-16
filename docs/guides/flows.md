# Flows

[Türkçe](flows.tr.md)

What an agent does once can run again with no model, on this device or another, and in CI.

```sh
appdyno run-flow record           # or the run_flow tool, action record: every action from here on is logged
appdyno tap-screen --json '{"selector":{"text":"Form"}}'
appdyno run-flow stop login.flow  # saves the flow, and prints it with any step to look at
appdyno run-flow run login.flow --param PASSWORD_INPUT=... --from 3
appdyno test flows/ --tag smoke --env-file ci.env --retries 1 \
  --device emulator-5554 --device <udid> --artifacts out --junit out/junit.xml
appdyno run-flow export login.flow > login.yaml
```

A flow is a text file, one step per line:

```text
app dev.appdyno.fixture
tag smoke login
param NAME
secret PASSWORD_INPUT

stop
launch
tap role=button text="Form"
type "${NAME}" id=name_input replace
type "${PASSWORD_INPUT}" id=password_input
tap id=submit
assert id=result check=text equals="Sent: ${NAME}"
tap id=add_button index=1 !ambiguous
```

| step                                                                                                                               | runs                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `launch [app] [language=] [arg=] [env=] [probe]`, `stop [app] [background]`                                                        | `launch_app`, with `args` or `env` for `arg=` or `env=`, `manage_app stop` |
| `tap`, `long_press [durationMs=]`, `double_tap`                                                                                    | `tap_screen`, with `holdMs` or `count: 2`                                  |
| `type "text" [target] [replace] [submit]`                                                                                          | `type_text`                                                                |
| `press_key back [count=]`, `swipe up [target] [distance=] [durationMs=] [exact]`, `scroll_to <selector> [direction=] [maxSwipes=]` | `press_key`, `swipe_screen`, with `until` for `scroll_to`                  |
| `wait_for <selector> [gone] [timeoutMs=]`                                                                                          | `check_element` with `timeoutMs`                                           |
| `assert <selector> [check=] [equals=] [min=] [max=] [expect=false] [timeoutMs=]`                                                   | `check_element`; `check=count` is the run's own read                       |
| `open_link "url"` or `open_link settings=`, `set_location 41.0 29.0`, `alert allow`, `hide_keyboard`                               | `open_link`, `set_device`, `answer_alert`, `press_key`                     |
| `screenshot home`, `visual home [tolerance=] [mask=]...`                                                                           | `take_screenshot` with `file`, `check_screen`                              |
| `setting dark_mode on [app=]`, `setting shake`, `setting restore`, `setting orientation landscape_left`                            | `set_device`                                                               |
| `mock api.example.com/items* status=503 [body=] [fail=] [to=] [delayMs=]`                                                          | `capture_network` with `mock`                                              |
| `request "/v1/profile" [method=] [status=] [has=] [timeoutMs=]`                                                                    | `capture_network` with `check`                                             |
| `network strict`, `network strict off`                                                                                             | `capture_network` with `strict`                                            |
| `run shared/login.flow`                                                                                                            | that file's steps, in place                                                |
| `drag <target> to="120,640" [holdMs=] [durationMs=]`, `drag <target> to="id=bin"`                                                  | `swipe_screen` with `to`                                                   |
| `push alert title="Hi" [body=] [image=] [data=key=value]... [payload=] [app=]`                                                     | `send_push`                                                                |
| `web_click "#pay" [page=]`                                                                                                         | `inspect_app` with `web_click`                                             |
| `clipboard "text"`, `clipboard equals="text" [timeoutMs=]`, `clipboard contains="text"`                                            | `set_device` with `clipboard`; a check is the run's own read               |
| `audit [types=] [max=]`                                                                                                            | `check_screen` with `accessibility`                                        |
| `only ios <step>`, `only android <step>`                                                                                           | that step, on that platform alone                                          |
| `prepare seed-user [gives=NAME]...`                                                                                                | the project's own command of that name: [Preparing data](#preparing-data)  |

A selector is any of `id=`, `role=`, `text=`, `index=`; text matches as it does in the tools. `launch` takes a `language=`, an `arg=` for each argument, an `env=NAME=value` for each variable and `probe`, as `launch_app` takes `language`, `args`, `env` and `probe`. `stop background` ends the app as the system ends one in the background, as `manage_app stop` with `background` does.

A `#` starts a comment, to the end of its line. Where a step takes a target, `tap`, `long_press`, `double_tap`, `type`, `swipe` and `drag` also take `x= y=` with `screen=` and `!coordinates`, which a recording writes where nothing names the place. A `ref=` is refused, as a ref names an element for one session only. Four flags mark a step to look at: `!ambiguous`, `!coordinates`, `!running` and `!review`, each explained in [Recording](#recording).

## Recording

A recording logs each action that succeeded, with a selector that finds its target alone on that
screen at that moment: the id, else role and text, else text. A control and its own text inside it are
one target there, as they are to a tap. Refs never reach the file. What nothing
finds alone keeps its index and is flagged `!ambiguous`. Only a point on no element, a slider or a large
area stays as coordinates, flagged `!coordinates` with the screen size they hold for; a screen of another
size refuses that step. A role is kept when both platforms name it alike (`button`, `textField`...), and
Android's own ids (`android:id/button1`) are not kept. An action with no step (a pinch or free paths of `swipe_screen`, a script run by `inspect_app` `web_eval`)
is written as `unrecorded "..."`, where a replay stops, so that it cannot pass without it. Its own answer says so at once, in a line that begins `not recorded:`. A `swipe_screen` with `to` is `drag`, from its target to where it was let go: an element where the call named one that a selector finds alone, else a point, flagged `!coordinates` with the screen size. A `send_push` that sent something is `push` with its type and fields, and one that only listed the types is nothing. A `set_device` `orientation` is `setting orientation`, put back with the settings a file changed. An `inspect_app` `web_click` is `web_click` with its CSS selector, and with `page=` where the call named a page by its title or URL. A `set_device` `clipboard` with a value is `clipboard`, and a read of it is nothing. A `check_screen` `accessibility` is `audit` with `max=` at the count it found, flagged `!review`, because that count is what the screen held, not what it should hold: set it. A `capture_network` `mock` that sets rules is a `mock` line for each, while its other actions that change something are not recorded. A `set_device` given a value is `setting`, as are `shake` and `memory_warning`, which need none, and its `restore` is `setting restore`; a `manage_app stop` with `background` is `stop background`; a `check_screen` `visual` is `visual` with its tolerance and masks, which a replay compares with the flow's own baselines, so run it once with `--update-baselines`; a `take_screenshot` saved to a file is `screenshot` with the file's name. A measure is the agent measuring, not the journey: what it did to the screen stays, as the plain steps that do the same (`measure_performance launch` cold: `stop`, `launch`; `measure_performance scroll`: its swipes), and it stops no replay. A `launch_app` that started the app is written as `stop`, `launch`, so that a replay starts it anew too; one that brought a running app to the front is `launch !running`, as a replay goes on from the screen the app is on then. A `launch_app` with a `language` is `launch language=tr`, so that a replay launches the app in it too; it restarts the app, so it is not flagged. A `launch_app` with `restart`, `args` or `env` stops a running app before it starts it, on every platform, so it is written as `stop`, `launch` with its arguments and environment, whether the app ran or not. A `launch_app` with `probe` is `launch probe`, after a `stop` where the probe started the app anew. `run_flow stop` and
`run_flow save` list every step to look at.

A value the agent typed or read becomes a parameter by `params` on `run_flow record`, `stop` or `save` (`--param NAME=Grace` on the command line): in every step that typed or read it, before or after, it becomes `${NAME}`, declared `param NAME`, and `run_flow run` takes its value in `params`. A name no recorded step holds is refused at `stop` and `save`. `stop` with `file` saves as `save` does, and `save` writes the last recording again. `save` writes the file inside the folder the server runs in or its state folder, as `export` `to` does: a path elsewhere, or one a link leads out of them, is refused, and so is a file that is there, unless `overwrite`. It answers with the file it wrote.

## Secrets

Text typed into a password field, and text in `APPDYNO_SECRETS`, become a `secret` by name:
the field's id, or `SECRET_1` for the first of `APPDYNO_SECRETS`. From then on the same text anywhere else,
such as a label that shows it back, becomes that name too. The file never holds a value. Neither does the
recording kept between commands, which holds a salted digest. `param` and `secret` values come from
`--param` (`params` in the tool), then `--env-file` (`envFile`; `NAME=value` lines, as a `.env` file has them, kept out of the repository by you), then, on the command line and in the library, the environment variable of that name; `$${` is a literal `${`. A server takes nothing from its own environment, which is no flow's to type, and hides each value a run took from an env file, as a secret, from then on. A secret
is hidden from a replay's answers, report and saved tree. A screenshot shows what the screen shows, so a
secret typed into a plain field can be seen in it.

## Replay

A replay runs each step through the same operation an agent calls, with its settle. A target must hold its
place for 300 ms before it is touched, because a list still coasting takes a touch as "stop". A target gets 10 s to
come, an `assert` 10 s to hold (`timeoutMs=` changes it); then the run stops. A second try or a near match would be a guess. A failure gives `file:line`, the step number, the nearest candidates and the screen. Several
matches refuse too. A step during which the app died fails with the crash's reason. A flow's lines are all
checked before its first step acts, and a missing value is refused by name before anything runs. Each step's
time from action to settled is in the answer and the report: the device's own time for a tap or a key, all of
the step for `launch`, `open_link` and `scroll_to`.

## One file for two platforms

`only ios` or `only android` before a step keeps it to that platform. Alone on a line it opens a block that `end` closes, and before a `run` it keeps every step of that file:

```text
launch
only ios tap text="Allow Once"
only android
  press_key back
  tap text="While using the app"
end
only android run shared/android-intro.flow
```

On the other platform the step is skipped: nothing of it reaches the device, it needs no value and no baseline, it keeps its number, and its line in the results reads `skipped, ios only`. The device decides, never what the screen shows, so the same file takes the same path on every run on one platform. A flow with no step left for the device's platform fails, as nothing ran. A file run for one platform may not hold a step for the other. There is no optional step, no repeat and no retry inside a flow, and no condition on what the screen shows: each would let a run pass by a path nobody wrote.

## Counts, the clipboard and an audit

Three checks beyond an element's own:

```text
assert id=row_name check=count equals=3
assert role=button text="Add" check=count min=1 max=20
clipboard "TR33 0006 1005"
clipboard equals="TR33 0006 1005"
clipboard contains=0006 timeoutMs=2000
audit
audit types="contrast,hitRegion" max=2
```

`check=count` counts every element the selector names on the screen as read (rows scrolled out of a lazy list are not there), and holds the count to `equals=` or between `min=` and `max=`; an `index=` is refused. `clipboard` with a text puts it on the device's clipboard, as `set_device` with `clipboard` does, which refuses a secret. With `equals=` or `contains=` it checks what the clipboard holds. Both checks wait as an `assert` does, 10 s unless `timeoutMs=` says otherwise, and fail with `CHECK_FAILED`, saying how many matched or what the clipboard held, a secret hidden. A real iPhone's clipboard cannot be read, so the check fails there in the device's own words. `audit` runs the screen's accessibility audit, as `check_screen` with `accessibility` does, and fails when it finds more issues than `max=`, 0 unless given, or when the audit was cut short; the failure lists the first of them. `types=` names the kinds, by commas. The count and the clipboard check are the run's own reads of the device: the tools have no such check.

## Running flows in CI

`appdyno test` runs files or directories of `.flow` one at a time on each `--device` in turn. After a failure it goes on to the next file. It exits 1 if the run's verdict is FAIL or if there was nothing to run. Assertions are steps. What it leaves under `--artifacts` (default `appdyno-artifacts`) is [the run's report](#a-runs-report).

## A run's report

A run ends in one verdict, PASS or FAIL. The verdict is FAIL when a file failed, when a teardown failed, or when `--fail-on-flaky` met a flaky file. The run leaves these in its artifacts folder:

| file               | what                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `verdict.txt`      | The first line is the verdict and the counts, as `FAIL: 38 passed, 1 flaky, 1 failed on 2 devices in 6m12s`. A failed run's next line starts with `because:`. Then comes a line for each file that failed, was flaky or left a teardown failed: its device, its error, its picture's path and the command that runs it alone. After 30 such lines it says how many more the page has |
| `index.html`       | One page for the whole run: the verdict, the app, the commit and the devices, what the folder holds, every file against every device, then each file to look at with its step, its error, its picture and the command that runs it alone. Files that passed are folded                                                                                                               |
| `run.json`         | The record the other files are written from. It is kept after each file, so a run that is killed leaves what it finished                                                                                                                                                                                                                                                             |
| `junit.xml`        | A suite per device and a case per file. `--junit` puts it elsewhere                                                                                                                                                                                                                                                                                                                  |
| `pr.md`            | The verdict, the files to look at, the commit, the devices and the rerun commands as Markdown, for a step of your CI to post on a pull request. `--pr-body` puts it elsewhere                                                                                                                                                                                                        |
| `<device>/<file>/` | What a failure left: `screen.jpg` or `screen.png`, `tree.json`, `log.txt` with the app's last 200 log lines, and `crash.txt` when the app crashed during the run. A retry's files are under `attempt-<n>/`                                                                                                                                                                           |

The record says what the run tested and on what:

- the commit and the branch, from git, and whether tracked files had changes;
- the CI run, from the `GITHUB_*` variables where they are set;
- each device's model and OS, and the conditions `locale`, `dark_mode`, `text_size`, `orientation` and `animations`, read once when the run opened the device;
- for each file, the conditions appdyno had changed and not yet put back when the file began;
- the installed app's version, and on Android its version code.

The command that runs a file alone names the file, the device and the `--env-file`. It never holds a value given by `--param`. The names are listed beside it, for you to set in the environment or in an env file.

The failure's picture is painted over where an element is a password field or holds a secret. It is `screen.png` when something was painted and `screen.jpg` when nothing had to be. Three things are not painted: text the app draws with no element behind it, a picture a `screenshot` step saved, and a video. When the screen cannot be read at the failure, no picture is kept. In the tree and the log lines, listed secrets and what looks like a credential are hidden. The page lists what the folder holds, so read that list before you send the folder to anyone.

JUnit names each of a failure's files in two forms, because the CI systems that show attachments read different ones: a property of the case called `attachment`, and a line `[[ATTACHMENT|path]]` in its `system-out`. The path is relative to the folder the command ran in. Each case also has the properties `appdyno.device`, `appdyno.commit` and `appdyno.rerun`.

`--no-report` writes `run.json` and JUnit alone.

## Splitting a run across CI jobs

`--shard i/n` runs one part of the files and leaves the rest to other jobs: `appdyno test flows/ --shard 2/4` runs the second of four parts. The split reads nothing of the machine, so every job makes the same one. The selected files, after `--tag` and `--exclude-tag`, are put in the order of their paths under the folder they share and dealt in turn: the first to part 1, the second to part 2. A file's `_setup.flow` and `_teardown.flow` run around it in whichever part it falls to. The part is named in the first line of the output, in `verdict.txt`, on the page, in `run.json` and in JUnit, as the name of `<testsuites>` and as the property `appdyno.shard` of each case.

A part that no file falls to runs nothing, opens no device and exits 0. That happens when there are more parts than files. A run that selects no file at all still exits 1. A `--shard` that is not `i/n`, with `i` from 1 to `n`, exits 2.

When every job has run, `appdyno test merge part-1 part-2 --out report` makes one run of their folders. It copies the files each failure left into `--out` and writes one `run.json`, `verdict.txt`, `index.html`, `junit.xml` and `pr.md` over them all. It exits 0 when the merged verdict is PASS and 1 when it is FAIL. The merged verdict is FAIL when any part failed. It is also FAIL when a part of the split is not among the folders, because what never ran is no pass: the `because:` line names it, as `shard 2/4 did not run`. Two jobs' emulators may have the same serial, and their files merge under it.

`merge` exits 2 and writes nothing when the folders cannot be one run:

- two of them hold the same file on the same device;
- two of them are the same part, or they are parts of different splits;
- they are of different commits. `--allow-mixed` merges those all the same.

## Sending a report to someone

appdyno uploads nothing. `appdyno test share <dir>` prints what a run's folder holds, the least hidden first:

```
This folder holds:
  2 videos, NOT painted: anything shown on screen is in them, typed passwords included
  14 pictures: a failure's is painted over where an element is a password field or holds a listed secret (3 had one); text drawn with no element behind it is not, and neither is a picture a screenshot step saved
  3 screen trees, 5 log tails and 0 crash reports, with listed secrets and what looks like a credential hidden
  0 network captures
  41.0 MB. Listed secrets: 2.
```

`--zip file` packs the folder into one file, and the folder itself is not changed. `--without video,logs,trees` leaves those kinds out of the copy, where `logs` are the log lines and the crash reports. The copy's page, record, verdict and JUnit are written again, so they name no file the copy lacks, and the page says what was left out. A folder that holds a video is not packed until you say `--without video` or `--with video`, because a video is not painted. `appdyno test` records no video itself: one is counted when something else put it in the folder.

`appdyno test comment <dir>` writes `pr.md` again from the folder's `run.json`, or to the file `--out` names.

## Mock rules

`mock` sets a rule for the app's requests on a simulator, as `capture_network` with `mock` does, and the line after `mock` is the rule as that tool takes it:

```
mock api.example.com/v1/items* status=200 body=@items.json
mock api.example.com/v1/pay method=POST fail=timeout
mock "*.example.com" regex="/v\\d+/profile" query="lang=tr" status=404 body="{}" header="X-Test: 1"
mock cdn.example.com to=http://127.0.0.1:8080 delayMs=300
launch
```

The first word is the request: a host, with a path after it, where `*` is any run of characters, or `*` alone for every request; `regex=` is a pattern for the whole path in place of one, `method=` one method, and `query=` pairs the request's query must hold. `has=` is what the request's body holds, a value by its path where the body is JSON (`has=operationName=Cart`, `has=variables.items[0].id=7`) or any text of it, and `when="Name: value"` a header the request carries, with `*` in the value; each may be given more than once, and all must hold. So one GraphQL address answers each operation apart: `mock api.example.com/graphql has=operationName=Cart body=@cart.json`. A body sent as a stream is read for `has=` only up to 64 kB. Then what the rule does, one of three: an answer of its own (`status=`, 200 if left out, `type=`, a `header=` for each header, and `body=`, where `body=@file` is a file beside the flow, inside the folder the run started in); `fail=offline`, `timeout` or `reset`; or `to=`, another host the request is sent to. That host is one on this Mac or its own network (`127.0.0.1`, `10.…`, `192.168.…`, `name.local`), as a request goes there with its cookies and tokens; any other needs the server started with `--allow-urls` naming it. A bare `to=localhost:8080` is `http://127.0.0.1:8080`: a local server seldom speaks TLS, and an app is let through to an address where a name may be refused. `delayMs=` waits before any of them, or alone before the real request; `times=` lets a rule run out, and `off` keeps it without effect. The first rule that takes a request wins.

Two patterns come up often. A request that fails once and then works, as a retry must survive, is one rule that runs out: `mock api.example.com/v1/pay fail=timeout times=1`. A run in which nothing leaves this Mac says so once: `mock unmatched=fail` fails every request no rule takes, as with no network, and the list marks each `[failed: no rule took it]`.

A run can replay what was recorded. `network` `read` with `save` keeps a capture's answers as a HAR file, and `mock from=checkout.har` makes a rule of each answer in it, the file found from the flow's folder: a request asked twice is answered as it was last, one asked with several queries has a rule for each, and the bodies are written to `appdyno-network/checkout/`, which is to be kept out of git as the HAR is. So `mock from=checkout.har unmatched=fail` runs a flow with no server, and fails it on the day the app asks for something the recording lacks. A HAR this tool saved has what names a credential hidden (`•••`), and that is what a rule made of it answers with: a login that must return a working token needs a rule of its own. At most 50 rules hold at once.

The rules go into the app by the network probe, so the first `mock` starts a capture by it where none runs, which restarts the app: put the `mock` lines before `launch`. A rule holds until its file has run, on a pass and on a failure, and then that rule alone is taken out: one set before the run, by an agent or in the Mac app, stays. The capture runs on until `capture_network` `stop` or the session's end. Only the app's own URLSession requests are taken: not a web view's, not a background session's, and the system still reads the Mac's network as it is. An Android device and an iPhone refuse the step.

## Requests that fail

While a capture by the network probe runs on a simulator, a step under which a request of the app's failed says so among its warnings, one line for each: `network: POST api.example.com/v1/pay 500 (id 44)`. A request counts when the server refused it (4xx, 5xx) or it failed on its way; one the app itself gave up does not.

`network strict` makes that a failure: from that line on, a step fails when a request got a 5xx or failed on its way and no rule made it, so a flow that passes on the screen while a call behind it broke does not pass. A 4xx, and what a `mock` rule answers or fails, stay warnings. `network strict off` ends it, and so does the end of the file. It starts a capture by the probe where none runs, which restarts the app, so put it before `launch`. A request is looked at when the step it happened under ends: one that fails later fails the next step, and says it came before it.

`request` passes when the app made a request that fits, and waits for one that has not come yet, 10 s unless `timeoutMs=` says otherwise: `request "/v1/profile" method=PUT status=2xx has="name=Grace"`. The first word is a part of the address; `status=` is one status, a class of them (`2xx`) or `failed`; `has=` is what the request's body holds, a value by its path in a JSON body (`user.name=Grace`, `items[0].id=7`) or any text of it, and `has="response: ok=true"` asks the same of the answer's body. `has=` needs a capture that keeps bodies (`network` `start` with `bodies`). Only requests since the run began count, so one from before it cannot pass the step. A miss names the request that came nearest and what of it differed: `nearest: PUT api.example.com/v1/profile 409 (id 52): 409, not 2xx`.

## Screenshots, visual checks and settings

`screenshot home` saves the screen as `home.png`: in `appdyno test` under `<artifacts>/<device>/<file>/`, beside what a failure leaves, and in `run_flow run` under `./appdyno-screenshots/`. A run again takes it anew.

`visual home` compares the screen with `baselines/home.png` in the folder of the flow's file, as `check_screen` `visual` does; a step of a file another flow runs looks in that file's folder. `tolerance=` is the percent of pixels that may differ, `0.1` unless given, and each `mask=` leaves a part out: `x,y,w,h` in tap units, or selector words, as `mask="id=clock"`. The status bar is always left out. A `screenshot` or `visual` step first waits until the screen has looked the same for 500 ms, at most 5 s, as a fade into dark mode would otherwise be in the picture. A screen that differs past the tolerance fails the step, and the failure names the diff, where what differs is red, and the screen it read. `appdyno test` or `appdyno run-flow run` with `--update-baselines` saves each baseline in place of comparing. It saves none of a flow whose `visual` step comes after a step flagged `!ambiguous` that acts, as a `tap` does and an `assert` or a `wait_for` does not: that step may reach another element on that run, so the flow is refused before its first step, naming both lines. A flow whose baseline is missing is refused before its first step, saying so. A baseline is one screen size's: on a device of another size the step fails, saying both sizes, and `--update-baselines` on several `--device`s keeps the last one's.

`setting dark_mode on` changes a device setting as `set_device` does, with its names and values: `setting text_size accessibility-large`, `setting locale tr-TR app=org.example`, `setting biometric match`, `setting sms "Your code is 1234" title=5551234`, and with no value `setting shake` and `setting memory_warning`, which takes Android's trim level as its value. `setting restore` puts back every one changed. `appdyno test` puts back what each file changed, a setting, a fixed location or the rotation lock, once the file has run, after each of its retries too, so that one file's dark mode is not the next one's. A measured file puts back after its iterations, not between them. What was changed before the run is left as it is. The photos and videos a `setting media` step added come out the same way where the device can take them out (an Android device or emulator); a simulator's Photos has no delete, and keeps them.

## Tags

`tag smoke login` before the steps; `--tag smoke` runs the files with any of the tags named, `--exclude-tag slow` leaves out those with any of these. A file that cannot be read stays, and fails, because nobody can tell how it was tagged. Selecting nothing exits 1: a job that ran nothing has not passed.

## One flow running another

`run shared/login.flow` puts that file's steps in its place, its path taken from the file that names it. They are read before the first step acts, so a missing file, a bad line or a file that runs itself, directly or through other files, is refused with the loop named, and nothing runs. A name means one thing in all of them, because all take their values from one place. You cannot pass a value to one run, and a name that is secret in one file is secret in all. A file for another app is refused. A failure names the file and line it is on, and steps are counted as they run, for `--from`, the report and a journey's kinds. An export writes the steps in place. A tag belongs to the file it is in.

## Setup and teardown

A flow may name a file whose steps run before its own and one whose steps run after, among its first lines:

```text
app dev.appdyno.fixture
setup shared/sign-in.flow
teardown shared/sign-out.flow

tap id=open_basket
```

A folder says the same for every flow in it and in the folders under it, by two files: `_setup.flow` and `_teardown.flow`. The folders count from the flow's own up to its project's root, which is the nearest folder above that holds `.appdyno` or `.git`; with neither, the flow's own folder alone. The setups run outermost first and then the file's own; the teardowns run the file's own first and then the folders', innermost first. A file whose name starts with `_` is never run as a test by `appdyno test`, and has no shared files of its own. Only the file a run starts from has a setup and a teardown: a file that `run` brings in brings its steps alone.

The teardown runs after the last step, after a failed step and after a failed setup, and every step of it runs whatever the one before it did, because each cleans up one thing. A failure's screen, screenshot and tree are taken before the teardown changes them. A failed setup fails the flow, its failure reads `setup step 1 failed`, and none of the flow's own steps run. A teardown that fails is told apart from the flow's own result: the flow's case stays what its steps came to, a case of its own named `login.flow (teardown)` fails in the JUnit file, the line reads `TEARDOWN FAILED login.flow`, and the run exits 1, as the next file starts from what the teardown left. `run_flow run` refuses the same way, with `CHECK_FAILED`, after saying that the steps passed. Steps are counted on their own in each part, so `--from 3` still means the flow's third step, and the setup runs before it. A measured flow runs its setup and teardown around each iteration and times neither. An export to Maestro YAML refuses a flow that has either. A cancelled run stops where it is and runs no teardown.

## Preparing data

`prepare seed-user gives=USER_EMAIL` runs a command of the project's own before the steps after it, to make a user or empty a basket on a server. The flow holds only the name. The command is in `.appdyno/test.json` at the project's root:

```json
{
  "prepare": {
    "seed-user": ["node", "scripts/seed-user.mjs"],
    "signed-in": "flows/shared/sign-in.flow"
  }
}
```

A name with a list is a command and its arguments, run with no shell in the project's root, with `APPDYNO_DEVICE`, `APPDYNO_PLATFORM`, `APPDYNO_APP` and `APPDYNO_FLOW` in its environment. Each `gives=` is a name the command prints a value for, as a line `USER_EMAIL=ada@example.com`; the steps after it take it as `${USER_EMAIL}`, declared `param` or `secret` as any name is, and a `secret` is hidden as any secret is. A value given by `--param` stands over what the command printed. A command that exits with an error, takes longer than 120 s or prints no value for a name fails the step. A name with a path is a flow, run in the step's place as `run` would. Put a `prepare` in `_setup.flow` and one that cleans up in `_teardown.flow` to have them around every file and every retry.

A command is the project's own code running on this Mac, so who may start it is decided outside the flow. `appdyno test` runs it, as the person who ran that ran the project's commands, and says each first: `prepare seed-user runs the project's own command: node scripts/seed-user.mjs`. A tool call, `run_flow` with `run`, asks the person first each time and is refused where the client cannot ask; a server started with `--allow-build` runs it with nothing asked. The project's file has to be inside the folders the server writes in. A name the file does not hold is refused before the first step.

## Retries

`--retries N` runs a file that failed on a step again, whole, from its first step, on a run of its own: within a run a failed step stays failed. A file that passes on a retry is flaky, not passed. The line reads `FLAKY login.flow: passed on attempt 2 of 3`, the run ends with a count of all it ran (`2 passed, 1 flaky, 0 failed`, in a green run too) and names it, the JUnit case holds each failed attempt as `<flakyFailure>` and its suite has `flakes="1"`, and each failed attempt's evidence stays, the later ones under `attempt-<n>/`. A flaky file exits 0, or a retry would be for nothing. To stop on one, add `--fail-on-flaky`: the run then exits 1, and its last line names each, as `failed by --fail-on-flaky: flaky, passed only on a retry: emulator-5554/login.flow`; or read `flakes`, or leave `--retries` out. A file that fails every attempt has the attempts as `<rerunFailure>`. What kept a file from running at all (a line that does not parse, a value missing) is not run again, and `--measure` refuses `--retries`, because the gate would compare what a failed attempt left with what a later one read. At the first retry the run says what stands between two attempts: the failed attempt's teardown runs, the mock rules, settings and media its steps changed are put back, the setup runs again, and the file starts from its first step. The app keeps running with its data unless the setup stops it, and other apps and a server's data are not touched: a `prepare` in the setup owns those.

## Export

`run_flow export` writes Maestro YAML, or refuses and names every step it has no form for (an `alert`, a `visual`, a `setting`, a `drag`, a `push`, a `web_click`, a `clipboard`, an `audit`, a `prepare`, a count, a step for one platform, `replace`,
coordinates, a role with no id or text); a `screenshot` is its `takeScreenshot`. A role beside a text is left out, because that format has no role, and the YAML
says so in a comment. A text there matches a whole label, where ours also takes a part of one. There is no
import.

The tool answers with the YAML, and `to` (`--to` on the command line) writes it to a `.yaml` file as well, inside the folder the server runs in or its state folder, as a client may have no other way to write a file. A path elsewhere, or one a link leads out of them, is refused, and so is a file that is there, unless `overwrite`.

## A journey, measured and gated

`appdyno test flows/login.flow --measure [--iterations 5]`, or `run_flow` `run` with `iterations`, runs a flow as a performance scenario: a first run left out as a warm-up, then each iteration with a time and what the device reads in a moment for each step. All of it is one kept run of a scenario named by the file's path in its repository, `journey-flows-login`, so that two `smoke.flow` in two folders are two scenarios, and the gate is the usual one:

```sh
appdyno test flows/login.flow --measure --device <id>       # three times, then:
appdyno perf baseline --app A --scenario journey-flows-login --last 3
appdyno test flows/login.flow --measure --device <id>
appdyno perf compare --app A --scenario journey-flows-login       # exit 1, naming the step that got slower
```

A step's kind comes from its line, `journey.04_tap_id_load.ms`, with a `${NAME}` as it is written, so a value does not change it, and a step put in renumbers the ones after it. On Android a step has its frames (p95, worst) and memory, and on an iPhone its time only, because a read of its memory is a recording of seconds. The answer says so. Both are proven on a phone against a known cost, and an iOS simulator has run one too, here and on a GitHub runner; an emulator has not yet. Start a flow with `stop` and `launch` to have every iteration start alike. An iteration that fails ends the run: what passed before it is kept, and the file's case fails. On the [dashboard](../reference/perf.md#the-dashboard) a journey is one bar split by step, with a table of each step's numbers.

From code, `replay(file, { onStep })` of [the library](../reference/library.md) calls `onStep` around each step's action, awaited:
`before` once its target is on the screen, `after` with its time once the screen settled.
