import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidEvents } from '../src/events.js';
import { AndroidSettings } from '../src/settings.js';
import { openSettingsAt } from '../src/settings-pages.js';

/** A device by what its shell answers: the first pattern that matches a command. */
const device = (serial: string, answers: [RegExp, string | (() => string)][]) => {
  const asked: string[] = [];
  const adb = {
    exec: async (_serial: string, command: string) => {
      asked.push(command);
      const hit = answers.find(([p]) => p.test(command))?.[1];
      return typeof hit === 'function' ? hit() : (hit ?? '');
    },
    run: async (words: string[]) => {
      asked.push(words.join(' '));
      return 'OK';
    },
  };
  return {
    settings: new AndroidSettings(adb as unknown as Adb, serial),
    events: new AndroidEvents(adb as unknown as Adb, serial),
    asked,
  };
};

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DeviceError);
    return e as DeviceError;
  }
  throw new Error('it did not refuse');
};

const prints = (count: number, accept = 0, reject = 0) =>
  `{"prints":[{"id":0,"count":${count},"accept":${accept},"reject":${reject},"acquire":0}]}`;

describe('a radio', () => {
  it('reads Wi-Fi by its state, not its setting', async () => {
    const read = async (state: string) =>
      device('emulator-5554', [[/dumpsys wifi/, `Wi-Fi is ${state}`]]).settings.get('wifi');
    expect(await read('enabled')).toBe('on');
    expect(await read('disabled')).toBe('off');
    expect(await read('disabling')).toBe('disabling');
  });

  /** What the shell answers in turn: `wifi_on`, `airplane_mode_on` and the state. */
  const reading = (...turns: [string, string, string][]) => {
    let reads = 0;
    const { settings } = device('emulator-5554', [
      [
        /dumpsys wifi/,
        () => {
          const [chosen, airplane, state] = turns[Math.min(reads++, turns.length - 1)]!;
          return `${chosen}\n${airplane}\nWi-Fi is ${state}\n`;
        },
      ],
    ]);
    return { settings, reads: () => reads };
  };

  it('reads Wi-Fi once it has come to where its setting says, as airplane mode ending brings it back after', async () => {
    const { settings, reads } = reading(
      ['1', '0', 'disabled'],
      ['1', '0', 'disabled'],
      ['1', '0', 'enabled'],
    );
    expect(await settings.get('wifi')).toBe('on');
    expect(reads()).toBe(3);
  });

  it('takes the setting airplane mode left, 3, as on its way back once airplane mode has ended', async () => {
    const { settings } = reading(['3', '0', 'disabled'], ['1', '0', 'enabled']);
    expect(await settings.get('wifi')).toBe('on');
  });

  it('waits for nothing in airplane mode, or when Wi-Fi was turned off', async () => {
    for (const turn of [
      ['3', '1', 'disabled'],
      ['0', '0', 'disabled'],
    ] as [string, string, string][]) {
      const { settings, reads } = reading(turn);
      expect(await settings.get('wifi')).toBe('off');
      expect(reads()).toBe(1);
    }
  });

  it('says what it reads when Wi-Fi never comes to its setting', async () => {
    const start = Date.now();
    const now = vi
      .spyOn(Date, 'now')
      .mockImplementation(() => start + now.mock.calls.length * 4_000);
    const { settings } = reading(['1', '0', 'disabled']);
    expect(await settings.get('wifi')).toBe('off');
    now.mockRestore();
  });

  it('reads a switch as on or off, and says when there is none', async () => {
    const read = (v: string) =>
      device('emulator-5554', [[/airplane_mode_on/, v]]).settings.get('airplane');
    expect(await read('1')).toBe('on');
    expect(await read('0')).toBe('off');
    expect((await refusal(read('null'))).message).toContain('no airplane switch');
  });

  it('is done only when it reads as asked', async () => {
    let reads = 0;
    const { settings, asked } = device('emulator-5554', [
      [/settings get global mobile_data/, () => (++reads < 3 ? '1' : '0')],
    ]);
    await settings.set('mobile_data', 'off');
    expect(asked).toContain('svc data disable 2>&1');
    expect(reads).toBe(3);
  });

  it('says what the device said when it does not change', { timeout: 15_000 }, async () => {
    const { settings } = device('Y9DE', [
      [/svc data/, 'java.lang.SecurityException: not allowed\n\tat x'],
      [/settings get global mobile_data/, '1'],
    ]);
    const e = await refusal(settings.set('mobile_data', 'off'));
    expect(e.code).toBe('UNSUPPORTED');
    expect(e.message).toBe(
      'asked for mobile_data off and it still reads on after 10 s: java.lang.SecurityException: not allowed',
    );
  });

  it('refuses to cut the network a device is reached over', async () => {
    for (const serial of ['192.168.1.5:5555', 'adb-R5CT-abc._adb-tls-connect._tcp']) {
      const { settings, asked } = device(serial, []);
      const e = await refusal(settings.set('wifi', 'off'));
      expect(e.message).toContain('nothing could reach it to put it back');
      await refusal(settings.set('airplane', 'on'));
      expect(asked).toEqual([]);
    }
    const { settings, asked } = device('192.168.1.5:5555', [[/settings get/, '0']]);
    await settings.set('mobile_data', 'off');
    expect(asked[0]).toContain('svc data disable');
  });

  it('takes on or off alone', async () => {
    const { settings, asked } = device('emulator-5554', []);
    expect((await refusal(settings.set('wifi', 'half'))).code).toBe('INVALID_ARGUMENT');
    expect(asked).toEqual([]);
  });
});

