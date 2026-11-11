# Library

[Türkçe](library.tr.md)

`appdyno` exports one function, `connect`. The object it returns calls any tool by name, with its arguments and its answer typed from the tool's own schema, and replays flows. A refused call throws, with `code`, `hint` and `dispatched`. The types stand alone: a project needs nothing else installed, zod included.

`connect` takes `device` (a serial; with none, the only device connected), `app` (the app the tools act on when a call names none) and `allowDevices` (a regular expression of the devices it may drive). `replay` takes `from` (the step to begin at), `params`, `onStep` and `evidence`, a folder for a failure's screenshot and tree. `dispatched` says whether the refused call's touch had already gone out. A tool that loses data, or would touch the system's power controls, is refused with `PERMISSION_REQUIRED`: a program has no person to ask, and `connect` takes no option that allows it ahead.

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
