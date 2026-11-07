import { describe, expect, it } from 'vitest';
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
      'filter appdyno-fixture://open',
      'filter https://example.com/order*',
    ]);
    expect(linkFilters(`${DUMP}${DUMP}`)).toHaveLength(2);
  });

  it('and its App Link domains, as verified', () => {
    expect(linkStates(STATES)).toEqual([
      'app link example.com: none',
      'app link shop.example.com: verified',
    ]);
    expect(linkStates('Unknown command: get-app-links')).toEqual([]);
  });
});
