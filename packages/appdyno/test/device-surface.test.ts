import { beforeEach, describe, expect, it, vi } from 'vitest';
import { must } from '@appdyno/core';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { openDevice } from '../src/device.js';

/** Its own serial: what holds a device is a file other tests of this run write too. */
const SERIAL = 'emulator-5660';
let device = new FakeDevice(SERIAL);

vi.mock('../src/providers.js', () => ({
  deviceProviders: () => [
    {
      list: () => Promise.resolve([]),
      handles: (s: string) => s.startsWith('emulator-'),
      open: () => device,
    },
  ],
}));

beforeEach(() => {
  device = new FakeDevice(SERIAL);
});

const opened = () => openDevice(SERIAL, { app: 'dev.app', share: true });

describe('an element of a read', () => {
  it('names its nearest listed ancestor, its app and its place in the reading order', async () => {
    device.screen = 'settings';
    const d = await opened();
    const { elements } = await d.screen();
    const row = must(
      elements.find((e) => e.label === 'Wi-Fi On'),
      'the Wi-Fi row',
    );
    expect(row).toMatchObject({ pkg: 'dev.app' });
    expect(elements.map((e) => e.order)).toEqual(elements.map((_, n) => n));
    // every parent is a place in this list, of an element that comes before it
    for (const [n, e] of elements.entries())
      if (e.parent !== undefined) expect(e.parent).toBeLessThan(n);
    await d.close();
  });

  it('is under the dialog it is in, where a dialog holds it', async () => {
    device.permissionUp = true;
    const d = await opened();
    const { elements } = await d.screen();
    const allow = must(
      elements.find((e) => e.label === 'Uygulamayı kullanırken'),
      'the button',
    );
    expect(allow.pkg).toBe('com.android.permissioncontroller');
    expect(allow.parent === undefined || elements[allow.parent]?.pkg === allow.pkg).toBe(true);
    await d.close();
  });
});

describe('an aim that waits', () => {
  it('finds an element that came after the first read, and refuses at once with no wait', async () => {
    const d = await opened();
    const tree = device.tree.bind(device);
    let reads = 0;
    device.tree = () => {
      reads += 1;
      if (reads === 3) device.screen = 'form';
      return tree();
    };
    await expect(d.aim({ text: 'Bilgiler' }, { waitMs: 0 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const found = await d.aim({ text: 'Bilgiler' });
    expect(found.element.label).toBe('Bilgiler');
    expect(found.on).toBe((await d.screen()).hash);
    await d.close();
  });
});
