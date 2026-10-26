import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectPort, frame, listDevices, parsePlist, plistXml } from '../src/ios/usbmux.js';

describe('usbmux', () => {
  it('round-trips a property list', () => {
    const v = {
      MessageType: 'Connect',
      DeviceID: 7,
      PortNumber: 0x1f90,
      Flag: true,
      List: ['a&b', 2, ' '],
      Empty: {},
    };
    expect(parsePlist(plistXml(v))).toEqual(v);
  });

  it('frames with a little-endian header', () => {
    const f = frame({ MessageType: 'ListDevices' }, 3);
    expect(f.readUInt32LE(0)).toBe(f.length);
    expect([f.readUInt32LE(4), f.readUInt32LE(8), f.readUInt32LE(12)]).toEqual([1, 8, 3]);
  });

  it('lists devices and connects to a port in network byte order, USB only', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'gd-mux-')), 'mux.sock');
    const seen: Record<string, unknown>[] = [];
    const server = createServer((s) => {
      let buf = Buffer.alloc(0);
      s.on('data', (c) => {
        buf = Buffer.concat([buf, c]);
        const len = buf.readUInt32LE(0);
        if (buf.length < len) return;
        const msg = parsePlist(buf.subarray(16, len).toString()) as Record<string, unknown>;
        seen.push(msg);
        buf = buf.subarray(len);
        if (msg.MessageType === 'ListDevices')
          s.write(
            frame(
              {
                DeviceList: [
                  {
                    DeviceID: 4,
                    Properties: {
                      SerialNumber: '00001234-0123456789ABCDEF',
                      ConnectionType: 'Network',
                    },
                  },
                  {
                    DeviceID: 5,
                    Properties: { SerialNumber: '000012340123456789ABCDEF', ConnectionType: 'USB' },
                  },
                ],
              },
              1,
            ),
          );
        else {
          s.write(frame({ MessageType: 'Result', Number: 0 }, 1));
          s.write('hello');
        }
      });
    });
    await new Promise<void>((r) => server.listen(path, r));
    try {
      expect((await listDevices(path)).map((d) => d.deviceId)).toEqual([4, 5]);
      const { socket, rest } = await connectPort('00001234-0123456789ABCDEF', 8100, path);
      const data = await new Promise<string>((r) => {
        if (rest.length) return r(rest.toString());
        socket.once('data', (d) => r(d.toString()));
        socket.resume();
      });
      socket.destroy();
      expect(data).toBe('hello');
      const connect = seen.find((m) => m.MessageType === 'Connect')!;
      expect(connect.DeviceID).toBe(5); // the USB one, not the Wi-Fi one
      expect(connect.PortNumber).toBe(0xa41f); // 8100 = 0x1fa4, swapped
    } finally {
      server.close();
    }
  });
});
