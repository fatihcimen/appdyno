import { must } from '@appdyno/core';
import { DeviceError, NODE_FLAGS, type Tree } from '@appdyno/protocol';
import { assert, describe, expect, it, vi } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidEvents } from '../src/events.js';
import { enrolmentStep } from '../src/fingerprint.js';
import { AndroidSettings } from '../src/settings.js';
import { ANDROID_PAGES, openSettingsAt } from '../src/settings-pages.js';

/** A device by what its shell answers: the first pattern that matches a command. */
const device = (serial: string, answers: [RegExp, string | (() => string)][]) => {
  const asked: string[] = [];
  const adb = {
    exec: (_serial: string, command: string) => {
      asked.push(command);
      const hit = answers.find(([p]) => p.test(command))?.[1];
      return Promise.resolve(typeof hit === 'function' ? hit() : (hit ?? ''));
    },
    run: (words: string[]) => {
      asked.push(words.join(' '));
      return Promise.resolve('OK');
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

const SHOWN = NODE_FLAGS.visible | NODE_FLAGS.enabled;
const BUTTON = SHOWN | NODE_FLAGS.clickable;
const EDIT = SHOWN | NODE_FLAGS.editable | NODE_FLAGS.password;
/** One application window holding these nodes. */
const tree = (nodes: [string, [number, number, number, number], number][]): Tree => ({
  windows: [{ type: 1, layer: 1, b: [0, 0, 1080, 2400], active: true, focused: true }],
  nodes: nodes.map(([c, b, f]) => ({ p: -1, w: 0, c, b, f })),
  truncated: false,
  elapsedMs: 1,
  hash: 'h',
});

const prints = (count: number, accept = 0, reject = 0, state = 0) =>
  `Fps state: ${state}\n{"prints":[{"id":0,"count":${count},"accept":${accept},"reject":${reject},"acquire":0}]}`;

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
          const [chosen, airplane, state] = must(
            turns[Math.min(reads++, turns.length - 1)],
            'a turn',
          );
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

  it('touches until enrolled, lifting between, where the sensor already listens', async () => {
    const { events, asked } = device('emulator-5554', [
      [
        /dumpsys fingerprint/,
        () => prints(asked.filter((c) => c.includes('touch')).length >= 3 ? 1 : 0, 0, 0, 1),
      ],
    ]);
    expect(await events.biometric('enroll')).toBeUndefined();
    expect(asked.filter((c) => c.includes('finger touch 1'))).toHaveLength(3);
    expect(asked.filter((c) => c.includes('finger remove'))).toHaveLength(3);
    expect(asked.filter((c) => /lock_settings|am start/.test(c))).toEqual([]);
  });

  it('finds the step of an enrolment screen by its kinds, not its words', () => {
    const t = tree([
      ['android.widget.Button', [50, 2200, 300, 2300], BUTTON],
      ['android.widget.Button', [800, 2200, 1000, 2300], BUTTON],
      ['android.widget.Button', [800, 300, 1000, 400], BUTTON],
      ['android.widget.ImageButton', [1000, 2300, 1080, 2400], BUTTON],
    ]);
    expect(enrolmentStep(t)).toEqual({ kind: 'tap', x: 900, y: 2250 });
    const typing = tree([['android.widget.EditText', [0, 900, 1080, 1000], EDIT]]);
    expect(enrolmentStep(typing)).toEqual({ kind: 'pin', x: 540, y: 950 });
    const [win] = typing.windows;
    const [field] = typing.nodes;
    assert(win && field);
    const onKeyboard: Tree = {
      ...typing,
      windows: [...typing.windows, { ...win, type: 2 }],
      nodes: [{ ...field, w: 1 }],
    };
    expect(enrolmentStep(onKeyboard)).toBeUndefined();
  });

  it(
    'sets a PIN, written down, and goes through Settings to the sensor',
    { timeout: 10_000 },
    async () => {
      let listening = false;
      const asked: string[] = [];
      const adb = {
        exec: (_: string, command: string) => {
          asked.push(command);
          if (command.includes('keyevent 66')) listening = true;
          if (command.startsWith('cmd lock_settings verify'))
            return Promise.resolve('Lock credential verified successfully');
          const touches = asked.filter((c) => c.includes('touch')).length;
          if (command.includes('dumpsys fingerprint'))
            return Promise.resolve(
              prints(touches >= 3 ? 1 : 0, 0, 0, listening && touches < 3 ? 1 : 0),
            );
          return Promise.resolve('');
        },
        run: (words: string[]) => Promise.resolve((asked.push(words.join(' ')), 'OK')),
      };
      const pin = tree([['android.widget.EditText', [0, 900, 1080, 1000], EDIT]]);
      const done = tree([['android.widget.Button', [800, 2200, 1000, 2300], BUTTON]]);
      const screens = [pin, done];
      const events = new AndroidEvents(adb as unknown as Adb, 'emulator-5554', () =>
        Promise.resolve(must(screens.shift(), 'a screen')),
      );
      const setUp = vi.fn(() => Promise.resolve());
      const said = await events.biometric('enroll', setUp);
      expect(setUp).toHaveBeenCalledWith('screen_lock', 'pin');
      expect(said).toBe(
        'the screen lock is PIN 1234 for it: restore takes the PIN off, and the fingerprints with it',
      );
      expect(asked).toContain('am start -a android.settings.FINGERPRINT_ENROLL 2>&1');
      expect(asked).toContain('input tap 540 950; input text 1234; input keyevent 66 2>&1');
      expect(asked.at(-1)).toBe('input tap 900 2250 2>&1');
    },
  );

  it('says the PIN it set when Settings never reaches the sensor, and closes Settings', async () => {
    const asked: string[] = [];
    const adb = {
      exec: (_: string, c: string) => {
        asked.push(c);
        if (c.startsWith('cmd lock_settings verify'))
          return Promise.resolve('Lock credential verified successfully');
        return Promise.resolve(c.startsWith('dumpsys fingerprint') ? prints(0) : '');
      },
      run: () => Promise.resolve('OK'),
    };
    // each read of the clock a second on, so that each wait for the sensor ends at once
    let t = 0;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => (t += 1_000));
    const events = new AndroidEvents(adb as unknown as Adb, 'emulator-5554', () =>
      Promise.resolve(tree([])),
    );
    const e = await refusal(events.biometric('enroll', () => Promise.resolve()));
    now.mockRestore();
    expect(e.message).toBe(
      "Settings' fingerprint enrolment did not come to its sensor in 8 screens: enrol by hand, then biometric enroll; the screen lock is PIN 1234 until restore takes it off",
    );
    expect(asked.at(-1)).toBe('am force-stop com.android.settings 2>&1');
  });

  it('refuses a screen lock of its own, and a server that keeps to the app', async () => {
    const theirs = device('emulator-5554', [
      [/dumpsys fingerprint/, prints(0)],
      [/lock_settings verify/, 'java.lang.IllegalArgumentException'],
    ]);
    const setUp = vi.fn(() => Promise.resolve());
    const e = await refusal(theirs.events.biometric('enroll', setUp));
    expect(e.message).toContain('a screen lock of its own');
    expect(setUp).not.toHaveBeenCalled();
    const kept = device('emulator-5554', [[/dumpsys fingerprint/, prints(0)]]);
    expect((await refusal(kept.events.biometric('enroll'))).message).toContain(
      'it leaves the app for Settings',
    );
    expect(kept.asked.filter((c) => /lock_settings|am start/.test(c))).toEqual([]);
  });

  it("has its PIN set and cleared on an emulator alone, never on a phone's", async () => {
    const phone = device('Y9DE', []);
    expect((await refusal(phone.settings.set('screen_lock', 'pin'))).message).toContain(
      "a phone's is its owner's",
    );
    expect(phone.asked).toEqual([]);
    let pin = false;
    const emulator = device('emulator-5554', [
      [/set-pin/, () => ((pin = true), "Pin set to '1234'")],
      [/clear/, () => ((pin = false), 'Lock credential cleared')],
      [
        /verify/,
        () => (pin ? 'IllegalArgumentException' : 'Lock credential verified successfully'),
      ],
    ]);
    const was = await emulator.settings.get('screen_lock');
    expect(was).toBe('none on OK');
    await emulator.settings.set('screen_lock', 'pin');
    await emulator.settings.set('screen_lock', was);
    expect(
      emulator.asked.filter((c) => c.includes('lock_settings set') || c.includes('clear')),
    ).toEqual(['cmd lock_settings set-pin 1234 2>&1', 'cmd lock_settings clear --old 1234 2>&1']);
  });

  it('takes a PIN already gone as put back, and leaves another emulator on the same serial alone', async () => {
    const emulator = device('emulator-5554', [[/verify/, 'Lock credential verified successfully']]);
    await emulator.settings.set('screen_lock', 'none on OK');
    const other = await refusal(emulator.settings.set('screen_lock', 'none on Pixel_Fold'));
    expect(other.message).toBe(
      'emulator-5554 is OK now, not Pixel_Fold, whose PIN this tool set: it is put back when Pixel_Fold is here',
    );
    expect(emulator.asked.filter((c) => c.includes('clear'))).toEqual([]);
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
        () => prints(1, 0, other.asked.some((c) => c.includes('touch 99')) ? 1 : 0),
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

describe('a text size', () => {
  /**
   * A device as API 34 is: a scale that changes the configuration is written back by the system with the languages beside
   * it, a scale deleted counting as 1.0 there. With `late`, the write of a 1.3 set just before lands after the next write.
   */
  const scaled = (scale: string, late = false) => {
    const held: Record<string, string> = { font_scale: scale, system_locales: 'null' };
    let config = scale === 'null' ? 1 : Number(scale);
    const systemWrite = (to: number) => () => {
      held.font_scale = to.toFixed(1);
      held.system_locales = 'en-US';
    };
    let pending = late ? systemWrite(config) : undefined;
    const asked: string[] = [];
    const one = (command: string) => {
      const [, verb, key = '', v = ''] =
        /^settings (get|put|delete) system (\w+) ?(\S*)/.exec(command) ?? [];
      if (verb === 'get') return held[key] ?? 'null';
      held[key] = verb === 'put' ? v : 'null';
      pending?.();
      pending = undefined;
      const now = held.font_scale === 'null' ? 1 : Number(held.font_scale);
      if (key === 'font_scale' && now !== config) {
        config = now;
        systemWrite(now)();
      }
      return '';
    };
    const exec = (_serial: string, command: string) => {
      asked.push(command);
      return Promise.resolve(command.split('; ').map(one).join('\n'));
    };
    const settings = new AndroidSettings({ exec } as unknown as Adb, 'emulator-5554');
    return { settings, asked, held };
  };

  it('is a scale Android takes, from 0.25 to 5, or default, and nothing else is asked of the device', async () => {
    for (const value of ['large', '0.2', '6', '1.3x', '']) {
      const { settings, asked } = device('emulator-5554', []);
      const e = await refusal(settings.set('text_size', value));
      expect([e.code, e.message, e.hint]).toEqual([
        'INVALID_ARGUMENT',
        `text_size on Android is a scale, not ${value}`,
        'from 0.25 to 5, such as 1.3, or default',
      ]);
      expect(asked).toEqual([]);
    }
  });

  it('reads a scale the device never set as default, and one of 1.0 as 1.0', async () => {
    const read = (v: string) =>
      device('emulator-5554', [[/font_scale/, v]]).settings.get('text_size');
    expect([await read('null'), await read('1.0'), await read('1.3')]).toEqual([
      'default',
      '1.0',
      '1.3',
    ]);
  });

  it(
    'puts back a scale the device never set by deleting it until it holds, and the languages the system wrote beside it',
    { timeout: 15_000 },
    async () => {
      const { settings, held } = scaled('null');
      await settings.set('text_size', '1.3');
      expect(held).toEqual({ font_scale: '1.3', system_locales: 'null' });
      await settings.set('text_size', 'default');
      expect(held).toEqual({ font_scale: 'null', system_locales: 'null' });
    },
  );

  it('puts back a scale of 1.0 as 1.0', { timeout: 15_000 }, async () => {
    const { settings, held } = scaled('1.0');
    const was = await settings.get('text_size');
    await settings.set('text_size', '1.3');
    await settings.set('text_size', was);
    expect([was, held.font_scale]).toEqual(['1.0', '1.0']);
  });

  it(
    'asks again while the write of the scale before lands after it, and is done once it holds',
    { timeout: 15_000 },
    async () => {
      const { settings, asked, held } = scaled('1.3', true);
      await settings.set('text_size', 'default');
      expect(asked.filter((c) => c.startsWith('settings delete system font_scale'))).toHaveLength(
        3,
      );
      expect(held).toEqual({ font_scale: 'null', system_locales: 'null' });
    },
  );

  it('says what the device said when it refuses a scale', async () => {
    const { settings } = device('emulator-5554', [
      [
        /settings put/,
        "Exception occurred while executing 'put':\njava.lang.IllegalArgumentException: Invalid value: 4 for setting: font_scale",
      ],
    ]);
    const e = await refusal(settings.set('text_size', '4'));
    expect([e.code, e.message]).toEqual([
      'UNSUPPORTED',
      'this device refused text_size 4: Invalid value: 4 for setting: font_scale',
    ]);
  });
});

it('says Android has no keychain', async () => {
  const { events } = device('emulator-5554', []);
  expect((await refusal(events.resetKeychain())).code).toBe('UNSUPPORTED');
});

describe('the pages of Settings', () => {
  const asked: string[] = [];
  const start = (intent: string) => {
    asked.push(intent);
    return Promise.resolve(undefined);
  };

  it('stops it first, as an intent to it would bring back the page it shows', async () => {
    await openSettingsAt({ page: 'about' }, start);
    await openSettingsAt({ app: 'com.example.app' }, start);
    expect(asked).toEqual([
      '-a android.settings.DEVICE_INFO_SETTINGS',
      '-a android.settings.APPLICATION_DETAILS_SETTINGS -d package:com.example.app',
    ]);
  });

  it("are Android's own: a fingerprint, security and voice input, and none of iOS's names", async () => {
    expect(ANDROID_PAGES).toEqual(
      expect.arrayContaining(['security', 'fingerprint', 'voice_input']),
    );
    for (const ios of ['siri', 'game_center', 'screen_time', 'privacy_photos'])
      expect(ANDROID_PAGES).not.toContain(ios);
    asked.length = 0;
    await openSettingsAt({ page: 'security' }, start);
    await openSettingsAt({ page: 'fingerprint' }, start);
    expect(asked).toEqual([
      '-a android.settings.SECURITY_SETTINGS',
      '-a android.settings.FINGERPRINT_SETTINGS',
    ]);
  });

  it('refuses a page Android has not got as one, and what the device said', async () => {
    await expect(openSettingsAt({ page: 'privacy_photos' }, start)).rejects.toThrow(
      /no privacy_photos page in Settings/,
    );
    await expect(
      openSettingsAt({ page: 'wifi' }, () => Promise.resolve('Error: no activity')),
    ).rejects.toThrow(/no wifi page in Settings: Error: no activity/);
  });
});
