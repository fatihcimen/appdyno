import { readFileSync } from 'node:fs';
import { assert, describe, expect, it } from 'vitest';
import { must } from '@appdyno/core';
import { phoneFacts, type ListedPhone } from '../src/devicectl.js';
import { iphoneProvider, phoneNeed } from '../src/phone-provider.js';
import { fine, overlapped, slowDevicectl } from './slow-devicectl.js';

const phone = '00001234-0123456789ABCDEF';

describe('the iPhone provider', () => {
  it('lists the phones on a cable', async () => {
    const p = iphoneProvider({ phones: () => Promise.resolve([{ udid: phone, deviceId: 4 }]) });
    expect(await p.list()).toEqual([
      { serial: phone, state: 'usb', ready: true, model: 'iPhone', link: 'USB' },
    ]);
  });

  it('a phone paired for Wi-Fi stands in the list by the network while it has no cable', async () => {
    const paired = () => [phone];
    const away = iphoneProvider({ phones: () => Promise.resolve([]), paired });
    expect(await away.list()).toEqual([
      { serial: phone, state: 'network', ready: false, model: 'iPhone', link: 'Wi-Fi' },
    ]);
    await expect(away.need?.({ serial: phone, state: 'network' })).resolves.toBeUndefined();
    const home = iphoneProvider({
      phones: () => Promise.resolve([{ udid: phone, deviceId: 4 }]),
      paired,
    });
    expect(await home.list()).toMatchObject([{ state: 'usb', link: 'USB' }]);
  });
});

describe('what blocks a phone', () => {
  const need = (listed: ListedPhone | undefined, passcodeRequired = false) =>
    phoneNeed({
      listed: () => Promise.resolve(listed),
      lockState: () => Promise.resolve({ passcodeRequired }),
    });

  it('nothing on a paired phone in Developer Mode, unlocked', async () => {
    expect(await need(fine)).toBeUndefined();
  });

  it('says the first thing a person has to do', async () => {
    expect(await need(undefined)).toBe('not-connected');
    expect(
      await need({ ...fine, connectionProperties: { pairingState: 'unsupported' } }, true),
    ).toBe('not-trusted');
    expect(
      await need({ ...fine, deviceProperties: { developerModeStatus: 'disabled' } }, true),
    ).toBe('developer-mode-off');
    expect(
      await need({
        ...fine,
        deviceProperties: { developerModeStatus: 'enabled', osVersionNumber: '16.7.2' },
      }),
    ).toBe('os-too-old');
    expect(await need(fine, true)).toBe('locked');
  });

  it('asks the lock alongside the list of a phone known to trust this Mac, and after it of any other', async () => {
    const tool = slowDevicectl(() => fine);
    await phoneNeed(tool);
    expect(tool.log).toEqual(['list', 'list done', 'lock', 'lock done']);
    const known = slowDevicectl(() => fine);
    await phoneNeed(known, true);
    expect(overlapped(known.log)).toBe(true);
  });

  // `devicectl list devices` of Xcode 27.1 (JSON version 5) with a phone, its every identifying value made up
  const listed = (
    JSON.parse(
      readFileSync(new URL('./fixtures/devicectl-list-devices.json', import.meta.url), 'utf8'),
    ) as { result: { devices: ListedPhone[] } }
  ).result.devices[0];
  assert(listed);
  const facts = {
    udid: '00001234-0123456789ABCDEF',
    marketingName: 'iPhone 13 Pro Max',
    pairingState: 'paired',
    developerModeStatus: 'enabled',
    osVersion: '27.2',
  };

  it('reads a phone by properties, with the keys they deprecate gone as they will be', async () => {
    const {
      hardwareProperties: _h,
      connectionProperties: _c,
      deviceProperties: _d,
      ...now
    } = listed;
    expect(phoneFacts(now)).toEqual(facts);
    expect(phoneFacts(listed)).toEqual(facts);
    expect(await need(now)).toBeUndefined();
    const off = {
      ...now,
      properties: { ...now.properties, state: { developerModeStatus: { disabled: {} } } },
    };
    expect(await need(off)).toBe('developer-mode-off');
  });

  it('reads the same by the old keys alone, as Xcode 26 lists a phone', async () => {
    const { properties: _p, ...before } = listed;
    expect(phoneFacts(before)).toEqual(facts);
    expect(await need(before)).toBeUndefined();
  });

  it('answers from the list read now, whatever the lock asked alongside it says', async () => {
    const untrusted = { ...fine, connectionProperties: { pairingState: 'unpaired' } };
    // a lock that fails beside a list that does not pass is no failure, and no unhandled one
    const failing = () => {
      throw new Error('the phone does not answer');
    };
    const known = (listed: () => ListedPhone | undefined) =>
      phoneNeed(slowDevicectl(listed, failing), true);
    expect(await known(() => untrusted)).toBe('not-trusted');
    expect(await known(() => undefined)).toBe('not-connected');
    await expect(known(() => fine)).rejects.toThrow('not answer');
    await expect(
      known(() => {
        throw new Error('no list');
      }),
    ).rejects.toThrow('no list');
  });
});

