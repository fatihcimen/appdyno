import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  must,
  type DeviceSettings,
  type SettingName,
  type Push,
  type PushRoute,
  type VirtualDevices,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './shared.js';

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-driving-')));
});

describe('device conditions', () => {
  class Settings implements DeviceSettings {
    values: Record<string, string> = { dark_mode: 'no', text_size: '1.0' };
    failing = false;
    pushed: unknown[] = [];
    get = (name: SettingName) => {
      if (name === 'network')
        return Promise.reject(new DeviceError('UNSUPPORTED', 'a phone has no network shaping'));
      return Promise.resolve(must(this.values[name], name));
    };
    set = (name: SettingName, value: string): Promise<undefined> => {
      if (this.failing) return Promise.reject(new DeviceError('INTERNAL', 'broke'));
      this.values[name] = value;
      return Promise.resolve(undefined);
    };
    /** The app each listing of routes was for. */
    routesFor: (string | undefined)[] = [];
    pushRoutes = (app?: string): Promise<PushRoute[]> => {
      this.routesFor.push(app);
      return Promise.resolve([
        { type: 'alert', route: 'by hand', fields: ['title', 'data'], template: '{"aps":{}}' },
        { type: 'tapped', why: 'no hand' },
        { type: 'widgets', route: 'by APNs', fields: [], template: '{"aps":{}}' },
      ]);
    };
    push = (app: string, push: Push) => {
      this.pushed.push([app, push]);
      return Promise.resolve(`pushed to ${app}`);
    };
    biometric = () => Promise.reject(new DeviceError('UNSUPPORTED', 'simulator only'));
    resetKeychain = () => Promise.resolve(3);
    events: unknown[] = [];
    call = (number: string, end: boolean) => {
      this.events.push(['call', number, end]);
      return Promise.resolve();
    };
    sms = (from: string, text: string) => {
      this.events.push(['sms', from, text]);
      return Promise.resolve();
    };
  }

  it('answers changed only when the device reads it moved, as a command may take what it cannot do and say nothing', async () => {
    const settings = new Settings();
    settings.values.text_size = 'large';
    const set = settings.set;
    // as a simulator takes 1.3: "Invalid argument", and exit 0
    settings.set = (name: SettingName, value: string) =>
      value === '1.3' ? Promise.resolve(undefined) : set(name, value);
    const { call } = await connect(Object.assign(new FakeDevice(), { settings }));
    const r = await call('device_setting', { name: 'text_size', value: '1.3' });
    expect([r.error, r.text, r.data.changed, r.data.value]).toEqual([
      false,
      'text_size reads large, as before: nothing changed',
      undefined,
      'large',
    ]);
    // what it read back, which a window shows as its row and need not read again
    expect(r.data.reads).toEqual({ text_size: 'large' });
    expect((await call('device_setting', { name: 'restore' })).text).toBe('nothing was changed');
    const moved = await call('device_setting', { name: 'text_size', value: 'extra-large' });
    expect(moved.data.changed).toEqual({ text_size: 'extra-large' });
    expect(moved.data.reads).toEqual({ text_size: 'extra-large' });
  });

  it('restores only what reads as it was, and keeps the rest written down with what it reads', async () => {
    const settings = new Settings();
    const { call } = await connect(Object.assign(new FakeDevice(), { settings }));
    await call('device_setting', { name: 'dark_mode', value: 'on' });
    const set = settings.set;
    // as Android's own write of a scale just before lands after the one that puts it back
    settings.set = () => Promise.resolve(undefined);
    const r = await call('device_setting', { name: 'restore' });
    expect(r.text).toBe('could not restore dark_mode (was no): it reads on');
    expect(r.data.notRestored).toHaveLength(1);
    expect(r.data.reads).toEqual({ dark_mode: 'on' });
    settings.set = set;
    const back = await call('device_setting', { name: 'restore' });
    expect([back.text, back.data.reads]).toEqual(['restored dark_mode: off', { dark_mode: 'off' }]);
  });

  it("reads a battery back at default whatever its level, which is the moment's and no part of what is set", async () => {
    const settings = new Settings();
    settings.values.battery = 'default (now 80)';
    const set = settings.set;
    settings.set = (name: SettingName, value: string) =>
      set(name, value.startsWith('default') ? 'default (now 79)' : value);
    const { call } = await connect(Object.assign(new FakeDevice(), { settings }));
    await call('device_setting', { name: 'battery', value: '50' });
    expect((await call('device_setting', { name: 'restore' })).text).toBe(
      'restored battery: default (now 80)',
    );
    expect((await call('device_setting', { name: 'battery', value: 'default' })).text).toBe(
      'battery reads default (now 79), as before: nothing changed',
    );
  });

  it('takes one-shot events, and refuses what is not one', async () => {
    const settings = new Settings();
    const { call } = await connect(Object.assign(new FakeDevice(), { settings, events: settings }));
    await call('device_setting', { name: 'call', value: '+905551112233' });
    await call('device_setting', { name: 'call', value: 'end +905551112233' });
    await call('device_setting', { name: 'sms', title: '5553434', value: 'Merhaba' });
    expect(settings.events).toEqual([
      ['call', '+905551112233', false],
      ['call', '+905551112233', true],
      ['sms', '5553434', 'Merhaba'],
    ]);
    expect((await call('device_setting', { name: 'call', value: 'someone' })).text).toMatch(
      /phone number/,
    );
    expect((await call('device_setting', { name: 'sms', title: 'x', value: 'y' })).text).toMatch(
      /phone number/,
    );
  });

  it('keeps a change written down when the device refused after making it, and forgets one it never made', async () => {
    const settings = new Settings();
    settings.values.fold = 'default (now open)';
    // as a fold does that is asked for and does not read back in time: the request went, and holds
    settings.set = (name: SettingName, value: string) => {
      settings.values[name] = value;
      if (value === 'closed')
        return Promise.reject(new DeviceError('UNSUPPORTED', 'it stays in state 3'));
      return Promise.resolve(undefined);
    };
    const { call } = await connect(Object.assign(new FakeDevice(), { settings }));
    expect((await call('device_setting', { name: 'fold', value: 'closed' })).data.code).toBe(
      'UNSUPPORTED',
    );
    expect((await call('device_setting', { name: 'restore' })).text).toBe(
      'restored fold: default (now open)',
    );
    expect(settings.values.fold).toBe('default (now open)');
    settings.set = () => Promise.reject(new DeviceError('UNSUPPORTED', 'no fold here'));
    await call('device_setting', { name: 'fold', value: 'closed' });
    expect((await call('device_setting', { name: 'restore' })).text).toBe('nothing was changed');
  });

  it('changes a condition and puts it back at the end of the session', async () => {
    const settings = new Settings();
    const d = Object.assign(new FakeDevice(), { settings });
    const { call, ctx } = await connect(d);
    // read as it is set on both platforms: Android says no, iOS light
    expect((await call('device_setting', { name: 'dark_mode' })).data.value).toBe('off');
    expect((await call('device_setting', { name: 'dark_mode', value: 'on' })).text).toBe(
      'dark_mode: on; put back when this session ends, or by restore; it cannot be kept past the session',
    );
    settings.values.dark_mode = 'dark';
    expect((await call('device_setting', { name: 'dark_mode' })).text).toBe('dark_mode: on');
    await call('device_setting', { name: 'dark_mode', value: 'off' });
    await call('device_setting', { name: 'text_size', value: '1.3' });
    settings.values.fold = 'default (now open)';
    await call('device_setting', { name: 'fold', value: 'closed' });
    expect(settings.values).toEqual({ dark_mode: 'off', text_size: '1.3', fold: 'closed' });
    expect(await ctx.end()).toEqual([]);
    expect(settings.values).toEqual({
      dark_mode: 'no',
      text_size: '1.0',
      fold: 'default (now open)',
    });
  });

  it('puts back what the session changed before its device shuts down, while it still answers, and says so', async () => {
    const settings = new Settings();
    const off: string[] = [];
    const fleet: VirtualDevices = {
      kind: 'simulator',
      platform: 'ios',
      startable: () => Promise.resolve([{ id: 'B', name: 'two', state: 'running', serial: 'B' }]),
      boot: (id) => Promise.resolve(id),
      shutdown: (id) => {
        off.push(`${id} with ${JSON.stringify(settings.values)}`);
        return Promise.resolve();
      },
    };
    const d = Object.assign(new FakeDevice(), { settings });
    const { call, ctx } = await connect(d, { virtual: fleet });
    await ctx.use('B');
    await call('device_setting', { name: 'dark_mode', value: 'on' });
    await call('device_setting', { name: 'text_size', value: '1.3' });
    const r = await call('simulator', { action: 'shutdown', name: 'B' });
    expect(r.text).toBe(
      'shut down two: the session on two ended, and what its apps held with it; what the session changed went back first: text_size: 1.0; dark_mode: off',
    );
    expect(off).toEqual(['B with {"dark_mode":"no","text_size":"1.0"}']);
    // what went back is no longer written down: the next session has nothing of it to put back
    expect(await ctx.end()).toEqual([]);
    await ctx.use('B');
    await call('device_setting', { name: 'dark_mode', value: 'on' });
    settings.failing = true;
    expect((await call('simulator', { action: 'shutdown', name: 'B' })).text).toMatch(
      /; could not put back dark_mode \(was no\): broke$/,
    );
  });

  it("refuses a condition held for another app, as that app's could not be put back", async () => {
    const settings = new Settings();
    const { call } = await connect(Object.assign(new FakeDevice(), { settings }));
    settings.values.locale = '';
    await call('device_setting', { name: 'locale', value: 'tr-TR', app: 'a.one' });
    await call('device_setting', { name: 'locale', value: 'de', app: 'a.one' });
    const other = await call('device_setting', { name: 'locale', value: 'de', app: 'a.two' });
    expect([other.data.code, other.text]).toEqual([
      'INVALID_ARGUMENT',
      'INVALID_ARGUMENT: locale is held for a.one until it is put back\nhint: device_setting restore first',
    ]);
    expect(settings.values.locale).toBe('de');
    expect((await call('device_setting', { name: 'restore' })).text).toBe('restored locale');
  });

  it('restores on request, and reports what it cannot', async () => {
    const settings = new Settings();
    const d = Object.assign(new FakeDevice(), { settings });
    const { call, ctx } = await connect(d);
    await call('device_setting', { name: 'dark_mode', value: 'on' });
    settings.failing = true;
    const r = await call('device_setting', { name: 'restore' });
    expect(r.text).toContain('could not restore dark_mode');
    expect(r.data.notRestored).toHaveLength(1);
    expect((await ctx.end())[0]).toContain('dark_mode');
    settings.failing = false;
    expect((await call('device_setting', { name: 'restore' })).text).toContain(
      'restored dark_mode',
    );
    expect(settings.values.dark_mode).toBe('no');
    expect((await call('device_setting', { name: 'restore' })).text).toContain(
      'nothing was changed',
    );
  });

  it('passes on a refusal, posts a push, and says biometrics are not here', async () => {
    const settings = new Settings();
    const d = Object.assign(new FakeDevice(), { settings, events: settings });
    const { call } = await connect(d, { policy: { allowDataLoss: 'virtual' } });
    const net = await call('device_setting', { name: 'network', value: 'slow' });
    expect(net.data.code).toBe('UNSUPPORTED');
    expect(net.text).toContain('a phone has no network shaping');
    expect((await call('push')).text).toBe('alert: by hand\ntapped: no: no hand\nwidgets: by APNs');
    await call('push', { app: 'dev.other' });
    // the session's app, then the one named: a route may depend on the app's build
    expect(settings.routesFor).toEqual(['dev.app', 'dev.other']);
    const pushed = await call('push', {
      type: 'alert',
      title: 'T',
      data: { k: 'v' },
      read: 'none',
    });
    expect(pushed.text).toBe('pushed to dev.app');
    expect(settings.pushed).toEqual([['dev.app', { type: 'alert', title: 'T', data: { k: 'v' } }]]);
    expect((await call('push', { type: 'tapped' })).text).toBe(
      'UNSUPPORTED: no hand\nhint: type alert, widgets still work here',
    );
    expect((await call('push', { type: 'widgets', title: 'T' })).text).toBe(
      'INVALID_ARGUMENT: widgets here takes payload alone: not title',
    );
    expect((await call('push', { type: 'loud' })).text).toMatch(
      /^INVALID_ARGUMENT: type: alert, background, .*, not loud$/,
    );
    for (const [payload, why] of [
      ['[1]', 'payload is JSON: an object'],
      ['{', 'payload is JSON: an object'],
      [`{"a":"${'x'.repeat(4_100)}"}`, 'a payload is 4096 bytes at most'],
    ] as const)
      expect((await call('push', { type: 'alert', payload })).text).toBe(
        `INVALID_ARGUMENT: ${why}`,
      );
    const b = await call('device_setting', { name: 'biometric', value: 'match' });
    expect(b.data.code).toBe('UNSUPPORTED');
    expect((await call('device_setting', { name: 'biometric', value: 'x' })).error).toBe(true);
    const keychain = await call('device_setting', { name: 'keychain', value: 'reset' });
    expect(keychain.text).toBe('the keychain is empty: it held 3 items');
    expect((await call('device_setting', { name: 'keychain' })).text).toMatch(/needs value: reset/);
  });

  it("reads no app's routes off the allow list", async () => {
    const settings = new Settings();
    const d = Object.assign(new FakeDevice(), { settings, events: settings });
    const { call } = await connect(d, { policy: { apps: ['dev.app'] } });
    expect((await call('push', { app: 'dev.other' })).data.code).toBe('POLICY_DENIED');
    expect(settings.routesFor).toEqual([]);
  });

  it('sends a title or body with no type as an alert, saying so, and never drops it for the list of types', async () => {
    const settings = new Settings();
    const d = Object.assign(new FakeDevice(), { settings, events: settings });
    const { call } = await connect(d);
    const sent = await call('push', { title: 'Order 42 shipped', read: 'none' });
    expect(sent.text).toBe('pushed to dev.app (as alert: no type was given)');
    expect(settings.pushed).toEqual([['dev.app', { type: 'alert', title: 'Order 42 shipped' }]]);
    // what no alert takes with no type is refused, naming the types that go
    const data = await call('push', { data: { k: 'v' } });
    expect(data.text).toBe(
      'INVALID_ARGUMENT: data with no type: give one, as only a title or body goes as alert by itself\nhint: type alert, widgets still work here',
    );
    expect((await call('push')).text).toBe('alert: by hand\ntapped: no: no hand\nwidgets: by APNs');
    settings.pushRoutes = () =>
      Promise.resolve([
        { type: 'alert', why: 'the app has no Firebase Messaging' },
        { type: 'background', route: 'by hand', fields: ['data'], template: '{}' },
      ]);
    expect((await call('push', { body: 'Order 42 shipped' })).text).toBe(
      'UNSUPPORTED: a title or body with no type goes as alert, and alert cannot go here: the app has no Firebase Messaging\nhint: type background still works here',
    );
    expect(settings.pushed).toHaveLength(1);
  });
});
