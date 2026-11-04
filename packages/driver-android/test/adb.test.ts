import { describe, expect, it } from 'vitest';
import { Adb, assertSerial, parseDevices, shq } from '../src/adb.js';
import { AndroidDevice } from '../src/device.js';

describe('an agent reached', () => {
  const reached = (animations: 'on' | 'off', started: boolean) => {
    const asked: string[] = [];
    const ran: string[] = [];
    const rpc = {
      closed: false,
      call: async (method: string) => {
        asked.push(method);
        return { result: {} };
      },
      close: () => undefined,
    };
    const hello = { model: 'Pixel' };
    const adb = { exec: async (_: string, c: string) => (ran.push(c), '') } as unknown as Adb;
    const device = new AndroidDevice('emulator-5640', adb, 0, false, animations);
    Object.assign(device, { launcher: { connect: async () => ({ rpc, hello, started }) } });
    return { asked, ran, device, hello };
  };

  it("takes the session's animations off, and clears what a dead host left on a new agent", async () => {
    const { asked, ran, device, hello } = reached('off', true);
    expect(await device.open()).toBe(hello);
    expect(asked).toEqual(['animations.set']);
    expect(ran.length).toBeGreaterThan(0);
    expect(device.lastStartWasCold).toBe(true);
  });

  it('asks nothing of one found running with animations on', async () => {
    const { asked, ran, device } = reached('on', false);
    await device.open();
    expect(asked).toEqual([]);
    expect(ran).toEqual([]);
    expect(device.lastStartWasCold).toBe(false);
  });
});

describe('launching an app', () => {
  const STARTED = 'Starting: Intent { cmp=a.b/.Main }\n';
  /** A device whose `am start` answers `answer`; what it was told to run is kept. */
  const device = (answer: string, ps = '') => {
    const ran: string[] = [];
    const adb = {
      exec: async (_serial: string, command: string) => {
        ran.push(command);
        return command.startsWith('ps ')
          ? ps
          : command.includes('resolve-activity')
            ? 'priority=0\na.b/.Main\n'
            : answer;
      },
    } as unknown as Adb;
    return { d: new AndroidDevice('emulator-5640', adb), ran };
  };
  const starts = (ran: string[]) => ran.filter((c) => c.startsWith('am start'));

  it('takes a start still drawing when the wait ended for a start: a read tells what is on the screen', async () => {
    const out = `${STARTED}Status: timeout\nLaunchState: UNKNOWN (0)\nWaitTime: 10001\nComplete\n`;
    await expect(device(out).d.launch('a.b')).resolves.toBeUndefined();
  });

  it('says what went wrong, not what it was starting', async () => {
    await expect(
      device(`${STARTED}Error: Activity class {a.b/.Main} does not exist.\n`).d.launch('a.b'),
    ).rejects.toMatchObject({
      code: 'APP_NOT_RUNNING',
      message: 'a.b did not start: Error: Activity class {a.b/.Main} does not exist.',
    });
  });

  it('refuses an app with no launcher activity', async () => {
    const adb = { exec: async () => 'No activity found\n' } as unknown as Adb;
    await expect(new AndroidDevice('emulator-5640', adb).launch('a.b')).rejects.toMatchObject({
      code: 'APP_NOT_RUNNING',
    });
  });

  it('says an emulator is virtual and a phone is not', () => {
    const adb = {} as Adb;
    expect(new AndroidDevice('emulator-5640', adb).virtual).toBe(true);
    expect(new AndroidDevice('R58M', adb).virtual).toBe(false);
  });

  it('starts it once when the start began alongside the agent', async () => {
    const { d, ran } = device(`${STARTED}Status: ok\n`);
    d.launchAlongside('a.b');
    await d.launch('a.b');
    expect(starts(ran)).toHaveLength(1);
    await d.launch('a.b');
    expect(starts(ran)).toHaveLength(2);
  });

  it('leaves the device alone alongside another tool’s automation: that session may be refused', async () => {
    const { d, ran } = device(`${STARTED}Status: ok\n`, '1234 shell uiautomator runtest x.jar\n');
    d.launchAlongside('a.b');
    await new Promise((r) => setTimeout(r, 10));
    expect(starts(ran)).toHaveLength(0);
    await d.launch('a.b');
    expect(starts(ran)).toHaveLength(1);
  });
});

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