describe('a fingerprint', () => {
  it('is an emulator’s alone', async () => {
    const { events, asked } = device('Y9DE', []);
    const e = await refusal(events.biometric('match'));
    expect(e.code).toBe('UNSUPPORTED');
    expect(e.message).toContain('only an emulator has a sensor');
    expect(asked).toEqual([]);
  });

  it('asks for one to be enrolled first', async () => {
    const { events, asked } = device('emulator-5554', [[/dumpsys fingerprint/, prints(0)]]);
    const e = await refusal(events.biometric('match'));
    expect(e.message).toContain('no fingerprint is enrolled here');
    expect(asked.filter((c) => c.includes('finger touch'))).toEqual([]);
  });

  it('touches until enrolled, lifting between', async () => {
    const { events, asked } = device('emulator-5554', [
      [
        /dumpsys fingerprint/,
        () => prints(asked.filter((c) => /touch/.test(c)).length >= 3 ? 1 : 0),
      ],
    ]);
    await events.biometric('enroll');
    expect(asked.filter((c) => c.includes('finger touch 1'))).toHaveLength(3);
    expect(asked.filter((c) => c.includes('finger remove'))).toHaveLength(3);
  });

  it('touches nothing when one is enrolled', async () => {
    const { events, asked } = device('emulator-5554', [[/dumpsys fingerprint/, prints(1)]]);
    await events.biometric('enroll');
    expect(asked.filter((c) => c.includes('finger touch'))).toEqual([]);
  });

  it('is done only when the service counted it, with the finger it was asked for', async () => {
    let touched = false;
    const { events, asked } = device('emulator-5554', [
      [/dumpsys fingerprint/, () => prints(1, touched ? 1 : 0, 0)],
    ]);
    const run = events.biometric('match');
    await new Promise((r) => setTimeout(r, 400));
    touched = true;
    await run;
    expect(asked).toContain('-s emulator-5554 emu finger touch 1');
    const other = device('emulator-5554', [
      [
        /dumpsys fingerprint/,
        () => prints(1, 0, other.asked.some((c) => /touch 99/.test(c)) ? 1 : 0),
      ],
    ]);
    await other.events.biometric('nomatch');
  });

  it('says when nothing took the touch', { timeout: 8_000 }, async () => {
    const { events } = device('emulator-5554', [[/dumpsys fingerprint/, prints(1, 4, 2)]]);
    const e = await refusal(events.biometric('match'));
    expect(e.message).toContain('not counted as a match (4 accepted, 2 rejected)');
    expect(e.message).toContain('an app must be asking');
  });

  it('says when the service gives no counts', async () => {
    const { events } = device('emulator-5554', [
      [/dumpsys fingerprint/, "Can't find service: fingerprint"],
    ]);
    expect((await refusal(events.biometric('match'))).message).toBe(
      "this device gives no fingerprint counts: Can't find service: fingerprint",
    );
  });
});

it('says Android has no keychain', async () => {
  const { events } = device('emulator-5554', []);
  expect((await refusal(events.resetKeychain())).code).toBe('UNSUPPORTED');
});

describe('the pages of Settings', () => {
  const asked: string[] = [];
  const start = async (intent: string) => {
    asked.push(intent);
    return undefined;
  };

  it('stops it first, as an intent to it would bring back the page it shows', async () => {
    await openSettingsAt({ page: 'about' }, start);
    await openSettingsAt({ app: 'com.example.app' }, start);
    expect(asked).toEqual([
      '-a android.settings.DEVICE_INFO_SETTINGS',
      '-a android.settings.APPLICATION_DETAILS_SETTINGS -d package:com.example.app',
    ]);
  });

  it('refuses a page Android has not got as one, and what the device said', async () => {
    await expect(openSettingsAt({ page: 'privacy_photos' }, start)).rejects.toThrow(
      /no privacy_photos page in Settings/,
    );
    await expect(
      openSettingsAt({ page: 'wifi' }, async () => 'Error: no activity'),
    ).rejects.toThrow(/no wifi page in Settings: Error: no activity/);
  });
});
