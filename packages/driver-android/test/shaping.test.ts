import { describe, expect, it } from 'vitest';
import { AndroidShaping, CAP_SAYS } from '../src/shaping.js';

/** What an emulator's console says of its network, as an API 34 one does: slow is the edge speed and 40 ms. */
const status = (shaped: boolean) =>
  shaped
    ? 'Current network status:\n  download speed:     473600 bits/s (57.8 KB/s)\n  upload speed:       473600 bits/s (57.8 KB/s)\n  minimum latency:  40 ms\n  maximum latency:  40 ms\nOK'
    : 'Current network status:\n  download speed:          0 bits/s (0.0 KB/s)\n  upload speed:            0 bits/s (0.0 KB/s)\n  minimum latency:  0 ms\n  maximum latency:  0 ms\nOK';

/** A device of this serial and API level whose download cap is `cap`, and what it was asked. */
const on = (serial: string, sdk: number, cap = 'null') => {
  const asked: string[] = [];
  let shaped = false;
  const shaping = new AndroidShaping(
    serial,
    (c) => {
      asked.push(c);
      if (c.startsWith('getprop')) return Promise.resolve(`${sdk}\n`);
      const put = /settings put global ingress_rate_limit_bytes_per_second (\d+)/.exec(c)?.[1];
      if (put) cap = put;
      if (c.startsWith('settings delete')) cap = 'null';
      return Promise.resolve(c.startsWith('settings get') ? `${cap}\n` : '');
    },
    (_what, ...words) => {
      asked.push(`emu ${words.join(' ')}`);
      if (words[1] === 'speed') shaped = words[2] !== 'full';
      return Promise.resolve(words[1] === 'status' ? status(shaped) : 'OK');
    },
  );
  return { shaping, asked };
};

describe('a slow network', () => {
  it('is a download cap on a phone with Android 13, which the answer says, and goes at full', async () => {
    const { shaping, asked } = on('R68T', 34);
    expect(await shaping.get()).toBe('full');
    expect(await shaping.set('slow')).toBe(`${CAP_SAYS}, at 30 kB/s`);
    expect(asked).toContain('settings put global ingress_rate_limit_bytes_per_second 29600');
    expect(await shaping.get()).toBe('29600');
    await shaping.set('full');
    expect(await shaping.get()).toBe('full');
    expect(asked.filter((c) => c.startsWith('emu'))).toEqual([]);
  });

  it('shapes both ways on an emulator, and caps it only by a number', async () => {
    const { shaping, asked } = on('emulator-5554', 34);
    expect(await shaping.set('slow')).toBeUndefined();
    expect(asked).toContain('emu network speed edge');
    expect(asked).toContain('emu network delay 40 100');
    expect(await shaping.set('100000')).toBe(`${CAP_SAYS}, at 100 kB/s`);
    expect(await shaping.get()).toBe('100000');
    await shaping.set('full');
    expect(asked.slice(-3)).toEqual([
      'settings delete global ingress_rate_limit_bytes_per_second',
      'emu network speed full',
      'emu network delay none',
    ]);
  });

  it("reads an emulator's shaping from its console, so that a slow one does not read as full", async () => {
    const { shaping } = on('emulator-5554', 34);
    expect(await shaping.get()).toBe('full');
    await shaping.set('slow');
    expect(await shaping.get()).toBe('slow');
    await shaping.set('full');
    expect(await shaping.get()).toBe('full');
  });

  it('is refused on a phone below Android 13, and in words a phone has not', async () => {
    await expect(on('R68T', 32).shaping.set('slow')).rejects.toThrow('Android below 13');
    await expect(on('R68T', 32).shaping.get()).rejects.toThrow('Android below 13');
    await expect(on('R68T', 34).shaping.set('edge')).rejects.toThrow(
      'network on a phone: slow, full or bytes a second, not edge',
    );
    const old = on('emulator-5554', 30);
    expect(await old.shaping.get()).toBe('full');
    await expect(old.shaping.set('100000')).rejects.toThrow('Android below 13');
  });
});
