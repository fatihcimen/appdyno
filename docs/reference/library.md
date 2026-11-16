# Library

[Türkçe](library.tr.md)

`appdyno` exports one function, `connect`; a second entry point, `appdyno/device`, gives the device itself, and is described at the end of this page. The object `connect` returns calls any tool by name, with its arguments and its answer typed from the tool's own schema, and replays flows. A refused call throws, with `code`, `hint` and `dispatched`. The types stand alone: a project needs nothing else installed, zod included.

`connect` takes `device` (a serial; with none, the only device connected), `app` (the app the tools act on when a call names none), `allowDevices` (a regular expression of the devices it may drive), `allowUrls`, `allowWrite`, `secrets` and `share`. `allowUrls` is a regular expression of the links `open_link` opens, as `--allow-urls` is for a server: with none it opens a web link and a scheme the selected app says it opens, and refuses any other `PERMISSION_REQUIRED`. `secrets` lists texts no answer shows back, as `APPDYNO_SECRETS` does for a server, and `connect` reads that variable and `APPDYNO_SECRETS_FILE` too; they are hidden in text, not in a screenshot or a video. A tool writes a file where a call says, as `screenshot` `file` or `report` `dir`, only inside the folder the program runs in, appdyno's state directory or a folder `allowWrite` lists (`APPDYNO_ALLOW_WRITE` lists more, as `PATH` does); a path elsewhere is refused `POLICY_DENIED`. A device another process holds is refused with `DEVICE_CLAIMED`; with `share: true` the program drives it beside that process and holds it against none, as `use_device` with `share: true` does for a server, and `APPDYNO_SHARE=1` asks the same of a program that names no `share`. `replay` takes `from` (the step to begin at), `params`, `onStep` and `evidence`, a folder for a failure's screenshot and tree. `dispatched` says whether the refused call's touch had already gone out. A refusal's `code` is one of the `ErrorCode` type, which both entry points export. A tool that loses data, or would touch the system's power controls, is refused with `PERMISSION_REQUIRED`: a program has no person to ask, and `connect` takes no option that allows it ahead.

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

`openDevice` takes a serial and opens it with the driver that takes it, as `connect` does. `allowDevices` is the same list: a serial outside it is refused `POLICY_DENIED`. The device is held for this process until `close`, so one that another process holds is refused `DEVICE_CLAIMED`; `share` drives it all the same, and holds it from no one. `app` names the app the screen is read for.

The device has `serial`, `platform` and `virtual`, and the calls `screen`, `tap`, `longPress`, `swipe`, `key`, `typeText`, `launch`, `terminate`, `foreground` and `close`. A touch waits for the screen to come to rest, and answers `settled`; `typeText` adds `verified` and `submitted`. `launch` waits the same way for the app's first screen, as the tool `launch_app` does: until its layout has held for 200 ms, for 3 s at most, and it answers `settled` too, so a read right after it is of a screen that has stopped laying out. A point is in the units the screen is read in: points on iOS, pixels on Android.

`screen` is a new read each time, of whatever window is in front: its `elements`, the read's `hash`, the app in `foreground` and the `window`'s size. An element has a `ref`, a `role`, a `label` (and `whole` where the label is cut short), an `id`, a `rect`, its middle as `x` and `y`, and `flags`. A selector names one by `text`, `id`, `role` and `index`, as a tool's selector does, and `select` gives every element it names.

Three rules the tools keep are functions here, so that a program does not write them again:

- **A touch point of the control's own.** `aim` gives the one element that a selector, or a `ref`, names on a read, and the `point` a touch on it goes to. That is its middle, but for a switch row, which is touched on its own switch (`why` is `own`), and for a control whose middle is a smaller control of other words, as a mini player's Pause, which is touched at a point clear of that one (`clear`, with that control as `other`). `covered` says that no point of it was clear. No match throws `NOT_FOUND`, several that stand apart `AMBIGUOUS`, and a ref that is not on the read `STALE`.
- **A selector on the screen in front.** `aim` also gives `on`, the `hash` of the read it aimed on, and a touch takes it as `before`. After a dialog came up by itself, read the screen again and aim on that read: the touch goes to the dialog. On Android a touch whose `before` is a read from before another window of an app came in front is refused `STALE`, with nothing sent, while that read is among the last 8 the device gave: an older one is not compared. iOS makes no such comparison.
- **An element whose words changed.** `nameOf` names an element by its ref and its words, as `@a1 "Close"`, and given the words it was shown with on an earlier read, by both where they differ: `@a1 "Close" (shown as "Play")`.

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

What the tools add on top stays with `connect`: the question asked before a touch on the system's power controls or a call that loses data, the secrets hidden in what is shown back, the words read from a picture where a screen has none, the wait for an element that is still coming, and the put-back at the end of a session. A device opened here takes every touch it is given, and `close` puts nothing back.

### What a release may change

`appdyno/device` follows semantic versioning from the release that first has it. Its surface is the functions it exports, the members of the device, and the fields of the types it exports.

A minor or patch release may add a function, a member, an optional option or an optional field; may add a value to `role`, `flags`, `why` and a refusal's `code`; and may move the point `aim` gives, or change the element a selector names, where that corrects a touch that went to the wrong place, which the changelog then says. It may not remove or rename a function, a member or a field, change the type of one, make an optional one required, or change what a `ref`, a `hash` and a point's units mean: those wait for a major release.

What the entry does not export may change in any release: the drivers, the tree a device sends, the tool layer and the other files under `dist`.
