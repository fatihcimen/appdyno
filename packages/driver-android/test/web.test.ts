import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidWeb } from '../src/web.js';

const listening = async (s: ReturnType<typeof createServer>) => {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return (s.address() as AddressInfo).port;
};

it("opens no page socket the app's DevTools names off the port forwarded to it", async () => {
  // what the app's socket names is the app's to say: here a socket on this Mac's other port, as one on any host
  const upgrades: string[] = [];
  const elsewhere = createServer();
  elsewhere.on('upgrade', (req, socket) => {
    upgrades.push(String(req.url));
    socket.destroy();
  });
  const other = await listening(elsewhere);
  const devtools = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify([
        {
          id: 'p1',
          type: 'page',
          webSocketDebuggerUrl: `ws://127.0.0.1:${other}/devtools/page/p1`,
        },
      ]),
    );
  });
  const forwarded = await listening(devtools);
  const adb = {
    run: (args: string[]) => Promise.resolve(args.includes('--remove') ? '' : String(forwarded)),
  } as unknown as Adb;
  try {
    const page = { id: 'webview_devtools_remote_1/p1', title: 'a', url: '', app: 'dev.app' };
    await expect(new AndroidWeb(adb, 'emulator-5554').evaluate(page, '1')).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    expect(upgrades).toEqual([]);
  } finally {
    elsewhere.close();
    devtools.close();
  }
});

/** `/proc/net/unix` with a web view's socket listening, and open once for each connection still made to it. */
const UNIX = `Num       RefCount Protocol Flags    Type St Inode Path
0000000000000000: 00000002 00000000 00010000 0001 01 381245 @webview_devtools_remote_4376
0000000000000000: 00000003 00000000 00000000 0001 03 383310 @webview_devtools_remote_4376
0000000000000000: 00000003 00000000 00000000 0001 03 383311
0000000000000000: 00000003 00000000 00000000 0001 03 383402 @webview_devtools_remote_4376
0000000000000000: 00000002 00000000 00010000 0001 01 12907 /dev/socket/zygote
`;

/** A device with that socket, whose forwards reach `devtools`; what it was told is kept. */
const webViewOf = async (devtools: ReturnType<typeof createServer>) => {
  const forwarded = await listening(devtools);
  const asked: string[] = [];
  const adb = {
    exec: (_: string, c: string) => {
      asked.push(c);
      return Promise.resolve(c === 'cat /proc/net/unix' ? UNIX : 'org.wikipedia.alpha\0');
    },
    run: (args: string[]) => {
      asked.push(args.join(' '));
      return Promise.resolve(args.includes('--remove') ? '' : String(forwarded));
    },
  } as unknown as Adb;
  return { asked, web: new AndroidWeb(adb, 'emulator-5560') };
};

const ISTANBUL = (_req: unknown, res: ServerResponse) => {
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify([
      {
        id: 'DC9C',
        type: 'page',
        title: 'Istanbul',
        url: 'https://en.wikipedia.org/wiki/Istanbul',
      },
    ]),
  );
};

it('lists a page once, however many connections its socket holds', async () => {
  const devtools = createServer(ISTANBUL);
  const { asked, web } = await webViewOf(devtools);
  try {
    expect(await web.pages(undefined)).toEqual([
      {
        id: 'webview_devtools_remote_4376/DC9C',
        title: 'Istanbul',
        url: 'https://en.wikipedia.org/wiki/Istanbul',
        app: 'org.wikipedia.alpha',
      },
    ]);
    expect(asked.filter((c) => c.startsWith('cat /proc/4376/'))).toHaveLength(1);
    expect(asked.filter((c) => c.includes('forward tcp:0'))).toHaveLength(1);
  } finally {
    devtools.close();
  }
});

it('keeps no connection open to a socket once its forward is gone', async () => {
  // one kept for a next request outlived the forward, and the app listed its socket once more for it
  let open = 0;
  const devtools = createServer(ISTANBUL);
  devtools.on('connection', (c) => {
    open++;
    c.on('close', () => open--);
  });
  const { web } = await webViewOf(devtools);
  try {
    await web.pages(undefined);
    await vi.waitFor(() => expect(open).toBe(0));
  } finally {
    devtools.close();
  }
});
