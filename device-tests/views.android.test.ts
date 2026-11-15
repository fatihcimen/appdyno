import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Adb, androidProvider } from './workspace.js';
import { type Answer, type Call, opsOn } from './helpers.js';

/**
 * `screen views` on the emulator or phone APPDYNO_ANDROID_SERIAL names: a screen of the fixture for each framework it
 * labels, read from the system's own dump of the activity in front, of the debug build as installed and with no probe.
 */
const APP = 'dev.appdyno.fixture';
const ANDROID = process.env.APPDYNO_ANDROID_SERIAL ?? '';
/** One for the file: a describe in a folder of its own finds no agent there, and the one it starts ends the last. */
const STATE = mkdtempSync(join(tmpdir(), 'appdyno-views-'));

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

describe.skipIf(!ANDROID)('the native views on Android', () => {
  let o: ReturnType<typeof opsOn>;
  let call: Call;
  /** The views once the activity a link opens is the one in front: it starts after the link's answer. */
  const viewsOf = async (screen: string, activity: string, raw = false) => {
    ok(await call('open_link', { url: `appdyno-fixture://open/${screen}`, read: 'none' }));
    let r: Awaited<ReturnType<typeof call<'screen'>>> | undefined;
    await vi.waitFor(
      async () => {
        r = ok(await call('screen', { views: true, raw }));
        expect(r.text).toContain(`(${APP}.${activity})`);
      },
      { timeout: 10_000, interval: 500 },
    );
    if (!r) throw new Error('no views');
    return r;
  };

  beforeAll(async () => {
    vi.stubEnv('APPDYNO_STATE_DIR', STATE);
    o = opsOn(androidProvider(new Adb()), ANDROID, APP);
    call = o.call;
    ok(await call('launch_app', { restart: true, read: 'none' }));
  });
  afterAll(() => {
    o.ctx.close();
  });

  it.each([
    ['compose', 'ComposeActivity', 'Compose'],
    ['web', 'WebActivity', 'web view'],
    ['form', 'FormActivity', 'Android views'],
  ])('labels the fixture %s screen, %s, as %s', async (screen, activity, framework) => {
    const r = await viewsOf(screen, activity);
    expect(r.text.split('\n')[0]).toBe(`framework: ${framework}`);
  });

  it("places a view where the accessibility tree has it, in the screen's pixels", async () => {
    const r = await viewsOf('form', 'FormActivity', true);
    const id = `${APP}:id/submit`;
    const view = r.data.views?.find((v) => v.id === id);
    const node = ok(await call('screen', { raw: true })).data.nodes?.find(
      (n) => n.identifier === id,
    );
    expect(view?.flags).toContain('clickable');
    expect(node?.rect).toBeDefined();
    expect(view?.rect).toEqual(node?.rect);
  });

  it('says where a scroll leaves places as laid out, and that a dialog over the activity is not there', async () => {
    await viewsOf('showcase', 'ShowcaseActivity');
    ok(await call('swipe', { direction: 'up', distance: 600, read: 'none' }));
    expect(ok(await call('screen', { views: true })).text).toMatch(
      /\nunder android\.widget\.ScrollView at 0,0 .* places are its layout's/,
    );
    await viewsOf('dialog', 'DialogActivity');
    ok(await call('tap', { selector: { id: 'open_dialog' }, read: 'none' }));
    await vi.waitFor(async () =>
      expect(ok(await call('screen', { views: true })).text).toContain(
        'a window over the activity, as a dialog or a menu, is not in these views: screen reads it',
      ),
    );
    ok(await call('press_key', { key: 'back', read: 'none' }));
  });

  it('launches with no probe, saying that none is needed', async () => {
    const r = ok(await call('launch_app', { probe: true, read: 'none' }));
    expect(r.text).toContain(
      'this device reads its views without a probe: screen views needs none',
    );
  });

  it('refuses an app whose main thread does not answer, and reads it once it does', async () => {
    ok(await call('launch_app', { restart: true, read: 'none' }));
    ok(await call('tap', { selector: { text: 'Freeze' }, read: 'none' }));
    const r = await call('screen', { views: true });
    expect(r.data.code).toBe('TIMEOUT');
    expect(r.text).toContain(`${APP}/.MainActivity did not give its views: it is not answering`);
    await vi.waitFor(async () => ok(await call('screen', { views: true })), {
      timeout: 20_000,
      interval: 1_000,
    });
  });
});
