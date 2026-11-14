import {
  must,
  CdpSession,
  devToolsTargets,
  onEndpoint,
  type WebInspector,
  type WebPage,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { type Adb } from './adb.js';

const SOCKET = /@(webview_devtools_remote_(\d+))\s*$/gm;

/** Web views of debuggable apps, by the abstract socket each opens, through a port `adb` forwards. */
export class AndroidWeb implements WebInspector {
  constructor(
    private readonly adb: Adb,
    private readonly serial: string,
  ) {}

  /** `f` with a local port to the socket; each call has its own, so nothing stays behind. */
  private async through<T>(socket: string, f: (base: string) => Promise<T>): Promise<T> {
    const port = (
      await this.adb.run(['-s', this.serial, 'forward', 'tcp:0', `localabstract:${socket}`], 15_000)
    ).trim();
    try {
      return await f(`http://127.0.0.1:${port}`);
    } finally {
      await this.adb
        .run(['-s', this.serial, 'forward', '--remove', `tcp:${port}`], 15_000)
        .catch(() => undefined);
    }
  }

  async pages(app: string | undefined): Promise<WebPage[]> {
    const unix = await this.adb.exec(this.serial, 'cat /proc/net/unix');
    // a socket is listed once listening and once more for each connection made to it: each is asked once
    const sockets = new Map(
      [...unix.matchAll(SOCKET)].map((m) => [must(m[1], 'a socket'), must(m[2], 'a pid')]),
    );
    const pages: WebPage[] = [];
    for (const [socket, pid] of sockets) {
      const cmdline = await this.adb.exec(this.serial, `cat /proc/${pid}/cmdline`);
      const pkg = must(cmdline.split('\0')[0], 'a name').trim();
      if (app && pkg !== app) continue;
      const targets = await this.through(socket, devToolsTargets).catch(() => []);
      for (const t of targets)
        if (t.type === 'page')
          pages.push({
            id: `${socket}/${t.id}`,
            title: t.title ?? '',
            url: t.url ?? '',
            app: pkg,
            ...(t.description?.includes('"visible":true') && { visible: true }),
          });
    }
    return pages;
  }

  async evaluate(page: WebPage, script: string): Promise<unknown> {
    const at = page.id.indexOf('/');
    return this.through(page.id.slice(0, at), async (base) => {
      const target = (await devToolsTargets(base)).find((t) => t.id === page.id.slice(at + 1));
      if (!target?.webSocketDebuggerUrl)
        throw new DeviceError('NOT_FOUND', `the page ${page.title || page.id} has gone`);
      if (!onEndpoint(base, target.webSocketDebuggerUrl))
        throw new DeviceError(
          'POLICY_DENIED',
          `the app's DevTools named ${target.webSocketDebuggerUrl} for ${page.title || page.id}, off the port forwarded to it: it was not opened`,
        );
      const session = await CdpSession.open(target.webSocketDebuggerUrl);
      try {
        return await session.evaluate(script);
      } finally {
        session.close();
      }
    });
  }
}
