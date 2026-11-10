import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { domainsOf, opens, schemesOf } from '../src/sim-links.js';
import { Simctl } from '../src/simctl.js';

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

  it('take a link by its scheme, or an https link by its domain, a wildcard any under it', () => {
    const scheme = { url: 'demo://', kind: 'scheme' } as const;
    const domain = { url: 'https://example.com', kind: 'domain' } as const;
    const any = { url: 'https://*.example.com', kind: 'domain' } as const;
    for (const url of ['demo://x', 'DEMO:x', 'demo:']) expect(opens(scheme, url), url).toBe(true);
    for (const url of ['demo2://x', 'https://demo.example'])
      expect(opens(scheme, url), url).toBe(false);
    expect(opens(domain, 'https://example.com/order/1')).toBe(true);
    for (const url of [
      'http://example.com/x',
      'https://example.com.evil.test/',
      'https://evil.test/?u=https://example.com',
      'https://example.com@evil.test/',
    ])
      expect(opens(domain, url), url).toBe(false);
    expect(opens(any, 'https://shop.example.com/x')).toBe(true);
    expect(opens(any, 'https://notexample.com/x')).toBe(false);
  });
});

describe("an app's folder on a simulator", () => {
  it('is asked once while it stands, and again once a reinstall has moved it', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'appdyno-container-'));
    const asked: string[][] = [];
    const simctl = Object.assign(new Simctl({}), {
      exec: (args: string[]) => Promise.resolve((asked.push(args), `${folder}\n`)),
    });
    const udid = '7994F239-7CD7-4247-9FC0-4F92C7CFC951';
    expect(await simctl.appContainer(udid, 'dev.app')).toBe(folder);
    await simctl.appContainer(udid, 'dev.app');
    rmSync(folder, { recursive: true, force: true });
    await simctl.appContainer(udid, 'dev.app');
    expect(asked.length).toBe(2);
  });
});
