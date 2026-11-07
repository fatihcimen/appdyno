import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { AndroidLocale } from '../src/locale.js';

/** A device of this API level whose languages are `tags`, and what it was asked. */
const on = (sdk: number, tags = 'en-US', reads?: string) => {
  const shell: string[] = [];
  const agent: (string | undefined)[] = [];
  const locale = new AndroidLocale(
    async (c) => {
      shell.push(c);
      if (c.startsWith('getprop')) return `${sdk}\n`;
      return c.includes('get-app-locales') ? 'Locales for x are [tr-TR]' : '';
    },
    async (set) => {
      agent.push(set);
      if (set) tags = reads ?? set;
      return tags;
    },
  );
  return { locale, shell, agent };
};

describe('a locale', () => {
  it("is the app's from API 33, given the app", async () => {
    const { locale, shell, agent } = on(33);
    expect(await locale.get('com.example')).toBe('tr-TR');
    await locale.set('de-DE', 'com.example');
    expect(shell.at(-1)).toBe("cmd locale set-app-locales com.example --locales 'de-DE'");
    expect(agent).toEqual([]);
  });

  it("is the whole device's below API 33, and with no app", async () => {
    for (const [sdk, app] of [
      [30, 'com.example'],
      [34, undefined],
    ] as const) {
      const { locale, shell, agent } = on(sdk);
      expect(await locale.get(app)).toBe('en-US');
      await locale.set('tr-TR', app);
      expect(await locale.get(app)).toBe('tr-TR');
      expect(agent).toEqual([undefined, 'tr-TR', undefined]);
      expect(shell.filter((c) => c.includes('cmd locale'))).toEqual([]);
    }
  });

  it('says it took the whole device, reads an old code back by its new name, and takes extensions', async () => {
    const legacy = on(30, 'en-US', 'he');
    expect(await legacy.locale.set('iw', 'com.example')).toBe(
      'the whole device: below Android 13 an app has no language of its own',
    );
    expect(legacy.agent).toEqual(['he']);
    const extended = on(30);
    expect(await extended.locale.set('th-TH-u-nu-thai')).toBe('the whole device');
    expect(extended.agent).toEqual(['th-TH-u-nu-thai']);
  });

  it('refuses what is no language, and a device that reads another', async () => {
    const bad = on(30);
    await expect(bad.locale.set('tr TR; reboot')).rejects.toThrow('a language such as tr-TR');
    expect(bad.agent).toEqual([]);
    const other = on(30, 'en-US', 'en-US');
    const e = await other.locale.set('tr-TR').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DeviceError);
    expect((e as Error).message).toBe('asked for the locale tr-TR and the device reads en-US');
  });
});
