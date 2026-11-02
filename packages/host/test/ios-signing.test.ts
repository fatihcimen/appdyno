import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseProfile,
  phoneSigningFromEnv,
  phoneXctestrun,
  runnerEntitlements,
  stampOf,
} from '../src/ios/signing.js';
import { parsePlist, plistXml } from '../src/ios/usbmux.js';

describe('iPhone runner signing', () => {
  it('reads a profile: team, app id without the team, certificate hashes, devices', () => {
    const der = Buffer.from('a certificate');
    const xml = plistXml({
      TeamIdentifier: ['TEAM123'],
      Entitlements: { 'application-identifier': 'TEAM123.com.example.UITests.xctrunner' },
      DeveloperCertificates: [der.toString('base64')],
      ProvisionedDevices: ['00001234-0123456789ABCDEF'],
    });
    expect(parseProfile(xml)).toEqual({
      team: 'TEAM123',
      appId: 'com.example.UITests.xctrunner',
      certSha1: [createHash('sha1').update(der).digest('hex').toUpperCase()],
      devices: ['00001234-0123456789ABCDEF'],
    });
  });

  it('writes minimal entitlements and an xctestrun with the runner as its own target', () => {
    const e = parsePlist(runnerEntitlements('T', 'a.b.xctrunner')) as Record<string, unknown>;
    expect(e['application-identifier']).toBe('T.a.b.xctrunner');
    expect(e['keychain-access-groups']).toEqual(['T.a.b.xctrunner']);
    const x = parsePlist(phoneXctestrun('/x/R.app', 'a.b.xctrunner')) as Record<
      string,
      Record<string, unknown>
    >;
    expect(x.Runner!.UITargetAppPath).toBe('/x/R.app');
    expect(x.Runner!.SystemAttachmentLifetime).toBe('keepNever');
    expect(stampOf('abcdef0123456789')).toBe('appdyno-abcdef012345');
  });

  it('says what to set when signing is not configured', () => {
    expect(() => phoneSigningFromEnv({ APPDYNO_IOS_PROFILE: '/p' })).toThrow(
      /no signing for the iPhone runner/,
    );
    expect(
      phoneSigningFromEnv({
        APPDYNO_IOS_PROFILE: '/p',
        APPDYNO_IOS_KEYCHAIN: '/k',
        APPDYNO_IOS_KEYCHAIN_PASSWORD: 'x',
      }),
    ).toEqual({
      profile: '/p',
      keychain: '/k',
      keychainPassword: 'x',
    });
  });
});
