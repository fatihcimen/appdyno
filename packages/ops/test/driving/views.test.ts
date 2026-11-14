import type { ViewTree } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './shared.js';

const SCREEN = { x: 0, y: 0, width: 1080, height: 2400 };

const TREE: ViewTree = {
  truncated: false,
  views: [
    { class: 'com.android.internal.policy.DecorView', rect: SCREEN },
    { class: 'androidx.compose.ui.platform.ComposeView', rect: SCREEN, parent: 0 },
    {
      class: 'android.view.View',
      rect: { x: 40, y: 600, width: 1000, height: 120 },
      label: 'Pay',
      text: 'card hunter2',
      parent: 1,
    },
  ],
};

describe('the native views of a screen', () => {
  it('are refused where the device gives none, with what reads the screen there', async () => {
    const { call } = await connect(new FakeDevice());
    expect((await call('screen', { views: true })).text).toBe(
      'UNSUPPORTED: this device gives no native view hierarchy\nhint: screen without views reads its accessibility tree',
    );
  });

  it('come folded under the framework that draws them, and with raw as data, a secret kept off both', async () => {
    const d = Object.assign(new FakeDevice(), { views: () => Promise.resolve(TREE) });
    const { call } = await connect(d, { policy: { secrets: ['hunter2'] } });
    const lines = await call('screen', { views: true });
    expect(lines.text).toBe(
      'framework: Compose\ncom.android.internal.policy.DecorView > androidx.compose.ui.platform.ComposeView > android.view.View "Pay" text "card •••" 40,600 1000x120',
    );
    expect(lines.data).toMatchObject({ elements: 3, framework: 'Compose' });
    expect(lines.data.views).toBeUndefined();
    const raw = await call('screen', { views: true, raw: true });
    expect(raw.data.views?.map((v) => v.class)).toEqual(TREE.views.map((v) => v.class));
    expect(raw.data.views?.[2]).toMatchObject({ label: 'Pay', parent: 1 });
    expect(JSON.stringify([lines, raw])).not.toContain('hunter2');
  });
});
