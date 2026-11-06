# Flows

What an agent does once can run again with no model, on this device or another, and in CI.

```sh
appdyno flow start            # or the flow tool, action start: every action from here on is logged
appdyno tap --json '{"selector":{"text":"Form"}}'
appdyno flow stop             # prints the flow, and any step to look at
appdyno flow save login.flow
appdyno flow run login.flow --param PASSWORD_INPUT=... --from 3
appdyno test flows/ --tag smoke --env-file ci.env --retries 1 --device emulator-5554 --device <udid> --artifacts out --junit out/junit.xml
appdyno flow export login.flow > login.yaml
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

| step                                                                        | runs                          |
| --------------------------------------------------------------------------- | ----------------------------- |
| `launch`, `stop`                                                            | `launch_app`, `terminate_app` |
| `tap`, `long_press durationMs=`, `double_tap`                               | `tap`, `gesture`              |
| `type "text" [target] [replace] [submit]`                                   | `type_text`                   |
| `press_key back`, `swipe up [target]`, `scroll_to <selector> [direction=]`  | the tool of that name         |
| `wait_for <selector> [gone] [timeoutMs=]`                                   | `wait_for`                    |
| `assert <selector> [check=] [equals=] [expect=false] [timeoutMs=]`          | `assert`                      |
| `open_link "url"`, `set_location 41.0 29.0`, `alert allow`, `hide_keyboard` | their tools                   |
| `run shared/login.flow`                                                     | that file's steps, in place   |

A selector is any of `id=`, `role=`, `text=`, `index=`; text matches as it does in the tools.

## Recording

A recording logs each action that succeeded, with a selector that finds its target alone on that
screen at that moment: the id, else role and text, else text. Refs never reach the file. What nothing
finds alone keeps its index and is flagged `!ambiguous`. Only a point on no element, a slider or a large
area stays as coordinates, flagged `!coordinates` with the screen size they hold for; a screen of another
size refuses that step. A role is kept when both platforms name it alike (`button`, `textField`...), and
Android's own ids (`android:id/button1`) are not kept. An action with no step (a pinch, a device setting, a click in a web view)
is written as `unrecorded "..."`, where a replay stops, so that it cannot pass without it. A measure is the agent measuring, not the journey: what it did to the screen stays, as the plain steps that do the same (`perf_launch` cold: `stop`, `launch`; `perf_scroll`: its swipes), and it stops no replay. `flow stop` and
`flow save` list every step to look at.

## Secrets

Text typed into a password field, and text in `APPDYNO_SECRETS`, become a `secret` by name:
the field's id, or `SECRET_1` for the first of `APPDYNO_SECRETS`. From then on the same text anywhere else,
such as a label that shows it back, becomes that name too. The file never holds a value. Neither does the
recording kept between commands, which holds a salted digest. `param` and `secret` values come from
`--param` (`params` in the tool), then `--env-file` (`envFile`; `NAME=value` lines, as a `.env` file has them, kept out of the repository by you), then the environment variable of that name; `$${` is a literal `${`. A secret
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

## Running flows in CI

`appdyno test` runs files or directories of `.flow` one at a time on each `--device` in turn. It writes
JUnit (a suite per device, a case per file; default `appdyno-artifacts/junit.xml`), saves `screen.jpg` and
`tree.json` under `<artifacts>/<device>/<file>/` at a failure, goes on to the next file, and exits 1 if any
failed or if there was nothing to run. Assertions are steps.

## Tags

`tag smoke login` before the steps; `--tag smoke` runs the files with any of the tags named, `--exclude-tag slow` leaves out those with any of these. A file that cannot be read stays, and fails, because nobody can tell how it was tagged. Selecting nothing exits 1: a job that ran nothing has not passed.

## One flow running another

`run shared/login.flow` puts that file's steps in its place, its path taken from the file that names it. They are read before the first step acts, so a missing file, a bad line or a file that runs itself, by any way round, is refused with the way round named, and nothing runs. A name means one thing in all of them, because all take their values from one place. You cannot pass a value to one run, and a name that is secret in one file is secret in all. A file for another app is refused. A failure names the file and line it is on, and steps are counted as they run, for `--from`, the report and a journey's kinds. An export writes the steps in place. A tag belongs to the file it is in.

## Retries

`--retries N` runs a file that failed on a step again, whole, from its first step, on a run of its own: within a run a failed step stays failed. A file that passes on a retry is flaky, not passed. The line reads `FLAKY login.flow: passed on attempt 2 of 3`, the run ends with a count of all it ran (`2 passed, 1 flaky, 0 failed`, in a green run too) and names it, the JUnit case holds each failed attempt as `<flakyFailure>` and its suite has `flakes="1"`, and each failed attempt's evidence stays, the later ones under `attempt-<n>/`. A flaky file exits 0, or a retry would be for nothing. To stop on one, read `flakes` or leave `--retries` out. A file that fails every attempt has the attempts as `<rerunFailure>`. What kept a file from running at all (a line that does not parse, a value missing) is not run again, and `--measure` refuses `--retries`, because the gate would compare what a failed attempt left with what a later one read.

## Export

`flow export` writes Maestro YAML, or refuses and names every step it has no form for (an `alert`, `replace`,
coordinates, a role with no id or text). A role beside a text is left out, because Maestro has none, and the YAML
says so in a comment. Maestro's text matches a whole label where ours also takes a part of one. There is no
import.

## A journey, measured and gated

`appdyno test login.flow --measure [--iterations 5]`, or `flow` `run` with `iterations`, runs a flow as a performance scenario: a first run left out as a warm-up, then each iteration with a time and what the device reads in a moment for each step. All of it is one kept run of the scenario `journey-login`, and the gate is the usual one:

```sh
appdyno test flows/login.flow --measure --device <id>       # three times, then:
appdyno perf baseline --app A --scenario journey-login --last 3
appdyno test flows/login.flow --measure --device <id>
appdyno perf compare --app A --scenario journey-login       # exit 1, naming the step that got slower
```

A step's kind comes from its line, `journey.04_tap_id_load.ms`, with a `${NAME}` as it is written, so a value does not change it, and a step put in renumbers the ones after it. On Android a step has its frames (p95, worst) and memory, and on an iPhone its time only, because a read of its memory is a recording of seconds. The answer says so. Both are proven on a phone against a known cost; a simulator or an emulator has not run one yet. Start a flow with `stop` and `launch` to have every iteration start alike. An iteration that fails ends the run: what passed before it is kept, and the file's case fails. On the [dashboard](../reference/perf.md#the-dashboard) a journey is one bar split by step, with a table of each step's numbers.

From code, `replay(file, { onStep })` of [the library](../reference/library.md) calls `onStep` around each step's action, awaited:
`before` once its target is on the screen, `after` with its time once the screen settled.
