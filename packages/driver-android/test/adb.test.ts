import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceError } from '@appdyno/protocol';
import { Adb, assertSerial, cableSerial, overNetwork, parseDevices, shq } from '../src/adb.js';
import { AndroidDevice } from '../src/device.js';

describe('an agent reached', () => {
  const reached = (animations: 'on' | 'off', started: boolean) => {
    const asked: string[] = [];
    const ran: string[] = [];
    const rpc = {
      closed: false,
      call: (method: string) => {
        asked.push(method);
        return Promise.resolve({ result: {} });
      },
      close: () => undefined,
    };
    const hello = { model: 'Pixel' };
    const adb = {
      exec: (_: string, c: string) => Promise.resolve((ran.push(c), '')),
    } as unknown as Adb;
    const device = new AndroidDevice('emulator-5640', adb, { animations });
    Object.assign(device, {
      launcher: { connect: () => Promise.resolve({ rpc, hello, started }) },
    });
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
      call: () => {
        return Promise.reject(new DeviceError('NOT_FOUND', said));
      },
      close: () => undefined,
    };
    const adb = { exec: () => Promise.resolve('mWakefulness=Awake') } as unknown as Adb;
    const device = new AndroidDevice('emulator-5640', adb);
    Object.assign(device, {
      launcher: { connect: () => Promise.resolve({ rpc, hello: {}, started: false }) },
    });
    // with what to do, which the agent does not say
    const hint = expect.stringMatching(
      /^its main thread is busy: read again in a moment/,
    ) as unknown;
    await expect(device.tree()).rejects.toMatchObject({ code: 'NOT_FOUND', message: said, hint });
    await expect(device.tree({ asItIs: true })).rejects.toMatchObject({ message: said, hint });
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
      exec: (_serial: string, command: string) => {
        ran.push(command);
        return Promise.resolve(
          command.startsWith('ps ')
            ? ps
            : command.includes('resolve-activity')
              ? 'priority=0\na.b/.Main\n'
              : answer,
        );
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
    const adb = { exec: () => Promise.resolve('No activity found\n') } as unknown as Adb;
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

  it('fails a command whose connection broke on the way, rather than answer what came as whole', async () => {
    server = createServer((socket) => {
      socket.on('error', () => undefined);
      socket.on('data', (asked) => {
        if (asked.includes('host:transport')) socket.write('OKAY');
        // the start of an answer, then the transport goes, as a phone's Wi-Fi does
        else socket.write('OKAY12', () => setTimeout(() => socket.resetAndDestroy(), 20));
      });
    });
    await new Promise<void>((up) => server.listen(0, '127.0.0.1', up));
    const adb = new Adb({ port: (server.address() as AddressInfo).port, answerMs: 5_000 });
    await expect(adb.exec('X1', 'pidof a.b')).rejects.toMatchObject({ code: 'DEVICE_GONE' });
  });

  it('bounds a command given input, as one without', async () => {
    // it starts, takes its input, and then never ends
    server = createServer({ allowHalfOpen: true }, (socket) => {
      socket.on('error', () => undefined);
      socket.on('data', () => socket.write('OKAY'));
    });
    await new Promise<void>((up) => server.listen(0, '127.0.0.1', up));
    const adb = new Adb({ port: (server.address() as AddressInfo).port, answerMs: 5_000 });
    await expect(adb.execIn('X1', 'cat > t', 'x', 100)).rejects.toMatchObject({ code: 'TIMEOUT' });
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

  it('reads a phone found by name on the network, a second one of that name too', () => {
    expect(
      parseDevices(
        '192.168.1.5:41111 device model:A transport_id:7\nadb-R68-Ab (2)._adb-tls-connect._tcp device model:B\n',
      ),
    ).toMatchObject([
      { serial: '192.168.1.5:41111', state: 'device', props: { model: 'A' } },
      { serial: 'adb-R68-Ab (2)._adb-tls-connect._tcp', state: 'device', props: { model: 'B' } },
    ]);
    expect(overNetwork('192.168.1.5:41111')).toBe(true);
    expect(overNetwork('[fe80::1]:5555')).toBe(true);
    expect(overNetwork('adb-R68-Ab._adb-tls-connect._tcp')).toBe(true);
    expect(overNetwork('emulator-5580')).toBe(false);
    expect(overNetwork('R58TEST0001')).toBe(false);
    expect(cableSerial('adb-R68-Ab._adb-tls-connect._tcp')).toBe('R68');
    expect(cableSerial('192.168.1.5:41111')).toBeUndefined();
  });

  it('pairs by what the phone shows, and says what adb said when it did not', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-adb-'));
    const bin = join(dir, 'adb');
    writeFileSync(bin, '#!/bin/sh\necho "$@" > "$0.args"\necho "Successfully paired to $2"\n');
    chmodSync(bin, 0o755);
    await new Adb({ bin }).pair('192.168.1.5:37000', '123456');
    expect(readFileSync(`${bin}.args`, 'utf8').trim()).toBe('pair 192.168.1.5:37000 123456');
    writeFileSync(bin, '#!/bin/sh\necho "Enter pairing code: nothing"\n');
    await expect(new Adb({ bin }).pair('192.168.1.5:37000', '1')).rejects.toThrow('did not pair');
    writeFileSync(bin, '#!/bin/sh\necho "Failed: Wrong password"\nexit 1\n');
    await expect(new Adb({ bin }).pair('192.168.1.5:37000', '1')).rejects.toThrow('Wrong password');
    await expect(new Adb({ bin }).pair('a;b', '1')).rejects.toThrow('not a device serial');
    rmSync(dir, { recursive: true });
  });

  it('refuses a serial that could inject into the adb request', () => {
    expect(() => assertSerial('emulator-5580')).not.toThrow();
    expect(() => assertSerial('a;b')).toThrow();
    expect(() => assertSerial('x'.repeat(97))).toThrow();
    for (const wireless of [
      '192.168.1.5:41111',
      '[fe80::1%wlan0]:5555',
      'adb-R58TEST0001-AbCdEf._adb-tls-connect._tcp',
      'adb-R58TEST0001-AbCdEf (2)._adb-tls-connect._tcp',
    ])
      expect(assertSerial(wireless)).toBe(wireless);
    expect(() => assertSerial('a$(b)')).toThrow();
  });
});

describe('adb server', () => {
  it('starts the server again after each outage (kill-server between calls)', async () => {
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
      exec: (_s: string, command: string) => Promise.resolve(table[command] ?? ''),
    }) as unknown as Adb;
  const PROPS = 'getprop ro.product.marketname;';
  const withProps = (out: string, rest: Record<string, string>) =>
    ({
      exec: (_s: string, command: string) =>
        Promise.resolve(command.startsWith(PROPS) ? out : (rest[command] ?? '')),
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
