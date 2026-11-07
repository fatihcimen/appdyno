import { join } from 'node:path';
import { run } from '@appdyno/core';
import { assertBundle, type Simctl } from './simctl.js';

const DOMAINS = 'com.apple.developer.associated-domains';

/** The schemes of an app's Info.plist, as `plutil` gives its URL types. */
export const schemesOf = (urlTypes: unknown) =>
  (Array.isArray(urlTypes) ? urlTypes : []).flatMap((t: { CFBundleURLSchemes?: unknown }) =>
    Array.isArray(t.CFBundleURLSchemes) ? t.CFBundleURLSchemes.map(String) : [],
  );

/** The associated domains of a signature's entitlements, as `codesign --xml` gives them. */
export function domainsOf(xml: string) {
  const list = new RegExp(`<key>${DOMAINS}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(xml)?.[1];
  return [...(list ?? '').matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]!);
}

/** What an app installed on a simulator says it opens: its URL schemes, and the domains its signature names. */
export async function simulatorLinks(simctl: Simctl, udid: string, app: string) {
  const bundle = (await simctl.exec(['get_app_container', udid, assertBundle(app)])).trim();
  const types = await run('plutil', [
    '-extract',
    'CFBundleURLTypes',
    'json',
    '-o',
    '-',
    join(bundle, 'Info.plist'),
  ]).then(
    (r) => JSON.parse(r.stdout) as unknown,
    () => [],
  );
  const signed = await run('codesign', ['-d', '--entitlements', '-', '--xml', bundle]).then(
    (r) => r.stdout,
    () => '',
  );
  return [
    ...schemesOf(types).map((s) => `scheme ${s}://`),
    ...domainsOf(signed).map((d) => `domain ${d}`),
  ];
}
