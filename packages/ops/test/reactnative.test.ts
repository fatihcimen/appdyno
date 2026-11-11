import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type DeviceProvider } from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { ToolError } from '../src/tool.js';
import { FakeDevice } from './fake-device.js';
import { callerOf, checkedOps } from './helpers.js';

/** One text frame from the server. */
const frame = (text: string) => {
  const body = Buffer.from(text);
  const head =
    body.length < 126
      ? Buffer.from([0x81, body.length])
      : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, body]);
};

/** The text of one masked client frame, which is how they all come. */
const unmask = (b: Buffer) => {
  const short = b.readUInt8(1) & 127;
  const at = short === 126 ? 4 : 2;
  const n = short === 126 ? b.readUInt16BE(2) : short;
  const key = b.subarray(at, at + 4);
  return Buffer.from(
    b.subarray(at + 4, at + 4 + n).map((v, i) => v ^ key.readUInt8(i % 4)),
  ).toString();
};

/** A Metro as much as the op needs: its list, its reload route and a Hermes that logs on enable. */
async function fakeMetro(opts: { reloadRoute: boolean; targets?: number; socket?: string }) {
  const calls: string[] = [];
  let port = 0;
  const targets = Array.from({ length: opts.targets ?? 1 }, (_, i) => ({
    id: `device-${i}`,
    title: 'Hermes React Native',
    description: 'dev.app',
    webSocketDebuggerUrl: opts.socket ?? `ws://localhost:0/inspector/${i}`,
  }));
  const server: Server = createServer((req, res) => {
    calls.push(`${String(req.method)} ${String(req.url)}`);
    if (req.url === '/json/list') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          targets.map((t) => ({
            ...t,
            webSocketDebuggerUrl: t.webSocketDebuggerUrl.replace(':0/', `:${port}/`),
          })),
        ),
      );
    } else if (req.url === '/reload' && opts.reloadRoute) res.end('OK');
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  const sockets: Socket[] = [];
  server.on('upgrade', (req, socket) => {
    sockets.push(socket as Socket);
    const accept = createHash('sha1')
      .update(`${String(req.headers['sec-websocket-key'])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('data', (d: Buffer) => {
      if ((d.readUInt8(0) & 0x0f) !== 1) return;
      const m = JSON.parse(unmask(d)) as { id: number; method: string };
      calls.push(m.method);
      socket.write(frame(JSON.stringify({ id: m.id, result: {} })));
      if (m.method === 'Runtime.enable')
        socket.write(
          frame(
            JSON.stringify({
              method: 'Runtime.consoleAPICalled',
              params: {
                type: 'warn',
                args: [
                  { type: 'string', value: 'token=abc123 is here' },
                  { type: 'number', value: 3 },
                ],
              },
            }),
          ),
        );
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  return {
    metro: `127.0.0.1:${port}`,
    calls,
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

const ops = () => checkedOps(new ServerContext(DEFAULT_POLICY, []));
const call = async (args: Record<string, unknown>) => {
  const op = must(ops().react_native, 'react_native');
  const r = await op.handler(op.input.parse(args));
  return r.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
};

describe('react_native', () => {
  let metro: Awaited<ReturnType<typeof fakeMetro>> | undefined;
  afterEach(() => metro?.close());

  it('says when no Metro answers, and asks for no device', async () => {
    await expect(call({ action: 'targets', metro: '127.0.0.1:1' })).rejects.toThrow(
      /no Metro answers/,
    );
    await expect(call({ action: 'targets', metro: '127.0.0.1:1' })).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  it('lists targets', async () => {
    metro = await fakeMetro({ reloadRoute: true });
    expect(await call({ action: 'targets', metro: metro.metro })).toBe(
      'device-0 "Hermes React Native" dev.app',
    );
  });

  it("reads the JS console over the runtime's protocol, credentials hidden", async () => {
    metro = await fakeMetro({ reloadRoute: true, targets: 2 });
    const t = await call({ action: 'logs', metro: metro.metro, ms: 200 });
    expect(t).toMatch(/^1 console lines of device-1 in 200 ms/);
    expect(t).toContain('warn: token=••• is here 3');
    expect(metro.calls).toContain('Runtime.enable');
  });

  it('reloads through Metro, and through the runtime where Metro has no route', async () => {
    metro = await fakeMetro({ reloadRoute: true });
    expect(await call({ action: 'reload', metro: metro.metro })).toBe('reloaded through Metro');
    expect(metro.calls).toContain('POST /reload');
    metro.close();
    metro = await fakeMetro({ reloadRoute: false });
    expect(await call({ action: 'reload', metro: metro.metro })).toBe('reloaded device-0');
    expect(metro.calls).toContain('Page.reload');
  });

  describe('during a recording', () => {
    let opens: number;
    const device = new FakeDevice();
    const provider: DeviceProvider = {
      list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
      handles: () => true,
      open: () => {
        opens++;
        return device;
      },
    };
    beforeEach(() => {
      opens = 0;
      vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-rn-')));
    });
    afterEach(() => vi.unstubAllEnvs());

    it('marks a reload, by no more than its name, and opens no device to find out', async () => {
      metro = await fakeMetro({ reloadRoute: true });
      // the recording began in an earlier process, on the device a command line remembers
      const remember = join(mkdtempSync(join(tmpdir(), 'appdyno-rn-')), 'session.json');
      const start = new ServerContext(DEFAULT_POLICY, [provider], { remember });
      await callerOf(start)('flow', { action: 'start' });
      start.close();
      opens = 0;

      const ctx = new ServerContext(DEFAULT_POLICY, [provider], { remember });
      const call = callerOf(ctx);
      await call('react_native', { action: 'targets', metro: metro.metro });
      await call('react_native', { action: 'reload', metro: metro.metro });
      expect(opens).toBe(0);
      const stop = await call('flow', { action: 'stop' });
      expect(stop.text.split('\n').filter((l) => l.startsWith('unrecorded'))).toEqual([
        'unrecorded "react_native reload"',
      ]);
    });

    it('with a device attached and none named, opens none and marks nothing', async () => {
      metro = await fakeMetro({ reloadRoute: true });
      const call = callerOf(new ServerContext(DEFAULT_POLICY, [provider]));
      await call('react_native', { action: 'reload', metro: metro.metro });
      expect(opens).toBe(0);
    });
  });

  it('calls no Metro but on this Mac', () => {
    for (const metro of ['10.0.0.5:8080', 'secret.example.com:80', 'localhost.example.com:80'])
      expect(() => ops().react_native?.input.parse({ action: 'targets', metro })).toThrow(
        /Metro on this Mac/,
      );
    for (const metro of ['localhost:8081', '127.0.0.1:8081', '[::1]:8081'])
      expect(ops().react_native?.input.parse({ action: 'targets', metro })).toMatchObject({
        metro,
      });
  });

  it('opens no runtime socket a Metro names off its own host and port', async () => {
    for (const socket of [
      'ws://10.0.0.5:0/inspector/0',
      'ws://localhost:0@evil.example/inspector/0',
      'ws://localhost.evil.example:0/inspector/0',
      'ws://localhost:1/inspector/0',
      'http://localhost:0/inspector/0',
    ]) {
      metro = await fakeMetro({ reloadRoute: false, socket });
      await expect(call({ action: 'logs', metro: metro.metro, ms: 100 })).rejects.toMatchObject({
        code: 'POLICY_DENIED',
      });
      await expect(call({ action: 'reload', metro: metro.metro })).rejects.toThrow(
        /which is not on it: it was not opened/,
      );
      expect(metro.calls.filter((c) => !c.includes('/'))).toEqual([]);
      metro.close();
    }
    metro = undefined;
  });

  it('follows no redirect a port on this Mac answers with, to another host or port', async () => {
    const elsewhere: string[] = [];
    const other = createServer((req, res) => {
      elsewhere.push(String(req.url));
      res.end('[]');
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const to = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    const sending = createServer((req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `${to}${String(req.url)}`);
      res.end();
    });
    await new Promise<void>((r) => sending.listen(0, '127.0.0.1', r));
    const at = `127.0.0.1:${(sending.address() as AddressInfo).port}`;
    try {
      for (const action of ['targets', 'reload', 'logs'])
        await expect(call({ action, metro: at, ms: 100 })).rejects.toThrow(/answered 302/);
      expect(elsewhere).toEqual([]);
    } finally {
      other.close();
      sending.close();
    }
  });

  it('says when no app is connected', async () => {
    metro = await fakeMetro({ reloadRoute: false, targets: 0 });
    await expect(call({ action: 'logs', metro: metro.metro, ms: 100 })).rejects.toThrow(
      /no app is connected/,
    );
  });
});
