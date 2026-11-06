# Library

`appdyno` exports one function, `connect`. What it gives calls every tool by its name, its arguments and its answer typed from the tool's own schema, and replays flows. A refused call throws, with `code`, `hint` and `dispatched`. The types stand alone: a project needs nothing else installed, zod included.

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
    await device.tool('tap', { selector: { text: 'Not on this screen' } }).catch((e: Refusal) => {
      log(`${e.code}: ${e.hint}`);
    });
    return run.passed;
  } finally {
    await device.close();
  }
}
```

`close` puts back what the tools changed on the device, as the end of a session does.