describe('a phone on its cable', () => {
  const unlocked = () => ({ passcodeRequired: false });
  /** A phone plugged in as `plugIn` says, listed and locked as `now` says; a read says whether its two reads overlapped. */
  const cable = (serial: string) => {
    const now = { plugIn: 7, listed: fine, lock: unlocked };
    const tools: ReturnType<typeof slowDevicectl>[] = [];
    const provider = () =>
      iphoneProvider({
        phones: () => Promise.resolve([{ udid: serial, deviceId: now.plugIn }]),
        devicectl: () => {
          const tool = slowDevicectl(
            () => now.listed,
            () => now.lock(),
          );
          tools.push(tool);
          return tool;
        },
      });
    const p = provider();
    const read = async (from = p) => ({
      need: await from
        .need?.({ serial, state: 'usb' })
        .catch((e: unknown) => (e instanceof Error ? e.message : String(e))),
      overlapped: overlapped(must(tools.at(-1), 'a devicectl').log),
    });
    return { now, read, provider };
  };

  it('asks the lock alongside the list on a plug-in where the phone passed, in a process of its own too', async () => {
    const phone = cable('00001234-00000000000000A1');
    expect(await phone.read()).toEqual({ need: undefined, overlapped: false });
    expect(await phone.read()).toEqual({ need: undefined, overlapped: true });
    expect(await phone.read(phone.provider())).toEqual({ need: undefined, overlapped: true });
    // plugged in again
    phone.now.plugIn = 8;
    expect(await phone.read()).toEqual({ need: undefined, overlapped: false });
    expect(await phone.read()).toEqual({ need: undefined, overlapped: true });
  });

  it('a locked phone has passed the list, and is asked alongside it', async () => {
    const phone = cable('00001234-00000000000000A2');
    phone.now.lock = () => ({ passcodeRequired: true });
    expect(await phone.read()).toEqual({ need: 'locked', overlapped: false });
    expect(await phone.read()).toEqual({ need: 'locked', overlapped: true });
  });

  it('keeps nothing of a phone that did not pass, and reads its list each time', async () => {
    const phone = cable('00001234-00000000000000A3');
    phone.now.listed = { ...fine, connectionProperties: { pairingState: 'unpaired' } };
    expect(await phone.read()).toEqual({ need: 'not-trusted', overlapped: false });
    expect(await phone.read()).toEqual({ need: 'not-trusted', overlapped: false });
    // a person taps Trust
    phone.now.listed = fine;
    expect(await phone.read()).toEqual({ need: undefined, overlapped: false });
    expect(await phone.read()).toEqual({ need: undefined, overlapped: true });
    // Developer Mode goes off with the cable still in: the list read now says so
    phone.now.listed = { ...fine, deviceProperties: { developerModeStatus: 'disabled' } };
    expect(await phone.read()).toEqual({ need: 'developer-mode-off', overlapped: true });
    expect(await phone.read()).toEqual({ need: 'developer-mode-off', overlapped: false });
  });

  it('a lock that cannot be read fails the read and takes away what was kept', async () => {
    const phone = cable('00001234-00000000000000A4');
    expect(await phone.read()).toEqual({ need: undefined, overlapped: false });
    phone.now.lock = () => {
      throw new Error('no lock');
    };
    expect(await phone.read()).toEqual({ need: 'no lock', overlapped: true });
    phone.now.lock = unlocked;
    expect(await phone.read()).toEqual({ need: undefined, overlapped: false });
  });
});
