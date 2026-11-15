import type { Backgrounds } from '@appdyno/core';
import type { DeviceError } from '@appdyno/protocol';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { describe, expect, it } from 'vitest';
import { AndroidLifecycle, TRIM_LEVELS, trimLevel, trimRefused } from '../src/lifecycle.js';

const APP = 'dev.appdyno.fixture';

/** What `am send-trim-memory` printed on an API 35 emulator, each refusal's first line. */
const AM = {
  higher:
    "Exception occurred while executing 'send-trim-memory': java.lang.IllegalArgumentException: Unable to set a higher trim level than current level\n\tat com.android.server.am.ActivityManagerService.setProcessMemoryTrimLevel(ActivityManagerService.java:3251)",
  background:
    "Exception occurred while executing 'send-trim-memory': java.lang.IllegalArgumentException: Unable to set a background trim level on a foreground process\n\tat com.android.server.am.ActivityManagerService.setProcessMemoryTrimLevel(ActivityManagerService.java:3256)",
  unknown:
    "Exception occurred while executing 'send-trim-memory': java.lang.IllegalArgumentException: Unknown process: dev.appdyno.fixture",
};

/** A device whose shell answers by the first rule whose words a command holds, and whose console reads `acceleration`. */
function android(
  rules: [string, string][] = [],
  acceleration = '0:9.77631:0.812349',
  virtual = true,
) {
  const said: string[] = [];
  const consoled: string[] = [];
  let running = true;
  const sh = (c: string) => {
    said.push(c);
    if (c.startsWith('am kill')) running = false;
    return Promise.resolve(rules.find(([w]) => c.includes(w))?.[1] ?? '');
  };
  const emu = (_what: string, ...words: string[]) => {
    consoled.push(words.join(' '));
    return Promise.resolve(words[1] === 'get' ? `acceleration = ${acceleration}\nOK\n` : 'OK\n');
  };
  const device: Backgrounds = {
    foreground: () => Promise.resolve('com.android.launcher'),
    key: () => Promise.resolve({}),
    appRunning: () => Promise.resolve(running),
  };
  return { life: new AndroidLifecycle(sh, emu, virtual, device), said, consoled };
}

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as DeviceError,
  );

describe("Android's trim levels", () => {
  it('takes each level am does, in any case and by its ComponentCallbacks2 name, RUNNING_CRITICAL when none is asked', () => {
    expect(trimLevel(undefined)).toBe('RUNNING_CRITICAL');
    expect(trimLevel('running_low')).toBe('RUNNING_LOW');
    expect(trimLevel('TRIM_MEMORY_COMPLETE')).toBe('COMPLETE');
    expect(trimLevel('UI_HIDDEN')).toBe('HIDDEN');
    for (const level of Object.keys(TRIM_LEVELS)) expect(trimLevel(level)).toBe(level);
    expect(() => trimLevel('critical')).toThrow(
      'memory_warning: an Android trim level is one of RUNNING_MODERATE, RUNNING_LOW, RUNNING_CRITICAL, HIDDEN, BACKGROUND, MODERATE, COMPLETE, not critical',
    );
  });

  it('says why Android refused one, by what am said', () => {
    const higher = trimRefused(APP, 'RUNNING_LOW', AM.higher, 15);
    expect(higher.code).toBe('INVALID_ARGUMENT');
    expect(higher.message).toBe(
      `Android refused RUNNING_LOW: ${APP} is at RUNNING_CRITICAL already, and takes only a higher level until it starts again`,
    );
    expect(trimRefused(APP, 'MODERATE', AM.background).message).toBe(
      'Android refused MODERATE: a background level (HIDDEN and above) reaches only an app in the background',
    );
    expect(trimRefused(APP, 'HIDDEN', AM.unknown).code).toBe('APP_NOT_RUNNING');
    expect(trimRefused(APP, 'HIDDEN', 'Error: something new').code).toBe('INTERNAL');
  });
});

