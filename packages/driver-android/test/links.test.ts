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

  it('name a wildcard host with its *, and each kind of path as it matches', () => {
    // Wikipedia's and AntennaPod's on an API 35 emulator, LeakCanary's as its manifest has it, and the kinds none has
    const dump = String.raw`Activity Resolver Table:
  Schemes:
      file:
        3ab7e10 org.wikipedia.alpha/leakcanary.internal.activity.LeakViewerActivity filter 61f0c9d
          Action: "android.intent.action.VIEW"
          Category: "android.intent.category.BROWSABLE"
          Scheme: "file"
          Authority: "": -1 WILD
          Path: "PatternMatcher{GLOB: .*\.hprof}"
      https:
        5c1d2a0 org.wikipedia.alpha/org.wikipedia.page.PageActivity filter 9e1b4c2
          Action: "android.intent.action.VIEW"
          Category: "android.intent.category.BROWSABLE"
          Scheme: "https"
          Authority: ".wikipedia.org": -1 WILD
          Path: "PatternMatcher{PREFIX: /wiki/}"
          Path: "PatternMatcher{GLOB: /zh.*}"
        adda57d de.danoeh.antennapod.debug/.OnlineFeedViewActivity filter b241c79
          Action: "android.intent.action.VIEW"
          Scheme: "https"
          Authority: "www.subscribeonandroid.com": -1
          Path: "PatternMatcher{GLOB: /.*\..*/.*}"
          AutoVerify=true
        8f2c98 dev.appdyno.fixture/.MainActivity filter 41d0a7e
          Action: "android.intent.action.VIEW"
          Scheme: "https"
          Authority: "example.com": -1
          Path: "PatternMatcher{LITERAL: /about}"
          Path: "PatternMatcher{GLOB: /report.pdf}"
          Path: "PatternMatcher{ADVANCED: /v[0-9]{1,2}/.*}"
          Path: "PatternMatcher{SUFFIX: /feed}"
          Path: "PatternMatcher{PREFIX: /shop/*}"
`;
    expect(linkFilters(dump).map((l) => l.url)).toEqual([
      String.raw`file://*.*\.hprof`,
      'https://*.wikipedia.org/wiki/*',
      'https://*.wikipedia.org/zh.*',
      String.raw`https://www.subscribeonandroid.com/.*\..*/.*`,
      'https://example.com/about',
      'https://example.com/report.pdf',
      'https://example.com/v[0-9]{1,2}/.*',
      'https://example.com*/feed',
      'https://example.com/shop/*',
    ]);
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
