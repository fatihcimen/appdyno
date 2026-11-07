import { describe, expect, it } from 'vitest';
import { domainsOf, schemesOf } from '../src/sim-links.js';

/** The associated domains of a signature, as `codesign -d --entitlements - --xml` gives them, cut to that key. */
const SIGNED = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>com.apple.developer.associated-domains</key><array>
<string>applinks:example.com</string><string>webcredentials:example.com</string>
<string>applinks:shop.example.com?mode=developer</string></array></dict></plist>`;

describe("a simulator app's links", () => {
  it('are the schemes of its URL types', () => {
    expect(
      schemesOf([{ CFBundleURLSchemes: ['demo', 'demo2'] }, { CFBundleURLName: 'x' }]),
    ).toEqual(['demo', 'demo2']);
    expect(schemesOf(undefined)).toEqual([]);
  });

  it("and the domains it opens universal links of, without another service's or a mode", () => {
    expect(domainsOf(SIGNED)).toEqual(['example.com', 'shop.example.com']);
    expect(domainsOf('<plist/>')).toEqual([]);
  });
});