describe("an Android device's memory warning", () => {
  it('sends the trim level to the app, and says a later one must be higher', async () => {
    const { life, said } = android();
    await expect(life.memoryWarning(APP)).resolves.toBe(
      'trim level RUNNING_CRITICAL; Android takes only a higher one until the app starts again',
    );
    expect(said).toEqual([`am send-trim-memory '${APP}' RUNNING_CRITICAL 2>&1`]);
  });

  it("refuses with the level the app's process is at, as dumpsys holds it", async () => {
    const { life } = android([
      ['send-trim-memory', AM.higher],
      ['dumpsys activity processes', '    trimMemoryLevel=60\n'],
    ]);
    const e = await refusal(life.memoryWarning(APP, 'background'));
    expect(e?.message).toBe(
      `Android refused BACKGROUND: ${APP} is at MODERATE already, and takes only a higher level until it starts again`,
    );
  });
});

describe('a background trim level just after home', () => {
  /** A shell that refuses the first `refusals` sends as to an app in front, and a device with `front` in front. */
  const sending = (front: string, refusals: number) => {
    const sent: string[] = [];
    const sh = (c: string) => {
      if (c.startsWith('am send-trim-memory')) sent.push(c);
      return Promise.resolve(
        c.startsWith('am send-trim-memory') && refusals-- > 0 ? AM.background : '',
      );
    };
    const device: Backgrounds = {
      foreground: () => Promise.resolve(front),
      key: () => Promise.resolve({}),
      appRunning: () => Promise.resolve(true),
    };
    const emu = () => Promise.resolve('');
    return { life: new AndroidLifecycle(sh, emu, true, device), sent };
  };

  it(
    'is asked again while the system still counts an app sent home as in front',
    fakeTimed(async () => {
      const { life, sent } = sending('com.android.launcher', 2);
      await life.memoryWarning(APP, 'BACKGROUND');
      expect(sent).toHaveLength(3);
    }),
  );

  it(
    'is refused for the app in front once an app sent home would have left it',
    fakeTimed(async () => {
      const { life, sent } = sending(APP, 1_000);
      const started = Date.now();
      const e = await refusal(life.memoryWarning(APP, 'BACKGROUND'));
      expect(e?.message).toContain('reaches only an app in the background');
      expect(Date.now() - started).toBeGreaterThanOrEqual(3_000);
      expect(sent.length).toBeGreaterThan(1);
    }),
  );
});

describe("an emulator's shake", () => {
  it('pulls from side to side across gravity, then puts its reading back', async () => {
    const { life, consoled } = android();
    await life.shake();
    expect(consoled).toEqual([
      'sensor get acceleration',
      'sensor set acceleration 25:9.77631:0.812349',
      'sensor set acceleration -25:9.77631:0.812349',
      'sensor set acceleration 25:9.77631:0.812349',
      'sensor set acceleration -25:9.77631:0.812349',
      'sensor set acceleration 0:9.77631:0.812349',
    ]);
  });

  it('shakes a turned emulator along the axis gravity is not on', async () => {
    const { life, consoled } = android([], '9.8:0.1:0.5');
    await life.shake();
    expect(consoled[1]).toBe('sensor set acceleration 9.8:25:0.5');
    expect(consoled.at(-1)).toBe('sensor set acceleration 9.8:0.1:0.5');
  });

  it('refuses a phone, which only a hand shakes', async () => {
    const { life, consoled } = android([], undefined, false);
    expect((await refusal(life.shake()))?.message).toContain('a phone is shaken only by hand');
    expect(consoled).toEqual([]);
  });
});

describe("an Android app's end in the background", () => {
  it(
    'ends it by am kill, as the system ends a process it may',
    fakeTimed(async () => {
      const { life, said } = android();
      await life.endInBackground(APP);
      expect(said).toEqual([`am kill '${APP}'`]);
    }),
  );
});
