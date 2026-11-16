import { describe, expect, it } from 'vitest';
import type { Screen, WebPage } from '@appdyno/core';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import type { Session } from '../src/session.js';
import { webLines } from '../src/web.js';
import { connect } from './truth-client.js';

const screen = {
  elements: [{ type: 'WebView', rect: { x: 0, y: 100, width: 400, height: 700 } }],
  list: [],
} as unknown as Screen;

const sessionWith = (pages: () => Promise<unknown>) =>
  ({
    appId: 'com.example',
    device: { web: { pages, evaluate: () => Promise.resolve(undefined) } },
  }) as unknown as Session;

describe("a screen's web lines", () => {
  it(
    'do not hold the screen for an inspector slow to answer, and say the page was left unread',
    fakeTimed(async () => {
      const lines = await webLines(
        sessionWith(() => new Promise(() => undefined)),
        screen,
        (t) => t,
      );
      expect(lines).toMatch(
        /not read within 3 s, and not asked again for 30 s: inspect_app reads it/,
      );
    }),
  );

  it(
    'do not ask an inspector that was slow again at the next reads, which would each wait for it',
    fakeTimed(async () => {
      let asked = 0;
      const s = sessionWith(() => {
        asked++;
        return new Promise(() => undefined);
      });
      const first = await webLines(s, screen, (t) => t);
      expect(await webLines(s, screen, (t) => t)).toBe(first);
      expect(asked).toBe(1);
    }),
  );

  it('leave out what the page holds past the web view, where a touch would land on something else', async () => {
    const el = (text: string, y: number) => ({ tag: 'a', text, x: 10, y, w: 100, h: 20 });
    const dom = {
      title: '',
      url: '',
      width: 400,
      elements: [el('On the screen', 300), el('Far below', 3000)],
    };
    const s = {
      appId: 'com.example',
      device: {
        web: {
          pages: () => Promise.resolve([{ visible: true }]),
          evaluate: () => Promise.resolve(dom),
        },
      },
    } as unknown as Session;
    expect(await webLines(s, screen, (t) => t)).toBe(
      'not in the accessibility tree:\nweb a "On the screen" 60,410',
    );
  });
});

describe('webview', () => {
  it('says a page between two loads may be why none is listed, and that one asked for may have changed', async () => {
    // as Safari's, just after a click that navigated
    const pages: WebPage[] = [];
    const web = { pages: () => Promise.resolve(pages), evaluate: () => Promise.resolve('LLVM') };
    const { call } = await connect(Object.assign(new FakeDevice(), { web }));
    const app = 'com.apple.mobilesafari';
    expect(
      (await call('inspect_app', { action: 'web_eval', js: 'document.title', app })).text,
    ).toBe(
      `NOT_FOUND: no web page to inspect in ${app}: one that is loading shows here once it has loaded, and an app's web view only while it is on the screen and the app is debuggable, or set its debugging on\nhint: ask again in a moment`,
    );
    pages.push({ id: 'PID:1/2', title: 'LLVM - Wikipedia', url: 'https://x.test/LLVM', app });
    expect(
      (await call('inspect_app', { action: 'web_eval', js: '1', page: 'Swift', app })).text,
    ).toBe(
      `NOT_FOUND: no page in ${app} matches Swift: one that has loaded another since goes by its new title and URL\nhint: inspect_app web_pages lists them as they are now`,
    );
  });
});
