import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { opsFor } from '../src/registry.js';
import { ToolError, type Op } from '../src/tool.js';

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
  const short = b[1]! & 127;
  const at = short === 126 ? 4 : 2;
  const n = short === 126 ? b.readUInt16BE(2) : short;
  const key = b.subarray(at, at + 4);
  return Buffer.from(b.subarray(at + 4, at + 4 + n).map((v, i) => v ^ key[i % 4]!)).toString();
};

/** A Metro as much as the op needs: its list, its reload route and a Hermes that logs on enable. */
async function fakeMetro(opts: { reloadRoute: boolean; targets?: number }) {
  const calls: string[] = [];
  let port = 0;
  const targets = Array.from({ length: opts.targets ?? 1 }, (_, i) => ({
    id: `device-${i}`,
    title: 'Hermes React Native',
    description: 'dev.app',
    webSocketDebuggerUrl: `ws://127.0.0.1:0/inspector/${i}`,
  }));
  const server: Server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
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
      if ((d[0]! & 0x0f) !== 1) return;
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

const ops = () => opsFor(new ServerContext(DEFAULT_POLICY, []));
const call = async (args: Record<string, unknown>) => {
  const op = ops().react_native as Op;
  const r = await op.handler(op.input.parse(args) as Record<string, unknown>);
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

  it('says when no app is connected', async () => {
    metro = await fakeMetro({ reloadRoute: false, targets: 0 });
    await expect(call({ action: 'logs', metro: metro.metro, ms: 100 })).rejects.toThrow(
      /no app is connected/,
    );
  });
});
