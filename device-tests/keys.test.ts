import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Adb, androidProvider, appleProvider, Simctl } from './workspace.js';
import { type Answer, type Call, IPHONE, onIphone, opsOn, SIM_FIXTURE } from './helpers.js';

/**
 * What a keyboard does in a real field, read back from it, on the emulator APPDYNO_ANDROID_SERIAL names and the
 * simulator APPDYNO_IOS_UDID names; with APPDYNO_SIM_DIRECT=off, by the runner's own keys.
 */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL;
const SIMULATOR = process.env.APPDYNO_IOS_UDID;
const FIELD = 'name_input';

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

function keysOf(get: () => Call) {
  const call: Call = (n, a) => get()(n, a);
  const form = async () => {
    await call('terminate_app');
    ok(await call('launch_app'));
    ok(await call('open_link', { url: 'appdyno-fixture://open/form' }));
  };
  const reads = (equals: string) =>
    call('assert', { id: FIELD, check: 'text', equals, timeoutMs: 3_000 });

  it('moves the cursor with the arrows', async () => {
    await form();
    ok(await call('type_text', { selector: { id: FIELD }, text: 'ac' }));
    ok(await call('press_key', { key: 'arrow_left' }));
    ok(await call('press_key', { key: 'b' }));
    ok(await reads('abc'));
    ok(await call('press_key', { key: 'arrow_right' }));
    ok(await call('press_key', { key: 'd' }));
    ok(await reads('abcd'));
  });

  it('selects all and deletes by a shortcut, and presses count times', async () => {
    await form();
    ok(await call('type_text', { selector: { id: FIELD }, text: 'hello' }));
    const r = ok(await call('press_key', { key: 'delete', count: 3 }));
    expect(r.text).toMatch(/^pressed delete 3 times/);
    ok(await reads('he'));
    ok(await call('press_key', { key: 'command+a' }));
    ok(await call('press_key', { key: 'delete' }));
    // an empty field reads its placeholder on Android: a key shows it was emptied
    ok(await call('press_key', { key: '5' }));
    ok(await reads('5'));
  });

  it('copies and pastes by shortcuts, and types a letter and a digit as keys', async () => {
    await form();
    ok(await call('type_text', { selector: { id: FIELD }, text: 'ab' }));
    ok(await call('press_key', { key: 'command+a' }));
    ok(await call('press_key', { key: 'command+c' }));
    ok(await call('press_key', { key: 'delete' }));
    ok(await call('press_key', { key: 'command+v' }));
    ok(await reads('ab'));
    ok(await call('press_key', { key: 'z' }));
    ok(await call('press_key', { key: '7' }));
    ok(await reads('abz7'));
  });

  it('takes escape and a held arrow on a field, and leaves the app on the screen', async () => {
    await form();
    ok(await call('type_text', { selector: { id: FIELD }, text: 'xy' }));
    ok(await call('press_key', { key: 'shift+arrow_left' }));
    ok(await call('press_key', { key: 'delete' }));
    ok(await reads('x'));
    ok(await call('press_key', { key: 'escape' }));
    expect(ok(await call('device_info')).data.foreground).toBe(APP);
  });
}

/** What each view shows, by words a fresh device has. */
function viewsOf(get: () => Call, shows: Record<'control' | 'notifications' | 'search', RegExp>) {
  const call: Call = (n, a) => get()(n, a);
  const opens = async (key: string, shown: RegExp) => {
    await call('terminate_app');
    ok(await call('launch_app'));
    try {
      const r = ok(await call('press_key', { key, read: 'full' }));
      expect(r.text).toMatch(new RegExp(`^opened ${key}`));
      expect(r.text).toMatch(shown);
      expect(r.text).not.toContain('no change seen');
    } finally {
      await call('press_key', { key: 'home' });
    }
  };

  it('opens Control Center by name, and reads what it shows', () =>
    opens('control_center', shows.control));

  it('opens Notification Center by name', () => opens('notification_center', shows.notifications));

  it('opens Spotlight by name', () => opens('spotlight', shows.search));

  it('reads the app again once home has closed a view over it', async () => {
    await call('terminate_app');
    ok(await call('launch_app'));
    ok(await call('press_key', { key: 'control_center' }));
    await call('press_key', { key: 'home' });
    ok(await call('launch_app'));
    expect(ok(await call('assert', { text: 'Form', timeoutMs: 5_000 })).error).toBe(false);
  });
}

describe.skipIf(!ANDROID)('keys on Android', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-keys-')));
    o = opsOn(androidProvider(new Adb()), ANDROID!, APP);
  });
  afterAll(() => o.ctx.close());
  keysOf(() => o.call);
  it('leaves a field by an arrow, and the next key lands in the next field', async () => {
    await o.call('terminate_app');
    ok(await o.call('launch_app'));
    ok(await o.call('open_link', { url: 'appdyno-fixture://open/form' }));
    ok(await o.call('type_text', { selector: { id: FIELD }, text: 'a' }));
    ok(await o.call('press_key', { key: 'arrow_down' }));
    ok(await o.call('press_key', { key: '5' }));
    ok(await o.call('assert', { id: 'phone_input', check: 'text', equals: '5', timeoutMs: 3_000 }));
  });
  viewsOf(() => o.call, {
    control: /elements/,
    notifications: /elements/,
    search: /foreground: com\.google\.android\.googlequicksearchbox/,
  });
});

describe.skipIf(!SIMULATOR)('keys on a simulator', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-keys-')));
    await new Simctl().install(SIMULATOR!, SIM_FIXTURE);
    o = opsOn(appleProvider(), SIMULATOR!, APP);
  }, 300_000);
  afterAll(() => o.ctx.close());
  keysOf(() => o.call);
  viewsOf(() => o.call, {
    control: /"Add Controls"/,
    notifications: /id=lockscreen-date-view/,
    search: /id=inputView/,
  });
});

describe.skipIf(!IPHONE)('keys on an iPhone', () => {
  let o: Awaited<ReturnType<typeof onIphone>>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-keys-')));
    o = await onIphone(APP);
  }, 300_000);
  afterAll(async () => {
    await o.call('terminate_app');
    await o.ctx.end();
    o.ctx.close();
  }, 60_000);
  keysOf(() => o.call);
  viewsOf(() => o.call, {
    control: /elements/,
    notifications: /elements/,
    search: /elements/,
  });
});
