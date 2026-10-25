import { describe, expect, it } from 'vitest';
import { assertSerial, parseDevices, shq } from '../src/adb.js';

describe('adb helpers', () => {
  it('parses the device list with its properties', () => {
    expect(
      parseDevices(
        'emulator-5580          device product:sdk model:sdk_gphone64 transport_id:3\nABC unauthorized usb:1\n',
      ),
    ).toEqual([
      {
        serial: 'emulator-5580',
        state: 'device',
        props: { product: 'sdk', model: 'sdk_gphone64', transport_id: '3' },
      },
      { serial: 'ABC', state: 'unauthorized', props: { usb: '1' } },
    ]);
  });

  it('quotes shell arguments so nothing in them runs', () => {
    expect(shq("a'b; rm -rf /")).toBe(`'a'\\''b; rm -rf /'`);
    expect(shq('appdyno://x?a=1&b=2')).toBe(`'appdyno://x?a=1&b=2'`);
  });

  it('refuses a serial that could inject into the adb request', () => {
    expect(() => assertSerial('emulator-5580')).not.toThrow();
    expect(() => assertSerial('a;b')).toThrow();
    expect(() => assertSerial('x'.repeat(65))).toThrow();
  });
});
