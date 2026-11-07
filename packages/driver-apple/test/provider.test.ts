import { describe, expect, it } from 'vitest';
import type { ListedPhone } from '../src/devicectl.js';
import { appleProvider, phoneNeed } from '../src/provider.js';
import { newestRuntimeOf } from '../src/simctl.js';

const udid = '75505767-61E2-40F2-8FC6-8AFE20EE25C9';
const phone = '00001234-0123456789ABCDEF';
/** A paired phone in Developer Mode, on an iOS the runner takes. */
const fine: ListedPhone = {
  connectionProperties: { pairingState: 'paired' },
  deviceProperties: { developerModeStatus: 'enabled', osVersionNumber: '27.2' },
};

describe('the Apple provider', () => {
  it('lists booted simulators, then phones', async () => {
    const p = appleProvider({
      simulators: async () => [
        { udid, name: 'appdyno-iphone', state: 'Booted', runtime: 'iOS-27-0' },
      ],
      phones: async () => [{ udid: phone, deviceId: 4 }],
    });
    expect(await p.list()).toEqual([
      { serial: udid, state: 'booted', ready: true, model: 'iOS simulator appdyno-iphone' },
      { serial: phone, state: 'usb', ready: true, model: 'iPhone', link: 'USB' },
    ]);
  });

  it('asks for simulators and phones at once, and lists them in one order whichever answers first', async () => {
    const simulator = { udid, name: 'appdyno-iphone', state: 'Booted', runtime: 'iOS-27-0' };
    for (const first of ['simulators', 'phones']) {
      const answer = new Map<string, () => void>();
      const held =
        <T>(what: string, value: T) =>
        () =>
          new Promise<T>((done) => answer.set(what, () => done(value)));
      const listing = appleProvider({
        simulators: held('simulators', [simulator]),
        phones: held('phones', [{ udid: phone, deviceId: 4 }]),
      }).list();
      expect([...answer.keys()].sort()).toEqual(['phones', 'simulators']);
      answer.get(first)!();
      await new Promise((settled) => setImmediate(settled));
      for (const [, done] of answer) done();
      expect((await listing).map((d) => d.serial)).toEqual([udid, phone]);
    }
  });

  it('a phone paired for Wi-Fi stands in the list by the network while it has no cable', async () => {
    const paired = () => [phone];
    const away = appleProvider({ simulators: async () => [], phones: async () => [], paired });
    expect(await away.list()).toEqual([
      { serial: phone, state: 'network', ready: false, model: 'iPhone', link: 'Wi-Fi' },
    ]);
    await expect(away.need!({ serial: phone, state: 'network' })).resolves.toBeUndefined();
    const home = appleProvider({
      simulators: async () => [],
      phones: async () => [{ udid: phone, deviceId: 4 }],
      paired,
    });
    expect(await home.list()).toMatchObject([{ state: 'usb', link: 'USB' }]);
  });

  it('takes simulator and phone ids, not adb serials', () => {
    const p = appleProvider({ simulators: async () => [], phones: async () => [] });
    expect([udid, phone, 'a'.repeat(40)].every((s) => p.handles(s))).toBe(true);
    expect(['emulator-5554', 'EXAMPLE0SERIAL00'].some((s) => p.handles(s))).toBe(false);
  });
});

describe('a model on a runtime', () => {
  const runtime = (version: string, names: string[], isAvailable = true) => ({
    identifier: `iOS-${version}`,
    version,
    platform: 'iOS',
    isAvailable,
    supportedDeviceTypes: names.map((name) => ({ name })),
  });

  it('takes the newest that runs it, as a point release may run few', () => {
    const all = [
      runtime('26.5', ['iPhone 17']),
      runtime('27.2', ['iPhone 17']),
      runtime('27.10', ['iPhone Duo']),
      runtime('28.0', ['iPhone 17'], false),
    ];
    expect(newestRuntimeOf(all, 'iPhone 17')?.version).toBe('27.2');
    expect(newestRuntimeOf(all, 'iPhone Duo')?.version).toBe('27.10');
    expect(newestRuntimeOf(all, 'Nokia 3310')).toBeUndefined();
  });
});

describe('what blocks a phone', () => {
  const need = (listed: ListedPhone | undefined, passcodeRequired = false) =>
    phoneNeed({ listed: async () => listed, lockState: async () => ({ passcodeRequired }) });

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

  it('a simulator has none', async () => {
    const p = appleProvider({ simulators: async () => [], phones: async () => [] });
    expect(await p.need!({ serial: udid, state: 'booted' })).toBeUndefined();
  });

  it('asks the lock alongside the list of a phone known to trust this Mac, and after it of any other', async () => {
    const tool = slowTool(() => fine);
    await phoneNeed(tool);
    expect(tool.log).toEqual(['list', 'list done', 'lock', 'lock done']);
    const known = slowTool(() => fine);
    await phoneNeed(known, true);
    expect(overlapped(known.log)).toBe(true);
  });

  it('answers from the list read now, whatever the lock asked alongside it says', async () => {
    const untrusted = { ...fine, connectionProperties: { pairingState: 'unpaired' } };
    // a lock that fails beside a list that does not pass is no failure, and no unhandled one
    const failing = () => {
      throw new Error('the phone does not answer');
    };
    expect(
      await phoneNeed(
        slowTool(() => untrusted, failing),
        true,
      ),
    ).toBe('not-trusted');
    expect(
      await phoneNeed(
        slowTool(() => undefined, failing),
        true,
      ),
    ).toBe('not-connected');
    await expect(
      phoneNeed(
        slowTool(() => fine, failing),
        true,
      ),
    ).rejects.toThrow('not answer');
    await expect(
      phoneNeed(
        slowTool(() => {
          throw new Error('no list');
        }),
        true,
      ),
    ).rejects.toThrow('no list');
  });
});

/** A device tool whose reads each take a moment, saying when each starts and ends. */
function slowTool(
  listed: () => ListedPhone | undefined,
  lock: () => { passcodeRequired: boolean } = () => ({ passcodeRequired: false }),
) {
  const log: string[] = [];
  const read = <T>(what: string, answer: () => T) => {
    log.push(what);
    return new Promise<T>((done, fail) =>
      setTimeout(() => {
        log.push(`${what} done`);
        try {
          done(answer());
        } catch (e) {
          fail(e as Error);
        }
      }, 5),
    );
  };
  return { log, listed: () => read('list', listed), lockState: () => read('lock', lock) };
}

/** Both reads began before either ended. */
const overlapped = (log: string[]) => log.slice(0, 2).toSorted().join() === 'list,lock';

describe('a phone on its cable', () => {
  type Lock = { passcodeRequired: boolean };
  const unlocked = () => ({ passcodeRequired: false });
  /** A phone plugged in as `plugIn` says, listed and locked as `now` says; a read says whether its two reads overlapped. */
  const cable = (serial: string) => {
    const now = { plugIn: 7, listed: fine, lock: unlocked as () => Lock };
    const tools: ReturnType<typeof slowTool>[] = [];
    const provider = () =>
      appleProvider({
        simulators: async () => [],
        phones: async () => [{ udid: serial, deviceId: now.plugIn }],
        devicectl: () => {
          const tool = slowTool(
            () => now.listed,
            () => now.lock(),
          );
          tools.push(tool);
          return tool;
        },
      });
    const p = provider();
    const read = async (from = p) => ({
      need: await from.need!({ serial, state: 'usb' }).catch((e: Error) => e.message),
      overlapped: overlapped(tools.at(-1)!.log),
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
