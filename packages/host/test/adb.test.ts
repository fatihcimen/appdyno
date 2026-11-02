import { describe, expect, it } from 'vitest';
import { Adb, assertSerial, parseDevices, shq } from '../src/adb.js';

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
    expect(shq('demo://x?a=1&b=2')).toBe(`'demo://x?a=1&b=2'`);
  });

  it('refuses a serial that could inject into the adb request', () => {
    expect(() => assertSerial('emulator-5580')).not.toThrow();
    expect(() => assertSerial('a;b')).toThrow();
    expect(() => assertSerial('x'.repeat(65))).toThrow();
  });
});

describe('adb server', () => {
  it('starts the server again after each outage (kill-server between calls)', async () => {
    const { mkdtempSync, writeFileSync, readFileSync, chmodSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createServer } = await import('node:net');
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-adb-'));
    const count = join(dir, 'starts');
    // a stand-in adb whose start-server is only counted; nothing listens, so every dial fails
    const bin = join(dir, 'adb');
    writeFileSync(bin, `#!/bin/sh\necho "$1" >> ${count}\n`);
    chmodSync(bin, 0o755);
    const free = await new Promise<number>((r) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const port = (s.address() as { port: number }).port;
        s.close(() => r(port));
      });
    });
    const adb = new Adb({ bin, port: free });
    await expect(adb.devices()).rejects.toThrow();
    await expect(adb.devices()).rejects.toThrow();
    expect(readFileSync(count, 'utf8').trim().split('\n')).toEqual([
      'start-server',
      'start-server',
    ]);
  });
});
