# Library

[Türkçe](library.tr.md)

`appdyno` exports one function, `connect`; a second entry point, `appdyno/device`, gives the device itself, and is described at the end of this page. The object `connect` returns calls any tool by name, with its arguments and its answer typed from the tool's own schema, and replays flows. A refused call throws, with `code`, `hint` and `dispatched`. The types stand alone: a project needs nothing else installed, zod included.

`connect` takes `device` (a serial; with none, the only device connected), `app` (the app the tools act on when a call names none), `allowDevices` (a regular expression of the devices it may drive), `allowBuild`, `allowUrls`, `allowWrite`, `secrets` and `share`. `allowBuild: true` lets `app` `build_and_run` run a project's own build scripts on this Mac, for a project inside the folders it writes in; without it that call is refused `PERMISSION_REQUIRED`. `allowUrls` is a regular expression of the links `open_link` opens, as `--allow-urls` is for a server: with none it opens a web link and a scheme the selected app says it opens, and refuses any other `PERMISSION_REQUIRED`. `secrets` lists texts no answer shows back, as `APPDYNO_SECRETS` does for a server, and `connect` reads that variable and `APPDYNO_SECRETS_FILE` too; they are hidden in text, not in a screenshot or a video. A tool writes a file where a call says, as `screenshot` `file` or `report` `dir`, only inside the folder the program runs in, appdyno's state directory or a folder `allowWrite` lists (`APPDYNO_ALLOW_WRITE` lists more, as `PATH` does); a path elsewhere is refused `POLICY_DENIED`. A device another process holds is refused with `DEVICE_CLAIMED`; with `share: true` the program drives it beside that process and holds it against none, as `use_device` with `share: true` does for a server, and `APPDYNO_SHARE=1` asks the same of a program that names no `share`. `replay` takes `from` (the step to begin at), `params`, `onStep` and `evidence`, a folder for a failure's screenshot and tree. `dispatched` says whether the refused call's touch had already gone out. A refusal's `code` is one of the `ErrorCode` type, which both entry points export. A tool that loses data, or would touch the system's power controls, is refused with `PERMISSION_REQUIRED`: a program has no person to ask, and `connect` takes no option that allows it ahead.

`connect` also takes `policy` and `signing`, and `openDevice` takes the same two. `policy` is one object with `secrets`, `apps`, `urls` and `write`. On `connect` its `secrets` add to `secrets`, its `write` adds to `allowWrite`, its `urls` stands in place of `allowUrls`, and its `apps` lists the only apps the tools launch and stop, as `--allow-apps` does for a server. `signing` names what signs the runner for an iPhone, for this device alone: `profile`, the path of a development provisioning profile, with `keychain` and `keychainPassword` where its identity is in a keychain of its own. It stands in place of `APPDYNO_IOS_PROFILE`, `APPDYNO_IOS_KEYCHAIN` and `APPDYNO_IOS_KEYCHAIN_PASSWORD`, so a pool of phones with a profile each needs no environment for each process. The password is neither printed nor kept: read it from where secrets are kept, not from the source.

```ts
import { connect, type Refusal } from 'appdyno';

/** Taps through an app by the words on its screen, replays a flow, and says what each step took. */
export async function drive(flow: string, log: (line: string) => void) {
  const device = connect({ app: 'dev.appdyno.fixture' });
  try {
    await device.tool('launch_app', {});
    const form = await device.tool('tap', { selector: { text: 'Form' } });
    log(form.text);
    const run = await device.replay(flow, {
      onStep: (e) => {
        if (e.phase === 'after') log(`${e.result.step}: ${e.result.ms} ms`);
      },
    });
    await device.tool('tap', { selector: { text: 'Not on this screen' } }).catch((e: unknown) => {
      const { code, hint } = e as Refusal;
      log(`${code}: ${hint ?? ''}`);
    });
    return run.passed;
  } finally {
    await device.close();
  }
}
```

`close` puts back what the tools changed on the device, as the end of a session does.

An `AbortSignal` stops a call: `tool` takes `{ signal }` as its third argument, and `replay` takes `signal` among its options. What a server does when its client cancels a call happens here, down to the device's own wait. The stopped call rejects with the code `CANCELLED`. Its `dispatched` is `false` when the call was stopped before it began, or while it waited for the action before it, so nothing reached the device, and `'unknown'` once its action had left for the device, which may have made the touch: read the screen before trying again. A stopped `replay` rejects the same way, with `dispatched` `true` once a step was done.

