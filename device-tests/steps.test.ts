import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Adb,
  androidProvider,
  simulatorProvider,
  Simctl,
  type AndroidDevice,
} from './workspace.js';
import { type Answer, type Call, IPHONE, onIphone, opsOn, SIM_FIXTURE } from './helpers.js';

/**
 * A sequence of any tools in one call, against the fixture, on the emulator APPDYNO_ANDROID_SERIAL names and the
 * simulator APPDYNO_IOS_UDID names, with the longest there may be, and how long it took.
 */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const SIMULATOR = process.env.APPDYNO_IOS_UDID ?? '';

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

function stepsOf(get: () => Call) {
  const call: Call = (n, a) => get()(n, a);

  it('reads, takes pictures and acts across screens, and says each answer', async () => {
    await call('manage_app', { action: 'stop' });
    ok(await call('launch_app'));
    const r = ok(
      await call('run_steps', {
        steps: [
          { tool: 'take_screenshot' },
          { tool: 'tap_screen', selector: { text: 'Form' }, read: 'diff' },
          { tool: 'check_element', selector: { id: 'name_input' }, timeoutMs: 5000 },
          { tool: 'type_text', selector: { id: 'name_input' }, text: 'Ali' },
          { tool: 'read_screen', selector: { id: 'name_input' } },
          { tool: 'take_screenshot' },
          { tool: 'list_devices', selected: true },
        ],
      }),
    );
    expect(r.text).toMatch(/^1\. image /m);
    expect(r.text).toMatch(/^2\. tapped /m);
    expect(r.text).toMatch(/^5\. @\w+ textField/m);
    expect(r.text).toMatch(/^6\. image /m);
    expect(r.text).toContain(`foreground: ${APP}`);
  });

  it('runs the most it may, with each step answered', async () => {
    await call('manage_app', { action: 'stop' });
    ok(await call('launch_app'));
    ok(await call('open_link', { url: 'appdyno-fixture://open/form' }));
    const started = Date.now();
    const r = ok(
      await call('run_steps', {
        steps: [
          { tool: 'tap_screen', selector: { id: 'name_input' } },
          ...Array.from({ length: 29 }, (_, i) => ({ tool: 'press_key', key: `${i % 10}` })),
        ],
      }),
    );
    expect(r.text.split('\n').filter((l) => /^\d+\. pressed/.test(l))).toHaveLength(29);
    // what a client's usual limit of a minute means here
    console.log(`30 steps in ${Date.now() - started} ms`);
  });
}

/** The delay an iOS fixture's page moves on after, by its own link: none, its 300 ms. */
const iosDelay = (get: () => Call) => (ms?: number) =>
  get()('open_link', { url: `appdyno-fixture://cost/moves_on/${String(ms ?? 0)}` });

/**
 * Steps on screens that change under them: a sheet that opens with its page, and a page that moves on by itself after
 * it appears, `delay` setting how long after (none: the fixture's 300 ms).
 */
