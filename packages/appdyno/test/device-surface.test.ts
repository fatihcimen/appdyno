import { beforeEach, describe, expect, it, vi } from 'vitest';
import { must } from '@appdyno/core';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { openDevice } from '../src/device.js';
import { connect } from '../src/library.js';

/** Its own serial: what holds a device is a file other tests of this run write too. */
const SERIAL = 'emulator-5660';
let device = new FakeDevice(SERIAL);

/** What the drivers were made with, the last time: an iPhone's signing is the fifth. */
let providersGiven: unknown[] = [];

vi.mock('../src/providers.js', () => ({
  deviceProviders: (...given: unknown[]) => [
    {
      list: () => Promise.resolve([]),
      handles: (s: string) => s.startsWith('emulator-'),
      open: () => {
        providersGiven = given;
        return device;
      },
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

describe('the policy a program gives', () => {
  it('hides its secrets in what a read shows, whole before the cut', async () => {
    device.screen = 'settings';
    const d = await openDevice(SERIAL, { share: true, policy: { secrets: ['Wi-Fi'] } });
    const { elements } = await d.screen();
    expect(elements.some((e) => e.label === '••• On')).toBe(true);
    expect(JSON.stringify(elements)).not.toContain('Wi-Fi');
    await d.close();
  });

  it('keeps launch and terminate to the apps it lists', async () => {
    const d = await openDevice(SERIAL, { share: true, policy: { apps: ['dev.app'] } });
    await expect(d.launch('other.app')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await expect(d.terminate('other.app')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(device.calls.some((c) => c.name === 'launch' || c.name === 'terminate')).toBe(false);
    await d.terminate('dev.app');
    expect(device.calls.at(-1)).toEqual({ name: 'terminate', args: ['dev.app'] });
    await d.close();
  });

  it('is the same object for connect, where it adds to the options of the same meaning', async () => {
    const tools = connect({
      device: SERIAL,
      share: true,
      secrets: ['Bluetooth'],
      policy: { apps: ['dev.app'], secrets: ['Wi-Fi'] },
    });
    await expect(tools.tool('launch_app', { app: 'other.app' })).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    device.screen = 'settings';
    const { text } = await tools.tool('screen', {});
    expect(text).toContain('•••');
    expect(text).not.toMatch(/Wi-Fi|Bluetooth/);
    await tools.close();
  });

  it('says a policy or a signing that is not what it takes', async () => {
    const bad = (options: object) =>
      expect(openDevice(SERIAL, { share: true, ...options })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
    await bad({ policy: { apps: 'dev.app' } });
    await bad({ policy: { secrets: [1] } });
    await bad({ policy: { urls: '^myapp:' } });
    await bad({ signing: { keychain: 'login.keychain' } });
    expect(() => connect({ policy: { write: '/tmp' as never } })).toThrow(/policy\.write/);
  });
});

describe('the signing a program gives', () => {
  it('goes to the driver of this device alone, by either entry', async () => {
    const signing = { profile: '/p/one.mobileprovision', keychainPassword: 'k' };
    const d = await openDevice(SERIAL, { share: true, signing });
    expect(providersGiven[4]).toEqual(signing);
    await d.close();
    const plain = await openDevice(SERIAL, { share: true });
    expect(providersGiven[4]).toBeUndefined();
    await plain.close();
    const tools = connect({ device: SERIAL, share: true, signing });
    await tools.tool('screen', {});
    expect(providersGiven[4]).toEqual(signing);
    await tools.close();
  });
});
