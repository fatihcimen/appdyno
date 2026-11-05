import { describe, expect, it, vi } from 'vitest';
import { pairCommand } from '../src/pair.js';

const fake = (seen: { serial: string }[][]) => {
  const said: string[] = [];
  const adb = {
    pair: vi.fn(async () => undefined),
    devices: vi.fn(async () => (seen.length > 1 ? seen.shift()! : seen[0]!)),
  };
  const phone = vi.fn(async () => undefined);
  return { said, adb, phone, use: { adb, phone, say: (l: string) => void said.push(l) } };
};

describe('appdyno pair', () => {
  it('an iPhone goes by its name, and an Android phone by what it shows', async () => {
    const iphone = fake([[]]);
    expect(await pairCommand(['--device', 'UDID'], iphone.use as never)).toBe(0);
    expect(iphone.phone).toHaveBeenCalledWith('UDID', iphone.use.say);
    expect(iphone.adb.pair).not.toHaveBeenCalled();

    const android = fake([[], [{ serial: '192.168.1.5:41111' }]]);
    expect(await pairCommand(['192.168.1.5:37000', '123456'], android.use as never)).toBe(0);
    expect(android.adb.pair).toHaveBeenCalledWith('192.168.1.5:37000', '123456');
    expect(android.said).toEqual(['Paired: 192.168.1.5:41111']);
  });

  it('words that make no call get the usage, and pair nothing', async () => {
    const f = fake([[]]);
    expect(await pairCommand([], f.use as never)).toBe(2);
    expect(await pairCommand(['192.168.1.5:37000'], f.use as never)).toBe(2);
    expect(f.said[0]).toContain('appdyno pair');
    expect(f.adb.pair).not.toHaveBeenCalled();
    expect(f.phone).not.toHaveBeenCalled();
  });
});