function shiftsOf(get: () => Call, delay: (ms?: number) => Promise<unknown>) {
  const call: Call = (n, a) => get()(n, a);
  const fresh = async () => {
    await call('manage_app', { action: 'stop' });
    ok(await call('launch_app'));
  };

  it('says first that a sheet over the app stands between a step and its target', async () => {
    await fresh();
    ok(await call('open_link', { url: 'appdyno-fixture://open/sheet' }));
    const r = await call('run_steps', {
      steps: [{ tool: 'tap_screen', selector: { id: 'next_button' } }],
      read: 'none',
    });
    expect(r.text).toMatch(
      /^NOT_FOUND: 1\. tap_screen failed, the rest were not run: a (bottom )?sheet is open over the app: "Choose a plan"; close it \(.+\) or act in it; no element matches id="next_button"/,
    );
  });

  it('passes no wait on a screen on its way out, and says what came between', async () => {
    await fresh();
    const r = await call('run_steps', {
      steps: [
        { tool: 'open_link', url: 'appdyno-fixture://open/moves_on' },
        { tool: 'check_element', selector: { id: 'begin_button' }, timeoutMs: 3000 },
        { tool: 'take_screenshot' },
        { tool: 'tap_screen', selector: { id: 'begin_button' } },
      ],
      read: 'none',
    });
    console.log(r.text);
    expect(r.error).toBe(true);
    // the page moved on by itself, in the link's settle, in the wait, or after it
    if (/^2\. id="begin_button" shown$/m.test(r.text))
      expect(r.text).toContain(
        'id="begin_button" was shown at step 2, and the screen changed to "Details" before step 4',
      );
    else expect(r.text).toMatch(/^2\. check_element failed.*"Details"/m);
  });

  it('says a page that held through the wait moved on before a later step', async () => {
    await fresh();
    await delay(1_500);
    try {
      const r = await call('run_steps', {
        steps: [
          { tool: 'open_link', url: 'appdyno-fixture://open/moves_on' },
          { tool: 'check_element', selector: { id: 'begin_button' }, timeoutMs: 3000 },
          // the page it opens holds the old one in its read as it slides in, on iOS
          {
            tool: 'check_element',
            selector: { id: 'begin_button' },
            check: 'absent',
            timeoutMs: 5000,
          },
          { tool: 'tap_screen', selector: { id: 'begin_button' } },
        ],
        read: 'none',
      });
      expect(r.text.split('\n').slice(1, 5)).toEqual([
        '2. id="begin_button" shown',
        '3. id="begin_button" gone',
        expect.stringMatching(/^4\. tap_screen failed, the rest were not run: no element matches/),
        'id="begin_button" was shown at step 2, and the screen changed to "Details" before step 4',
      ]);
    } finally {
      await delay();
    }
  });

  it('says once that launch_app opens an app more steadily than its icon', async () => {
    await fresh();
    ok(await call('press_key', { key: 'home' }));
    const r = ok(
      await call('run_steps', {
        steps: [
          { tool: 'tap_screen', selector: { text: 'appdyno fixture' } },
          // the fixture's home, which a stop and a launch left it on
          { tool: 'check_element', selector: { text: 'Form' }, timeoutMs: 5000 },
        ],
        read: 'none',
      }),
    );
    expect(r.text).toMatch(
      /^1\. tapped .*appdyno fixture"; launch_app opens an app more steadily than its icon: it waits for the app in front, and settles$/m,
    );
  });
}

describe.skipIf(!ANDROID)('steps on Android', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-steps-')));
    o = opsOn(androidProvider(new Adb()), ANDROID, APP);
  });
  afterAll(() => o.ctx.close());
  stepsOf(() => o.call);
  shiftsOf(
    () => o.call,
    async (ms) =>
      ((await o.ctx.session()).device as AndroidDevice).shell(
        ms === undefined
          ? `run-as ${APP} rm -f files/moves_on_ms`
          : `run-as ${APP} sh -c 'mkdir -p files; echo ${String(ms)} > files/moves_on_ms'`,
      ),
  );
});

describe.skipIf(!SIMULATOR)('steps on a simulator', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-steps-')));
    await new Simctl().install(SIMULATOR, SIM_FIXTURE);
    o = opsOn(simulatorProvider(), SIMULATOR, APP);
  }, 300_000);
  afterAll(() => o.ctx.close());
  stepsOf(() => o.call);
  shiftsOf(
    () => o.call,
    iosDelay(() => o.call),
  );
});

describe.skipIf(!IPHONE)('steps on an iPhone', () => {
  let o: Awaited<ReturnType<typeof onIphone>>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-steps-')));
    o = await onIphone(APP);
  }, 300_000);
  afterAll(async () => {
    await o.call('manage_app', { action: 'stop' });
    await o.ctx.end();
    o.ctx.close();
  }, 60_000);
  stepsOf(() => o.call);
  shiftsOf(
    () => o.call,
    iosDelay(() => o.call),
  );
});
