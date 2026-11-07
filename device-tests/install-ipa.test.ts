import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appleProvider } from './workspace.js';
import { type Answer, IPHONE, IPHONE_FIXTURE, onIphone, opsOn, SIM_FIXTURE } from './helpers.js';

/** The fixture as an `.ipa`, on the simulator APPDYNO_IOS_UDID names and an iPhone, and each refusing the other's. */
const APP = 'dev.appdyno.fixture';
const SIMULATOR = process.env.APPDYNO_IOS_UDID;

const ok = <A extends Answer>(r: A) => {
  expect(r.error ? r.text : '').toBe('');
  return r;
};

const ipa = (platform?: string, from = SIM_FIXTURE) => {
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-ipa-make-'));
  mkdirSync(join(dir, 'Payload'));
  const app = join(dir, 'Payload/Fixture.app');
  cpSync(from, app, { recursive: true });
  if (platform)
    execFileSync('plutil', [
      '-replace',
      'CFBundleSupportedPlatforms',
      '-json',
      `["${platform}"]`,
      join(app, 'Info.plist'),
    ]);
  execFileSync('zip', ['-qry', 'app.ipa', 'Payload'], { cwd: dir });
  return join(dir, 'app.ipa');
};

describe.skipIf(!SIMULATOR)('an .ipa on a simulator', () => {
  const { call } = opsOn(appleProvider(), SIMULATOR!, APP);

  it('installs what is built for a simulator', async () => {
    ok(await call('app', { action: 'uninstall' }));
    expect(ok(await call('app', { action: 'state' })).data.state).toBe('not_installed');
    ok(await call('app', { action: 'install', path: ipa() }));
    expect(ok(await call('app', { action: 'state' })).data.state).not.toBe('not_installed');
  }, 120_000);

  it('refuses what is built for a phone, and says so', async () => {
    const r = await call('app', { action: 'install', path: ipa('iPhoneOS') });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain('is built for iPhoneOS');
  }, 60_000);
});

describe.skipIf(!IPHONE)('an .ipa on an iPhone', () => {
  it('installs what is signed for it, and refuses a simulator build', async () => {
    const { call, ctx } = await onIphone(APP);
    ok(await call('app', { action: 'install', path: ipa(undefined, IPHONE_FIXTURE) }));
    expect(ok(await call('app', { action: 'state' })).data.state).not.toBe('not_installed');
    const r = await call('app', {
      action: 'install',
      path: ipa('iPhoneSimulator', IPHONE_FIXTURE),
    });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain('is built for iPhoneSimulator');
    ctx.close();
  }, 180_000);
});
