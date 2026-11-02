import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  chooseProfile,
  developmentIdentities,
  findPhoneSigning,
  parseProfile,
  phoneSigningFromEnv,
  phoneXctestrun,
  runnerAppId,
  runnerEntitlements,
  stampOf,
} from '../src/signing.js';
import { parsePlist, plistXml } from '../src/usbmux.js';

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

  it('takes signing from the environment when the profile is named; the keychain stays optional', () => {
    expect(phoneSigningFromEnv({})).toBeUndefined();
    expect(phoneSigningFromEnv({ APPDYNO_IOS_PROFILE: '/p' })).toEqual({ profile: '/p' });
    expect(
      phoneSigningFromEnv({
        APPDYNO_IOS_PROFILE: '/p',
        APPDYNO_IOS_KEYCHAIN: '/k',
        APPDYNO_IOS_KEYCHAIN_PASSWORD: 'x',
      }),
    ).toEqual({ profile: '/p', keychain: '/k', keychainPassword: 'x' });
  });

  it('names the runner under a wildcard and refuses another kind of profile', () => {
    expect(runnerAppId('*')).toBe('dev.appdyno.Runner.xctrunner');
    expect(runnerAppId('com.acme.*')).toBe('com.acme.appdynoRunner.xctrunner');
    expect(runnerAppId('a.b.xctrunner')).toBe('a.b.xctrunner');
    expect(() => runnerAppId('com.acme.app')).toThrow(/not a UI test runner/);
  });

  it('reads development identities only', () => {
    const ids = developmentIdentities(
      [
        '  1) 0FC83906708015C3A6C945013BA3ED9D86009B9F "Apple Distribution: ACME (AAAAAAAAAA)"',
        '  2) 80B0230F16A62BFA7309F044D5CD55C9576599A1 "Apple Development: Someone (L76UPCP4PE)"',
      ].join('\n'),
    );
    expect([...ids]).toEqual(['80B0230F16A62BFA7309F044D5CD55C9576599A1']);
  });

  describe('chooses the profile by itself', () => {
    const udid = '00001234-0123456789ABCDEF';
    const now = Date.parse('2026-11-02T00:00:00Z');
    const profile = (o: {
      path: string;
      appId: string;
      cert?: string;
      expires?: string;
      devices?: string[];
    }) => ({
      team: o.path.toUpperCase(),
      certSha1: [o.cert ?? 'MINE'],
      devices: o.devices ?? [udid],
      expires: o.expires ?? '2027-10-19T00:00:00Z',
      path: o.path,
      appId: o.appId,
    });
    const mine = new Set(['MINE']);

    it("never another app's runner, even with the identity at hand", () => {
      const company = profile({ path: 'company', appId: 'com.acme.app.UITests.xctrunner' });
      const team = profile({ path: 'personal', appId: '*' });
      expect(chooseProfile([company, team], udid, mine, now)?.path).toBe('personal');
      expect(chooseProfile([company], udid, mine, now)).toBeUndefined();
    });

    it('needs the phone, an identity and a profile still valid', () => {
      const p = { path: 'p', appId: '*' };
      expect(
        chooseProfile([profile({ ...p, devices: ['other'] })], udid, mine, now),
      ).toBeUndefined();
      expect(chooseProfile([profile({ ...p, cert: 'THEIRS' })], udid, mine, now)).toBeUndefined();
      expect(
        chooseProfile([profile({ ...p, expires: '2026-01-01T00:00:00Z' })], udid, mine, now),
      ).toBeUndefined();
    });

    it('is the same every time: broadest wildcard, latest expiry, then the path', () => {
      const a = profile({ path: 'a', appId: 'com.acme.*', expires: '2030-01-01T00:00:00Z' });
      const b = profile({ path: 'b', appId: '*', expires: '2027-01-01T00:00:00Z' });
      const c = profile({ path: 'c', appId: '*', expires: '2028-01-01T00:00:00Z' });
      const d = profile({ path: 'd', appId: '*', expires: '2028-01-01T00:00:00Z' });
      expect(chooseProfile([a, b, d, c], udid, mine, now)?.path).toBe('c');
    });
  });

  it('asks Xcode to provision only with a team named', async () => {
    const provision = vi.fn(async () => undefined);
    await findPhoneSigning('no-such-phone', {}, provision).catch(() => undefined);
    expect(provision).not.toHaveBeenCalled();
    await expect(
      findPhoneSigning('no-such-phone', { APPDYNO_IOS_TEAM: 'TEAM' }, provision),
    ).rejects.toThrow(/no signing for the iPhone runner/);
    expect(provision).toHaveBeenCalledWith('TEAM');
  });
});
