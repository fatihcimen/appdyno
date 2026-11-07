import { join } from 'node:path';
import { run, type AppLink } from '@appdyno/core';
import type { Simctl } from './simctl.js';

const DOMAINS = 'com.apple.developer.associated-domains';

/** The schemes of an app's Info.plist, as `plutil` gives its URL types. */
export const schemesOf = (urlTypes: unknown) =>
  (Array.isArray(urlTypes) ? urlTypes : []).flatMap((t: { CFBundleURLSchemes?: unknown }) =>
    Array.isArray(t.CFBundleURLSchemes) ? t.CFBundleURLSchemes.map(String) : [],
  );

/**
 * The domains a signature's entitlements, as `codesign --xml` gives them, name for universal links (`applinks:`), with
 * no mode: an associated domain for another service opens no link.
 */
export function domainsOf(xml: string) {
  const list = new RegExp(`<key>${DOMAINS}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(xml)?.[1];
  return [...(list ?? '').matchAll(/<string>applinks:([^<?]+)[^<]*<\/string>/g)].map((m) => m[1]!);
}

/** A key of an app's Info.plist: an array or a dictionary as JSON, `raw` a string; nothing where it has none. */
export const infoValue = (bundle: string, key: string, as: 'json' | 'raw' = 'json') =>
  run('plutil', ['-extract', key, as, '-o', '-', join(bundle, 'Info.plist')]).then(
    (r): unknown => (as === 'raw' ? r.stdout.trim() : JSON.parse(r.stdout)),
    () => undefined,
  );

/** What an app installed on a simulator says it opens: its URL schemes, and the domains its signature names. */
export async function simulatorLinks(
  simctl: Simctl,
  udid: string,
  app: string,
): Promise<AppLink[]> {
  const bundle = await simctl.appContainer(udid, app);
  const types = await infoValue(bundle, 'CFBundleURLTypes');
  const signed = await run('codesign', ['-d', '--entitlements', '-', '--xml', bundle]).then(
    (r) => r.stdout,
    () => '',
  );
  return [
    ...schemesOf(types).map((s) => ({ url: `${s}://`, kind: 'scheme' as const })),
    ...domainsOf(signed).map((d) => ({ url: `https://${d}`, kind: 'domain' as const })),
  ];
}
