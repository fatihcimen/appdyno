import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { macSyncsPasteboard } from '../packages/driver-apple/src/sim-clipboard.js';
import { Adb, androidProvider, simulatorProvider, Simctl } from './workspace.js';
import { type Answer, type Call, IPHONE, onIphone, opsOn, SIM_FIXTURE } from './helpers.js';

/**
 * What a keyboard does in a real field, read back from it, on the emulator APPDYNO_ANDROID_SERIAL names and the
 * simulator APPDYNO_IOS_UDID names; with APPDYNO_SIM_DIRECT=off, by the runner's own keys.
 */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL ?? '';
const SIMULATOR = process.env.APPDYNO_IOS_UDID ?? '';
const FIELD = 'name_input';

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

/** `synced`: whether a copy there would reach this Mac's clipboard, a person's, as a simulator's does while Simulator.app syncs. */
function keysOf(get: () => Call, synced = () => Promise.resolve(false)) {
  const call: Call = (n, a) => get()(n, a);
  const form = async () => {
    await call('manage_app', { action: 'stop' });
    ok(await call('launch_app'));
    ok(await call('open_link', { url: 'appdyno-fixture://open/form' }));
  };
  const reads = (equals: string) =>
    call('check_element', { selector: { id: FIELD }, check: 'text', equals, timeoutMs: 3_000 });

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

  it('copies and pastes by shortcuts, and types a letter and a digit as keys', async (ctx) => {
    if (await synced()) return ctx.skip();
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
    expect(ok(await call('list_devices', { selected: true })).data.foreground).toBe(APP);
  });
}

/** What each view shows, by words a fresh device has, or by the id of a view the read leaves out as it says nothing. */
function viewsOf(
  get: () => Call,
  shows: Record<'control' | 'notifications' | 'search', RegExp | { id: string }>,
) {
  const call: Call = (n, a) => get()(n, a);
  const opens = async (key: string, shown: RegExp | { id: string }) => {
    await call('manage_app', { action: 'stop' });
    ok(await call('launch_app'));
    try {
      const r = ok(await call('press_key', { key, read: 'full' }));
      expect(r.text).toMatch(new RegExp(`^opened ${key}`));
      if (shown instanceof RegExp) expect(r.text).toMatch(shown);
      else ok(await call('check_element', { selector: shown }));
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
    await call('manage_app', { action: 'stop' });
    ok(await call('launch_app'));
    ok(await call('press_key', { key: 'control_center' }));
    await call('press_key', { key: 'home' });
    ok(await call('launch_app'));
    expect(
      ok(await call('check_element', { selector: { text: 'Form' }, timeoutMs: 5_000 })).error,
    ).toBe(false);
  });
}

describe.skipIf(!ANDROID)('keys on Android', () => {
  let o: ReturnType<typeof opsOn>;
  beforeAll(() => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-keys-')));
    o = opsOn(androidProvider(new Adb()), ANDROID, APP);
  });
  afterAll(() => o.ctx.close());
  keysOf(() => o.call);
  it('leaves a field by an arrow, and the next key lands in the next field', async () => {
    await o.call('manage_app', { action: 'stop' });
    ok(await o.call('launch_app'));
    ok(await o.call('open_link', { url: 'appdyno-fixture://open/form' }));
    ok(await o.call('type_text', { selector: { id: FIELD }, text: 'a' }));
    ok(await o.call('press_key', { key: 'arrow_down' }));
    ok(await o.call('press_key', { key: '5' }));
    ok(
      await o.call('check_element', {
        selector: { id: 'phone_input' },
        check: 'text',
        equals: '5',
        timeoutMs: 3_000,
      }),
    );
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
    await new Simctl().install(SIMULATOR, SIM_FIXTURE);
    o = opsOn(simulatorProvider(), SIMULATOR, APP);
    // the runner's start here, in this budget: a hosted Mac took over 100 s for it, which the first case's 120 s ran out under
    ok(await o.call('launch_app'));
  }, 300_000);
  afterAll(() => o.ctx.close());
  keysOf(() => o.call, macSyncsPasteboard);
  it('types again into a field that let go of the focus with its first text, and the runner lives on', async () => {
    await o.call('manage_app', { action: 'stop' });
    ok(await o.call('launch_app'));
    ok(await o.call('open_link', { url: 'appdyno-fixture://open/focus_drop' }));
    // no US keyboard's text, so the runner types it with the helpers or without them; XCUI's delete into the field
    // without the focus ended the runner
    const drop = { id: 'drop_input' };
    const r = ok(await o.call('type_text', { selector: drop, text: 'Ayşe', replace: true }));
    expect(r.text).not.toMatch(/holds other text/);
    ok(
      await o.call('check_element', {
        selector: drop,
        check: 'text',
        equals: 'Ayşe',
        timeoutMs: 3_000,
      }),
    );
  });
  it('types into a search field that has moved away from where the tap found it, as it took the focus', async () => {
    // the bottom bar's field rises with the keyboard, which the focus check before the clear took for a field let go of
    ok(await o.call('open_link', { url: 'appdyno-fixture://open/search' }));
    const search = { text: 'Search rows' };
    ok(await o.call('type_text', { selector: search, text: 'Kapı', replace: true }));
    ok(
      await o.call('check_element', {
        selector: search,
        check: 'text',
        equals: 'Kapı',
        timeoutMs: 3_000,
      }),
    );
  });
  viewsOf(() => o.call, {
    control: /"Add Controls"/,
    // the date view holds only the date and time it lists, so a read leaves it out and a selector reaches it
    notifications: { id: 'lockscreen-date-view' },
    // its own field: inputView is the keyboard's, which the runner's keys bring a second later
    search: /foreground: com\.apple\.Spotlight[\s\S]*textField "Search/,
  });
});

describe.skipIf(!IPHONE)('keys on an iPhone', () => {
  let o: Awaited<ReturnType<typeof onIphone>>;
  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-keys-')));
    o = await onIphone(APP);
  }, 300_000);
  afterAll(async () => {
    await o.call('manage_app', { action: 'stop' });
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
