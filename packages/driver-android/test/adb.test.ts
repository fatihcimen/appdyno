import { createServer, type AddressInfo, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceError } from '@appdyno/protocol';
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
    const device = new AndroidDevice('emulator-5640', adb, { animations });
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

  it('says what the agent said of a read with no window, as an app that hangs reads so', async () => {
    const said = 'no window to read: the app in front is not answering';
    const rpc = {
      closed: false,
      call: async () => {
        throw new DeviceError('NOT_FOUND', said);
      },
      close: () => undefined,
    };
    const adb = { exec: async () => 'mWakefulness=Awake' } as unknown as Adb;
    const device = new AndroidDevice('emulator-5640', adb);
    Object.assign(device, {
      launcher: { connect: async () => ({ rpc, hello: {}, started: false }) },
    });
    await expect(device.tree()).rejects.toMatchObject({ code: 'NOT_FOUND', message: said });
    await expect(device.tree({ asItIs: true })).rejects.toMatchObject({ message: said });
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

describe('a device that stopped answering', () => {
  let server: Server;
  afterEach(() => void server.close());

  /** An adb server: it takes the choice of a device, and then says nothing of what that device was asked. */
  const silentAfterTransport = async () => {
    server = createServer((socket) => {
      socket.on('error', () => undefined);
      socket.on('data', (asked) => {
        if (asked.includes('host:transport')) socket.write('OKAY');
      });
    });
    await new Promise<void>((up) => server.listen(0, '127.0.0.1', up));
    return new Adb({ port: (server.address() as AddressInfo).port, answerMs: 50 });
  };

  it('fails a command, so that what waits on it goes on', async () => {
    const adb = await silentAfterTransport();
    await expect(adb.exec('X1', 'getprop')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('fails a stream that does not open', async () => {
    const adb = await silentAfterTransport();
    await expect(adb.open('X1', 'localabstract:a')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('fails a list adb never gives', async () => {
    const adb = await silentAfterTransport();
    await expect(adb.devices()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('leaves an open stream as quiet as its user likes', async () => {
    server = createServer((socket) => {
      socket.on('error', () => undefined);
      socket.on('data', () => socket.write('OKAY'));
    });
    await new Promise<void>((up) => server.listen(0, '127.0.0.1', up));
    const adb = new Adb({ port: (server.address() as AddressInfo).port, answerMs: 50 });
    const { socket } = await adb.open('X1', 'localabstract:a');
    await new Promise((r) => setTimeout(r, 150));
    expect(socket.destroyed).toBe(false);
    socket.destroy();
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

describe('what a window calls a device', () => {
  const answers = (table: Record<string, string>) =>
    ({
      exec: async (_s: string, command: string) => table[command] ?? '',
    }) as unknown as Adb;
  const PROPS = /^getprop ro\.product\.marketname;/;
  const withProps = (out: string, rest: Record<string, string>) =>
    ({
      exec: async (_s: string, command: string) =>
        PROPS.test(command) ? out : (rest[command] ?? ''),
    }) as unknown as Adb;

  it('is plainly an emulator, whatever its model says', async () => {
    const adb = answers({ 'getprop ro.product.model': 'sdk_gphone64_arm64\n' });
    expect(await new AndroidDevice('emulator-5640', adb).hardware()).toMatchObject({
      model: 'sdk_gphone64_arm64',
      name: 'Android emulator',
    });
  });

  it('is what a phone is sold as, where its maker says, and its model picks the frame', async () => {
    const adb = withProps('\n\nRedmi Note 13\n', { 'getprop ro.product.model': '23129RAA4G\n' });
    expect(await new AndroidDevice('R58M', adb).hardware()).toMatchObject({
      model: '23129RAA4G',
      name: 'Redmi Note 13',
    });
  });

  it("is the phone's own name where no property has it", async () => {
    const adb = withProps('\n', {
      'getprop ro.product.model': 'SM-S918B\n',
      'settings get global device_name': 'Galaxy S23 Ultra\n',
    });
    expect((await new AndroidDevice('R58M', adb).hardware()).name).toBe('Galaxy S23 Ultra');
  });

  it('is its model where it says nothing', async () => {
    const adb = withProps('\n', {
      'getprop ro.product.model': 'Pixel 7\n',
      'settings get global device_name': 'null\n',
    });
    const hardware = await new AndroidDevice('R58M', adb).hardware();
    expect(hardware.model).toBe('Pixel 7');
    expect(hardware.name).toBeUndefined();
  });
});
