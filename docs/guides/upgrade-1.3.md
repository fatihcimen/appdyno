# Upgrading from 1.2 to 1.3

[Türkçe](upgrade-1.3.tr.md)

1.3.0 renamed the tools. The 48 tools are now 28, each named verb_noun, and the old names are gone, with no aliases: a call by one is refused with `INVALID_ARGUMENT`, and its hint names the tool to call, as `screen is now read_screen`. This page is everything to change, in the order you meet it. Your `.flow` files need nothing.

## In short

| what you have                           | what to do                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------- |
| a client that saved a tool's permission | [allow the server whole](#saved-permissions), or each new name             |
| a prompt or a skill that names tools    | rename each by [the table](#names-before-130)                              |
| a script of `appdyno` commands          | [rename the commands](#commands): a tool's name with dashes                |
| a `run_steps` call                      | [key each step by `tool`](#steps-in-one-call), not `action`                |
| a program on the library                | [rename each `tool` call](#the-library): TypeScript names each one it sees |
| `.flow` files, `appdyno test`, CI       | [nothing](#what-stays-the-same)                                            |

## Saved permissions

A client that saved its approval of a tool saved it by the tool's name, so an approval of 1.2's `mcp__appdyno__screen` matches no tool now, and the client asks again. Allow the whole server where the client keeps its approvals, as `mcp__appdyno` in a `permissions.allow` list; [Connecting a client](clients.md#claude-code) says which file holds it:

```json
{
  "permissions": {
    "allow": ["mcp__appdyno"]
  }
}
```

To allow some tools only, list each by its new name, as `mcp__appdyno__read_screen` and `mcp__appdyno__tap_screen`, and take out the old ones. A client that asks once per tool asks again at each new name's first call. What the server may do at all is said by its `--allow-` flags, not by a client's approvals: see [Server options](../reference/cli.md#server-options).

## Commands

A tool's command is its name with dashes, and its action and what else it is told from a list are its first words. The flags are the arguments, as before.

| 1.2                                      | 1.3                                                          |
| ---------------------------------------- | ------------------------------------------------------------ |
| `appdyno screen`                         | `appdyno read-screen`                                        |
| `appdyno tap --selector '{"text":"OK"}'` | `appdyno tap-screen --selector '{"text":"OK"}'`              |
| `appdyno wait-for --selector '{...}'`    | `appdyno check-element --selector '{...}' --timeout-ms 5000` |
| `appdyno record start`                   | `appdyno record-session video start`                         |
| `appdyno network stop`                   | `appdyno capture-network stop`                               |
| `appdyno terminate-app`                  | `appdyno manage-app stop`                                    |
| `appdyno flow run a.flow`                | `appdyno run-flow run a.flow`                                |

`appdyno test`, `perf compare|why|reference|baseline|budget|functions|prune`, `perf dashboard|survey|comment`, `push setup`, `mirror`, `hub`, `timeline`, `flight`, `devices`, `doctor`, `install` and `update` keep their words. `appdyno <command> --help` lists a command's flags, and [Command line](../reference/cli.md) has every one.

## Steps in one call

`steps` is now `run_steps`, and a step names its tool by `tool` where it said `action`, with that tool's new name and arguments. Any tool but `run_steps` and `run_flow` can be a step. A wait names its time, as `check_element` does everywhere now.

```json
{
  "steps": [
    { "action": "tap", "selector": { "text": "Sign in" } },
    { "action": "wait_for", "selector": { "text": "Welcome" } }
  ]
}
```

becomes

```json
{
  "steps": [
    { "tool": "tap_screen", "selector": { "text": "Sign in" } },
    { "tool": "check_element", "selector": { "text": "Welcome" }, "timeoutMs": 5000 }
  ]
}
```

The bare kinds `double_tap`, `long_press` and `drag` are `tap_screen` with `count: 2`, `tap_screen` with `holdMs`, and `swipe_screen` with `to`. A step that is no tool refuses the whole call before anything is done.

## The library

`connect`'s `tool` takes the new names, with their arguments as above:

```ts
await device.tool('tap_screen', { selector: { text: 'Form' } });
const screen = await device.tool('read_screen', { raw: true });
```

where 1.2 had `device.tool('tap', ...)` and `device.tool('screen', ...)`. The names are a type, so TypeScript stops at each old one when it compiles; a call that gets past it, as from JavaScript, is refused at run time with the hint. `connect`'s options, `replay` and `close` keep their names, and `appdyno/device` changed nothing it had: it only gained calls and options. [Library](../reference/library.md) has the whole surface.

## Other changes a script may meet

- A wait that runs out fails with `CHECK_FAILED`, not `TIMEOUT`, and names its `timeoutMs`: there is no default of 5000.
- A tool writes a file where its call says only inside the folder the server runs in, the state folder's folders for what tools make, or one given with `--allow-write`; elsewhere it is refused `POLICY_DENIED`.
- `manage_app build_and_run` asks the person each time, unless the server was started with `--allow-build`.
- `manage_app uninstall`, `clear`, `grant` and `revoke`, `transfer_files push` and `set_device keychain` ask the person first.
- `--toolsets` lists only the groups of tools named, as `core,network,perf`: see [Listing only some tools](../reference/tools.md#listing-only-some-tools).

## What stays the same

- `.flow` files: their steps are words of their own, as `tap`, `wait_for` and `setting`, and a flow recorded with 1.2 replays in 1.3.
- `appdyno test`, its flags, its report and its exit codes.
- The server's flags and variables, with more beside them.
- The devices, the Mac app and the state folder: nothing to set up again.

## Names before 1.3.0

Each old tool, the one that takes its place, and how its arguments changed. "Same" means they did not.

| before            | now                   | arguments                                                                                                                                                                                                    |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `device_info`     | `list_devices`        | `{ selected: true }`                                                                                                                                                                                         |
| `set_orientation` | `set_device`          | `{ orientation, read }` becomes `{ name: 'orientation', value: orientation, read }`                                                                                                                          |
| `set_location`    | `set_device`          | `{ lat, lon }` becomes `{ name: 'location', value: '<lat>,<lon>' }`; `{ clear: true }` becomes `value: 'none'`                                                                                               |
| `clipboard`       | `set_device`          | `{}` becomes `{ name: 'clipboard' }`; `{ text }` becomes `{ name: 'clipboard', value: text }`                                                                                                                |
| `device_setting`  | `set_device`          | same; but `{ name: 'media', value }` becomes `transfer_files` `{ action: 'media', path: value }`                                                                                                             |
| `simulator`       | `manage_simulator`    | same                                                                                                                                                                                                         |
| `screen`          | `read_screen`         | same                                                                                                                                                                                                         |
| `find`            | `read_screen`         | same (`selector`)                                                                                                                                                                                            |
| `wait_for`        | `check_element`       | `{ ref, selector, read }` same; `gone: true` becomes `check: 'absent'`; `timeoutMs` must be given (it was 5000 by default); a wait that runs out is `CHECK_FAILED`, not `TIMEOUT`                            |
| `assert`          | `check_element`       | same                                                                                                                                                                                                         |
| `screenshot`      | `take_screenshot`     | same                                                                                                                                                                                                         |
| `audit`           | `check_screen`        | `{ check: 'accessibility', types, maxIssues }`                                                                                                                                                               |
| `visual`          | `check_screen`        | `action: 'compare'` becomes `check: 'visual'`; `action: 'baseline'` becomes `check: 'visual_baseline'`; the rest same                                                                                        |
| `tap`             | `tap_screen`          | same                                                                                                                                                                                                         |
| `gesture`         | `tap_screen`          | `kind: 'double_tap'` becomes `count: 2`; `kind: 'long_press'` with `durationMs` becomes `holdMs`; target and `read` same                                                                                     |
| `gesture`         | `swipe_screen`        | `kind: 'drag'`: `kind` dropped, `to`, `durationMs`, `holdMs` same; `kind: 'pinch'`: `scale`, `x`, `y` same; `kind: 'plan'`: `pointers` same                                                                  |
| `swipe`           | `swipe_screen`        | same                                                                                                                                                                                                         |
| `scroll_to`       | `swipe_screen`        | `selector` becomes `until`; `direction`, `maxSwipes`, `x`, `y`, `read` same                                                                                                                                  |
| `keyboard`        | `press_key`           | `dismiss` becomes `{ key: 'hide_keyboard' }`; `enter` becomes `{ key: 'enter' }`; `status`: `read_screen`, which lists `@keyboard` when it is open                                                           |
| `steps`           | `run_steps`           | each step's `action` becomes `tool`, with the name and arguments of this table; the bare kinds `double_tap`, `long_press` and `drag` become `tap_screen` and `swipe_screen` steps, as `gesture`'s rows above |
| `alert`           | `answer_alert`        | same                                                                                                                                                                                                         |
| `terminate_app`   | `manage_app`          | `{ action: 'stop', app, background }`                                                                                                                                                                        |
| `app`             | `manage_app`          | same for `list`, `state`, `install`, `uninstall`, `clear`, `grant`, `revoke`, `build_and_run`                                                                                                                |
| `app`             | `transfer_files`      | `download_data` becomes `{ action: 'pull', app, path }`; `replace_data` becomes `{ action: 'push', app, path }`                                                                                              |
| `push`            | `send_push`           | same                                                                                                                                                                                                         |
| `logs`            | `read_logs`           | `maxLines` becomes `limit`; the rest same                                                                                                                                                                    |
| `crashes`         | `read_logs`           | `{ source: 'crashes', app, since, limit, symbols }`                                                                                                                                                          |
| `record`          | `record_session`      | `{ kind: 'video', action, file, overwrite, maxSeconds }`                                                                                                                                                     |
| `report`          | `record_session`      | `start`, `write`, `stop` become `{ kind: 'report', action, dir }`; `timeline` becomes `{ kind: 'timeline', action: 'start', dir }`; `flight` becomes `{ kind: 'flight', action: 'start', dir }`              |
| `mirror`          | `show_mirror`         | same                                                                                                                                                                                                         |
| `inspector`       | `inspect_app`         | `list` becomes `ax_list`; `press` becomes `ax_press`, `name` same                                                                                                                                            |
| `hand_off`        | `ask_person`          | same                                                                                                                                                                                                         |
| `network`         | `capture_network`     | same                                                                                                                                                                                                         |
| `webview`         | `inspect_app`         | `pages`, `elements`, `click`, `eval` become `web_pages`, `web_elements`, `web_click`, `web_eval`; the rest same                                                                                              |
| `react_native`    | `inspect_app`         | `targets`, `logs`, `reload` become `rn_targets`, `rn_logs`, `rn_reload`; the rest same                                                                                                                       |
| `perf_snapshot`   | `measure_performance` | `{ metric: 'snapshot', ... }` same                                                                                                                                                                           |
| `perf_launch`     | `measure_performance` | `{ metric: 'launch', ... }` same                                                                                                                                                                             |
| `perf_scroll`     | `measure_performance` | `{ metric: 'scroll', ... }` same                                                                                                                                                                             |
| `perf_trace`      | `measure_performance` | `{ metric: 'frames', ... }`; `scroll` becomes `direction`                                                                                                                                                    |
| `perf_profile`    | `measure_performance` | `{ metric: 'cpu', ... }`; `scroll` becomes `direction`                                                                                                                                                       |
| `perf_heap`       | `measure_performance` | `{ metric: 'heap', ... }` same                                                                                                                                                                               |
| `perf_compare`    | `compare_performance` | same                                                                                                                                                                                                         |
| `perf_query`      | `compare_performance` | `{ action: 'query', trace, sql, table, limit }`                                                                                                                                                              |
| `flow`            | `run_flow`            | `start` becomes `record`; `stop`, `save`, `run`, `export` same                                                                                                                                               |
