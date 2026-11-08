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
