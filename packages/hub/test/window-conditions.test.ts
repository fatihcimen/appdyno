import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { must, startOf, type DeviceEvents } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { conditions, DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { windowSends } from '../src/window-sends.js';
import { Adb, AndroidDevice } from '@appdyno/driver-android';
import { IosPhoneDevice, IosSimulatorDevice } from '@appdyno/driver-apple';
import { CUTS_WHY, personal, switchOf } from '../src/window-conditions.js';
import { FakeDevice } from '../../ops/test/fake-device.js';

/** A device that reads back what was set, and refuses what its platform has not got. */
function deviceWith(values: Record<string, string>, refused: Record<string, string> = {}) {
  const device = new FakeDevice();
  const sets: [string, string][] = [];
  device.settings = {
    get: (name) => {
      const why = refused[name];
      return why
        ? Promise.reject(new DeviceError('UNSUPPORTED', why))
        : Promise.resolve(values[name] ?? 'off');
    },
    set: (name, value) => {
      sets.push([name, value]);
      values[name] = value;
      return Promise.resolve(undefined);
    },
  };
  device.events = {
    cannot: (e: string) => (e === 'call' ? 'a simulator has no telephony' : undefined),
  } as unknown as DeviceEvents;
  return { device, sets };
}

describe("a window's Device pane", () => {
  let state: string;
  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'appdyno-state-'));
    process.env.APPDYNO_STATE_DIR = state;
  });
  afterEach(() => rmSync(state, { recursive: true, force: true }));

  const paneOn = (device: FakeDevice) => {
    const told: Record<string, unknown>[] = [];
    const sends = windowSends(new ServerContext(DEFAULT_POLICY, []), device, () => ({
      tell: (m) => void told.push(m),
    }));
    const said = async (name: string, m: Record<string, unknown> = {}) => {
      told.length = 0;
      expect(sends.onWindow({ op: 'control', name, ...m })).toBe(true);
      await expect.poll(() => told.length).toBeGreaterThan(0);
      return must(told[0], 'an answer');
    };
    const rowOf = (m: Record<string, unknown>, name: string) =>
      (m.conditions as { name: string }[]).find((r) => r.name === name);
    return { sends, said, rowOf };
  };

  it('reads each condition as the device does, and says why where it cannot', async () => {
    const { device } = deviceWith(
      { dark_mode: 'default (now on)', animations: 'null,1,1', reduce_motion: '0,0,0' },
      { thermal: 'this tool sets no thermal state on Android' },
    );
    const { said, rowOf } = paneOn(device);
    const list = await said('deviceList');
    expect(list).toMatchObject({ op: 'answer', name: 'device', platform: 'android' });
    expect(rowOf(list, 'dark_mode')).toEqual({
      name: 'dark_mode',
      value: 'default (now on)',
      on: true,
    });
    expect(rowOf(list, 'animations')).toMatchObject({ on: true });
    expect(rowOf(list, 'reduce_motion')).toMatchObject({ on: true });
    // in a person's words, where the driver's are an agent's
    expect(rowOf(list, 'thermal')).toEqual({
      name: 'thermal',
      why: 'Android has no thermal state to set. Only an iPhone has one.',
    });
    expect(rowOf(list, 'call')).toEqual({ name: 'call', why: 'a simulator has no telephony' });
    expect(rowOf(list, 'biometric')).toEqual({ name: 'biometric' });
    expect(rowOf(list, 'wifi')).not.toHaveProperty('why');
  });

  it('changes a condition by the op, in the one record, and puts it back as the window closes', async () => {
    const { device, sets } = deviceWith({ dark_mode: 'off' });
    const { sends, said, rowOf } = paneOn(device);
    const done = await said('deviceSet', { args: { name: 'dark_mode', value: 'on' } });
    expect(done).toMatchObject({ ok: true, moved: true });
    expect(rowOf(done, 'dark_mode')).toEqual({
      name: 'dark_mode',
      value: 'on',
      on: true,
      changed: true,
    });
    expect(conditions.read(device.serial)?.dark_mode).toMatchObject({
      was: 'off',
      owner: { pid: process.pid },
    });
    // as it reads already: no change, and nothing more written down
    expect(await said('deviceSet', { args: { name: 'dark_mode', value: 'on' } })).toMatchObject({
      ok: true,
      moved: false,
    });
    expect(await sends.end()).toEqual([]);
    expect(sets.at(-1)).toEqual(['dark_mode', 'off']);
    expect(conditions.read(device.serial)).toBeUndefined();
  });

  it('puts back all it changed, and leaves what another process holds', async () => {
    const { device, sets } = deviceWith({ text_size: '1.0', locale: 'en-US' });
    const { said, rowOf } = paneOn(device);
    await said('deviceSet', { args: { name: 'text_size', value: '1.3' } });
    // an agent's server, a process of its own that still runs, changed the language
    const agent = { pid: process.ppid, started: startOf(process.ppid), tool: 'appdyno', since: '' };
    conditions.update(device.serial, (now = {}) => ({
      ...now,
      locale: { was: 'tr-TR', owner: agent },
    }));
    const list = await said('deviceList');
    expect(rowOf(list, 'locale')).toEqual({ name: 'locale', value: 'en-US' });
    const back = await said('deviceRestore');
    expect(back).toMatchObject({
      ok: true,
      text: `Restored text_size: 1.0\nleft alone, as its process still runs: locale (pid ${process.ppid})`,
    });
    expect(rowOf(back, 'text_size')).toEqual({ name: 'text_size', value: '1.0' });
    expect(conditions.read(device.serial)).toEqual({ locale: { was: 'tr-TR', owner: agent } });
    expect(sets).toEqual([
      ['text_size', '1.3'],
      ['text_size', '1.0'],
    ]);
  });

  it("on a phone, keeps to itself what could cut the hub's link to it", async () => {
    const { device, sets } = deviceWith({ wifi: 'on' });
    device.virtual = false;
    const { said, rowOf } = paneOn(device);
    expect(rowOf(await said('deviceList'), 'wifi')).toEqual({
      name: 'wifi',
      value: 'on',
      on: true,
      why: CUTS_WHY,
    });
    expect(await said('deviceSet', { args: { name: 'wifi', value: 'off' } })).toEqual({
      op: 'answer',
      name: 'device',
      ok: false,
      text: CUTS_WHY,
    });
    expect(sets).toEqual([]);
  });

  it('reads a switch as it stands', () => {
    expect(switchOf('dark_mode', 'default (now off)')).toBe(false);
    expect(switchOf('animations', '0,0.0,0')).toBe(false);
    expect(switchOf('reduce_motion', '1,1,1')).toBe(false);
    expect(switchOf('dark_mode', 'auto')).toBeUndefined();
  });

  it("says each reason a driver gives for what the pane shows in a person's words, with no setting id", async () => {
    const refusal = (asked: Promise<unknown>) =>
      asked.then(
        () => '',
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
    const simulator = new IosSimulatorDevice('00000000-0000-4000-8000-000000000001');
    const iphone = new IosPhoneDevice('00008110-0011223344556677');
    const emulator = new AndroidDevice('emulator-5999', new Adb());
    const phone = new AndroidDevice('R5PHONE0SERIAL', new Adb());
    const said = [
      ...(await Promise.all(
        (['animations', 'network', 'battery', 'wifi', 'fold', 'thermal'] as const).map((name) =>
          refusal(simulator.settings.get(name)),
        ),
      )),
      must(await simulator.settings.cannotSet('proxy'), 'the proxy'),
      ...(await Promise.all(
        (['reduce_transparency', 'thermal'] as const).map((name) =>
          refusal(emulator.settings.get(name)),
        ),
      )),
      ...(await Promise.all(
        (['animations', 'battery', 'fold', 'locale'] as const).map((name) =>
          refusal(iphone.settings.get(name)),
        ),
      )),
      ...(['call', 'sms'] as const).map((e) => simulator.events.cannot(e)),
      ...(['biometric', 'call', 'sms'] as const).map((e) => phone.events.cannot(e)),
      ...(['biometric', 'call', 'sms'] as const).map((e) => iphone.events.cannot(e)),
      'this device does not fold: its states are default',
      CUTS_WHY,
    ].map((why) => must(why, 'a reason'));
    iphone.close();
    emulator.close();
    phone.close();
    simulator.close();
    expect(said.filter((why) => !why)).toEqual([]);
    // CUTS_WHY is the window's own, a person's already
    expect(said.filter((why) => why !== CUTS_WHY && personal(why) === why)).toEqual([]);
    expect(said.map(personal).filter((words) => /_|^(?!iOS)[a-z]/.test(words))).toEqual([]);
    expect(personal('the device did something else')).toBe('the device did something else');
  });
});
