import { describe, expect, it } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidApps } from '../src/apps.js';
import { linkFilters, linkStates } from '../src/links.js';

/** What `dumpsys package` and `pm get-app-links` answered for the fixture on an API 34 emulator, cut to the parts read. */
const DUMP = `Activity Resolver Table:
  Schemes:
      appdyno-fixture:
        8f2c98 dev.appdyno.fixture/.MainActivity filter 798d0d6
          Action: "android.intent.action.VIEW"
          Category: "android.intent.category.BROWSABLE"
          Scheme: "appdyno-fixture"
          Authority: "open": -1
      https:
        8f2c98 dev.appdyno.fixture/.MainActivity filter 7364f57
          Action: "android.intent.action.VIEW"
          Scheme: "https"
          Authority: "example.com": -1
          Path: "PatternMatcher{PREFIX: /order}"
          AutoVerify=true

  Non-Data Actions:
      android.intent.action.MAIN:
        8f2c98 dev.appdyno.fixture/.MainActivity filter 21c7cf1
          Action: "android.intent.action.MAIN"
          Category: "android.intent.category.LAUNCHER"
`;
const STATES = `  dev.appdyno.fixture:
    ID: 2a6ff4a5-f275-4487-a084-96d48eadfe68
    Signatures: [D4:E2]
    Domain verification state:
      example.com: none
      shop.example.com: verified
`;

describe("an Android app's links", () => {
  it('are its filters that view a link, each once', () => {
    expect(linkFilters(DUMP)).toEqual([
      { url: 'appdyno-fixture://open', kind: 'filter' },
      { url: 'https://example.com/order*', kind: 'filter' },
    ]);
    expect(linkFilters(`${DUMP}${DUMP}`)).toHaveLength(2);
  });

  it('and its App Link domains, as verified', () => {
    expect(linkStates(STATES)).toEqual([
      { url: 'https://example.com', kind: 'domain', state: 'none' },
      { url: 'https://shop.example.com', kind: 'domain', state: 'verified' },
    ]);
    expect(linkStates('Unknown command: get-app-links')).toEqual([]);
  });
});

describe('the app a link opens in', () => {
  /** A device whose `resolve-activity` answers `said`; every command kept. */
  const resolving = (said: string) => {
    const asked: string[] = [];
    const adb = {
      exec: (_: string, c: string) => {
        asked.push(c);
        return Promise.resolve(said);
      },
    } as unknown as Adb;
    return { asked, apps: new AndroidApps(adb, 'emulator-5554', {} as never) };
  };

  it('is the app named, held there by -p, with nothing asked', async () => {
    const { apps, asked } = resolving('');
    expect(await apps.opener('https://example.org', 'dev.app')).toBe('dev.app');
    expect(asked).toEqual([]);
  });

  it("is the system's own pick with none named: an app, its chooser, or none", async () => {
    const pick = resolving(
      'priority=0 preferredOrder=0 match=0x208000 specificIndex=-1 isDefault=true\ncom.android.chrome/com.google.android.apps.chrome.IntentDispatcher\n',
    );
    expect(await pick.apps.opener("https://example.org/?q=a'b")).toBe('com.android.chrome');
    expect(pick.asked).toEqual([
      `cmd package resolve-activity --brief -a android.intent.action.VIEW -d 'https://example.org/?q=a'\\''b' 2>&1`,
    ]);
    expect(
      await resolving(
        'priority=0 preferredOrder=0 match=0x0 specificIndex=-1 isDefault=false\nandroid/com.android.internal.app.ResolverActivity\n',
      ).apps.opener('https://example.org'),
    ).toBe('android');
    expect(await resolving('No activity found\n').apps.opener('nothing://x')).toBeUndefined();
  });
});
