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
