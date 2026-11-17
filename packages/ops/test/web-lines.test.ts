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

  it("ask the app in front for its page where no app is selected, not every app's inspector", async () => {
    const asked: unknown[] = [];
    const s = {
      device: {
        web: {
          pages: (app: unknown) => (asked.push(app), Promise.resolve([])),
          evaluate: () => Promise.resolve(undefined),
        },
      },
    } as unknown as Session;
    await webLines(s, { ...screen, foreground: 'com.front' }, (t) => t);
    expect(asked).toEqual(['com.front']);
  });

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
  it('clicks once the page just shown has loaded, as it is about:blank at first, and says how long it looked', async () => {
    // as a WKWebView's page on iOS 27.2 just after its screen opened: listed, and still blank
    let asked = 0;
    const page: WebPage = { id: 'PID:1/1', title: '', url: 'about:blank', visible: true };
    const web = {
      pages: () => Promise.resolve([page]),
      evaluate: (_: unknown, js: string) =>
        Promise.resolve(
          js.includes('#pay') && ++asked >= 3 ? { tag: 'button', text: 'Pay' } : null,
        ),
    };
    const { call } = await connect(Object.assign(new FakeDevice(), { web }));
    expect((await call('inspect_app', { action: 'web_click', selector: '#pay' })).text).toBe(
      'clicked button "Pay"',
    );
    expect((await call('inspect_app', { action: 'web_click', selector: '#none' })).text).toBe(
      'NOT_FOUND: nothing on the page matches #none after 1500 ms',
    );
  });

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
