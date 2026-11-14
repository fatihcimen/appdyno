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
      expect(lines).toMatch(/not read within 3 s: webview reads it/);
    }),
  );
});

describe('webview', () => {
  it('says a page between two loads may be why none is listed, and that one asked for may have changed', async () => {
    // as Safari's, just after a click that navigated
    const pages: WebPage[] = [];
    const web = { pages: () => Promise.resolve(pages), evaluate: () => Promise.resolve('LLVM') };
    const { call } = await connect(Object.assign(new FakeDevice(), { web }));
    const app = 'com.apple.mobilesafari';
    expect((await call('webview', { action: 'eval', js: 'document.title', app })).text).toBe(
      `NOT_FOUND: no web page to inspect in ${app}: one that is loading shows here once it has loaded, and an app's web view only while it is on the screen and the app is debuggable, or set its debugging on\nhint: ask again in a moment`,
    );
    pages.push({ id: 'PID:1/2', title: 'LLVM - Wikipedia', url: 'https://x.test/LLVM', app });
    expect((await call('webview', { action: 'eval', js: '1', page: 'Swift', app })).text).toBe(
      `NOT_FOUND: no page in ${app} matches Swift: one that has loaded another since goes by its new title and URL\nhint: webview pages lists them as they are now`,
    );
  });
});
