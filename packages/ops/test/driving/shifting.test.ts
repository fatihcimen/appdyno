import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Tree } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { connect } from './shared.js';

/** A screen read on a device, as the agent sent it. */
const recorded = (name: string) =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../fixtures/apps', `${name}.json`), 'utf8'),
  ) as Tree;

const FIXTURE_APP = { defaults: { app: 'dev.appdyno.fixture' } };
const CLOSES = 'close it (back, or a tap outside) or act in it';

/** The fake app, its screen read as `nodes` from the read `n` on, as an app that moves on by itself. */
class MovesOn extends FakeDevice {
  reads = 0;
  constructor(
    readonly after: number,
    readonly to: string,
  ) {
    super();
  }
  override tree() {
    if (++this.reads > this.after) this.screen = this.to;
    return super.tree();
  }
}

describe('what covers the app', () => {
  it('says first that a bottom sheet is open over the app, where a wait runs out', async () => {
    const d = new FakeDevice();
    d.fixture = recorded('android-fixture-sheet');
    const { call } = await connect(d, FIXTURE_APP);
    const r = await call('run_steps', {
      steps: [{ tool: 'check_element', selector: { id: 'next_button' }, timeoutMs: 300 }],
      read: 'none',
    });
    expect(r.data.code).toBe('CHECK_FAILED');
    expect(r.text).toContain(
      `1. check_element failed, the rest were not run: a bottom sheet is open over the app: "Choose a plan"; ${CLOSES}; id="next_button" not shown after 300 ms; nearest: `,
    );
  });

  it(
    'says it of a dialog where a touch finds no target, a ref is stale, or a check finds none',
    fakeTimed(async () => {
      const d = new FakeDevice();
      d.fixture = recorded('android-fixture-dialog');
      const { call } = await connect(d, FIXTURE_APP);
      const over = `a dialog is open over the app: "Emin misiniz?"; ${CLOSES}; `;
      const tap = await call('tap_screen', { selector: { text: 'Next' }, read: 'none' });
      expect(tap.text).toContain(`NOT_FOUND: ${over}no element matches text="Next" after`);
      const stale = await call('tap_screen', { ref: '@zz9z', read: 'none' });
      expect(stale.text).toContain(`STALE: ${over}stale ref: @zz9z is not on this screen`);
      const check = await call('check_element', { selector: { text: 'Next' } });
      expect(check.text).toContain(`CHECK_FAILED: ${over}text="Next" is not on the screen`);
      const alone = await call('check_element', { selector: { text: 'Next' }, timeoutMs: 300 });
      expect(alone.text).toContain(`CHECK_FAILED: ${over}text="Next" not shown after 300 ms`);
    }),
  );

  it('says nothing where the app is whole: a keyboard, a share sheet, a permission prompt, the launcher', async () => {
    for (const [name, app] of [
      ['android-fixture-keyboard', 'dev.appdyno.fixture'],
      ['android-share-over-fixture', 'dev.appdyno.fixture'],
      ['android-fixture-permission', 'dev.appdyno.fixture'],
      ['android-home', 'com.google.android.apps.nexuslauncher'],
    ] as const) {
      const d = new FakeDevice();
      d.fixture = recorded(name);
      const { call } = await connect(d, { defaults: { app } });
      const r = await call('check_element', { selector: { id: 'nothing_here' }, timeoutMs: 300 });
      expect(r.error, name).toBe(true);
      expect(r.text, name).not.toContain('open over the app');
    }
  });
});

describe('a wait for an element to show', () => {
  it('passes once the element holds through the quiet window, with one read more', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    const r = await call('check_element', { selector: { text: 'Form' }, timeoutMs: 3_000 });
    expect(r.error).toBe(false);
    expect(r.done).toMatch(/^found: @\w+ "Form"/);
    expect(d.calls.filter((c) => c.name === 'tree')).toHaveLength(2);
  });

  it('passes on no frame of a screen on its way out, and says it was shown', async () => {
    const d = new MovesOn(1, 'form');
    const { call } = await connect(d);
    const r = await call('check_element', { selector: { text: 'Form' }, timeoutMs: 600 });
    expect(r.data.code).toBe('CHECK_FAILED');
    expect(r.done).toMatch(
      /^CHECK_FAILED: text="Form" not shown after 600 ms; it was shown, then the screen changed to "Bilgiler"; nearest: /,
    );
  });

  it('holds on a screen whose layout moves while its element stays, as under a banner', async () => {
    const d = new FakeDevice();
    let n = 0;
    const read = d.tree.bind(d);
    d.tree = async () => ({ ...(await read()), hash: `moving-${String(n++)}` });
    const { call } = await connect(d);
    const r = await call('check_element', { selector: { text: 'Form' }, timeoutMs: 3_000 });
    expect(r.error).toBe(false);
  });
});

describe('what came between two steps', () => {
  it(
    'says a wait showed the target, and the screen changed before the step that missed it',
    fakeTimed(async () => {
      const d = new FakeDevice();
      const press = d.key.bind(d);
      // a key the app takes as leaving: what the wait showed is gone by the touch
      d.key = (...a: Parameters<FakeDevice['key']>) => {
        d.screen = 'form';
        return press(...a);
      };
      const { call } = await connect(d);
      const r = await call('run_steps', {
        steps: [
          { tool: 'check_element', selector: { text: 'Form' }, timeoutMs: 3_000 },
          { tool: 'press_key', key: 'tab' },
          { tool: 'tap_screen', selector: { text: 'Form' } },
        ],
        read: 'none',
      });
      expect(r.data.code).toBe('NOT_FOUND');
      expect(r.text.split('\n').slice(0, 4)).toEqual([
        'NOT_FOUND: 1. text="Form" shown',
        '2. pressed tab',
        expect.stringMatching(
          /^3\. tap_screen failed, the rest were not run: no element matches text="Form"/,
        ),
        'text="Form" was shown at step 1, and the screen changed to "Bilgiler" before step 3',
      ]);
    }),
  );
});