A program that needs the tree itself, rather than the folded list a model reads, asks `screen` with `raw: true`: its answer's `data.nodes` holds every element of the tree with its `type`, words, `rect`, `flags` and the index of its `parent`. After an action no second call is needed: `tool` with `{ raw: true }` as its third argument adds `nodes` to the answer, the same list for the screen the action left, taken from the read its answer made and cleaned the same way. After a call that read nothing, as an action with `read: 'none'`, it costs one read. Each element the screen shows carries a `ref`, and `tap` takes it, at the element's middle where the list does not name it. An element has none when it is not the app's, as the keyboard and the system's bars, is marked not visible, has no size, is less than half on the screen, lies under the status bar or a navigation bar at the top on iOS, or is one of the rows a list has not placed yet, piled at one point.

## The device itself

`appdyno/device` is a second entry point, for a program that wants the device and not a tool's answer: it reads the screen as elements, aims by a selector or a ref, and touches a point. It exports `openDevice`, `select`, `aim` and `nameOf`, and the types of what they take and give, which stand alone as the main entry's do.

`openDevice` takes a serial and opens it with the driver that takes it, as `connect` does. `allowDevices` is the same list: a serial outside it is refused `POLICY_DENIED`. The device is held for this process until `close`, so one that another process holds is refused `DEVICE_CLAIMED`; `share` drives it all the same, and holds it from no one. `app` names the app the screen is read for, and the one `logs` reads. `policy` is the object `connect` takes: its `secrets` are hidden in an element's `label`, `whole` and `id`, in log lines and in an audit's words; its `apps` lists the only apps `launch`, `terminate`, `clearData` and `logs` take, and a link may open in; its `urls` the only links `openLink` opens; its `write` the folders `screenshot` may write a file in, beside the folder the program runs in and appdyno's state directory. A call outside them is refused `POLICY_DENIED`. `signing` is as `connect` takes it.

The device has `serial`, `platform` and `virtual`, and the calls `screen`, `aim`, `tap`, `longPress`, `swipe`, `key`, `typeText`, `launch`, `terminate`, `foreground`, `openLink`, `screenshot`, `logs`, `windows`, `setOrientation`, `audit`, `clearData`, `stopAgent` and `close`. A touch waits for the screen to come to rest, and answers `settled` and `ms`, the time that took as the device counted it; `typeText` adds `verified` and `submitted`. `launch` waits the same way for the app's first screen, as the tool `launch_app` does: until its layout has held for 200 ms, for 3 s at most, and it answers `settled` too, so a read right after it is of a screen that has stopped laying out. A point is in the units the screen is read in: points on iOS, pixels on Android.

`tap`, `longPress`, `swipe`, `key`, `typeText`, `launch` and `openLink` take `quietMs`, how long the layout must hold to count as at rest, and `maxMs`, the longest the call waits for that: 200 and 3000 with none given, 5000 and 15000 at most, and a value past those is refused `INVALID_ARGUMENT` with nothing sent. On a screen that never stops, as one with a banner that turns, `quietMs: 120` with `maxMs: 1500` ends the wait sooner. With `tree: true` the answer also carries `tree`, the screen the call left, as `screen` gives one. It is taken from the read the settle made where the device gives it, so an action and the screen after it are one call; a call that does not ask for it reads nothing more.

`screen` is a new read each time, of whatever window is in front: its `elements`, the read's `hash`, the app in `foreground` and the `window`'s size. An element has a `ref`, a `role`, a `label` (and `whole` where the label is cut short), an `id`, a `rect`, its middle as `x` and `y`, and `flags`. A selector names one by `text`, `id`, `role` and `index`, as a tool's selector does, and `select` gives every element it names. Each element also has `parent`, the place in `elements` of its nearest ancestor that is listed too; `pkg`, the app of its window; `notImportant` and `screenReaderFocusable` where Android sets them; and `order`, its place from 0 in the order the tree gives a screen reader, each element and then what it holds. A screen reader may still go another way, as VoiceOver does by place on the screen. An element holds these fields and no other.

Three rules the tools keep are functions here, so that a program does not write them again:

