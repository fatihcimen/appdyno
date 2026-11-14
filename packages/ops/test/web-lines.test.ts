import { describe, expect, it } from 'vitest';
import type { Screen } from '@appdyno/core';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import type { Session } from '../src/session.js';
import { webLines } from '../src/web.js';

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
