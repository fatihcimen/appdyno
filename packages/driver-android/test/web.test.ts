import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
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