- **A touch point of the control's own.** `aim` gives the one element that a selector, or a `ref`, names on a read, and the `point` a touch on it goes to. That is its middle, but for a switch row, which is touched on its own switch (`why` is `own`), and for a control whose middle is a smaller control of other words, as a mini player's Pause, which is touched at a point clear of that one (`clear`, with that control as `other`). `covered` says that no point of it was clear. No match throws `NOT_FOUND`, several that stand apart `AMBIGUOUS`, and a ref that is not on the read `STALE`. The device's own `aim` takes the same target, reads the screen itself, and waits for an element that is not there yet, 1500 ms unless `waitMs` says otherwise, as a tool does. Both go by the rule the tools go by, in one place, so a correction to it reaches all three.
- **A selector on the screen in front.** `aim` also gives `on`, the `hash` of the read it aimed on, and a touch takes it as `before`. After a dialog came up by itself, read the screen again and aim on that read: the touch goes to the dialog. A touch whose `before` is a read that no longer has in front what it had is refused `STALE`, with nothing sent, while that read is among the last 8: an older one is not compared. Android compares on the device, as it sends the touch, by the app windows of the two reads. iOS compares on this Mac, by one more read just before the touch, of the reads this device object gave: another app in front, a system alert that came or went, an alert or a sheet of the app's that came up or went away. On iOS what comes in front between that read and the touch is not caught, and a cover the app draws that is no alert or sheet is not seen as one; this was checked on a simulator, and not yet on an iPhone. `key`, and `typeText` into the field that has the focus, go to whatever is in front and are never refused so. On `launch` and `openLink`, `before` names the screen the call began on, which is then no rest however long it holds.
- **An element whose words changed.** `nameOf` names an element by its ref and its words, as `@a1 "Close"`, and given the words it was shown with on an earlier read, by both where they differ: `@a1 "Close" (shown as "Play")`. Its third argument takes `clean`, a function its words pass through, as the one that hides a program's secrets, and `shownAs`, which writes the part in brackets, for another language.

```ts
import { aim, nameOf, openDevice } from 'appdyno/device';

/** Reads the screen, taps the control its words name at a point of its own, and gives the words of the screen after. */
export async function tapByWords(serial: string, text: string, log: (line: string) => void) {
  const device = await openDevice(serial);
  try {
    const target = aim(await device.screen(), { text });
    const { settled } = await device.tap(target.point, { before: target.on });
    log(`tapped ${nameOf(target.element)} at ${target.point.x},${target.point.y}`);
    if (!settled) log('the screen still moves');
    return (await device.screen()).elements.map((e) => e.label);
  } finally {
    await device.close();
  }
}
```

`screenshot` gives the picture's `data` with its `format`, `width` and `height`; with `path` it writes the file there and gives `path`, inside the folders the program may write in, and a path elsewhere is refused before anything is asked of the device. `logs` gives the app's lines as data, the oldest first, each with its `text`, and with `at` and `level` where the platform tells them; it takes `app`, `since`, `level` and `maxLines`, 200 with none given and 1000 at most, and its `note` says what the platform could not give, as on an iPhone. `openLink` opens a link, in `app` where one is given, through the checks a tool's link passes: a scheme that reaches files or code is refused, and so is a link that places a call unless `policy.urls` names it. It asks nobody anything, where a tool asks a person about a scheme it does not know. `windows` lists the device's windows, each with `type`, `pkg`, `rect`, `layer`, `active` and `focused`, and gives `keyboard`, where the on-screen keyboard is while it is open. `setOrientation` takes `portrait`, `landscape_left`, `upside_down` or `landscape_right`. `audit` gives the accessibility `issues` of the screen with `elements`, the read the checks ran on, and `order`, their refs as a screen reader goes through them; on Android that order follows the elements that name another to be read before or after, which a read by `screen` does not have. `clearData` clears an app's data on an emulator or a simulator, and is refused `UNSUPPORTED` on a phone. `stopAgent` ends the device's agent, the iOS runner or the Android agent, and lets the device go, so that another driver can take it; while another live process on this Mac uses that agent it is refused `AGENT_CONFLICT`, unless `force: true`. `close` lets the device go and leaves the agent running for the next to open it.

What the tools add on top stays with `connect`: the question asked before a touch on the system's power controls or a call that loses data, the words read from a picture where a screen has none, and the put-back at the end of a session. A device opened here takes every touch it is given, a turn by `setOrientation` and a `clearData` on an emulator or a simulator among them, and `close` puts nothing back.

### What a release may change

`appdyno/device` follows semantic versioning from the release that first has it. Its surface is the functions it exports, the members of the device, and the fields of the types it exports.

A minor or patch release may add a function, a member, an optional option or an optional field; may add a value to `role`, `flags`, `why`, a window's or an issue's `type` and a refusal's `code`; and may move the point `aim` gives, or change the element a selector names, where that corrects a touch that went to the wrong place, which the changelog then says. It may not remove or rename a function, a member or a field, change the type of one, make an optional one required, or change what a `ref`, a `hash` and a point's units mean: those wait for a major release.

What the entry does not export may change in any release: the drivers, the tree a device sends, the tool layer and the other files under `dist`.
