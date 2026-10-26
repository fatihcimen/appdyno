import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DeviceError } from '@appdyno/protocol';
import { BRAND_VERSION, brandRunner } from './brand.js';
import { parsePlist, plistXml } from './usbmux.js';

const run = promisify(execFile);

/** Where the phone's signing comes from: a development profile for the runner and a keychain holding its identity. */
export type PhoneSigning = { profile: string; keychain: string; keychainPassword: string };

/** From APPDYNO_IOS_PROFILE, APPDYNO_IOS_KEYCHAIN, APPDYNO_IOS_KEYCHAIN_PASSWORD. */
export function phoneSigningFromEnv(env: NodeJS.ProcessEnv = process.env): PhoneSigning {
  const profile = env.APPDYNO_IOS_PROFILE;
  const keychain = env.APPDYNO_IOS_KEYCHAIN;
  const keychainPassword = env.APPDYNO_IOS_KEYCHAIN_PASSWORD;
  if (!profile || !keychain || !keychainPassword)
    throw new DeviceError(
      'UNSUPPORTED',
      'no signing for the iPhone runner',
      'set APPDYNO_IOS_PROFILE (a development profile for the runner), APPDYNO_IOS_KEYCHAIN and APPDYNO_IOS_KEYCHAIN_PASSWORD',
    );
  return { profile, keychain, keychainPassword };
}

export type Profile = {
  team: string;
  appId: string;
  certSha1: string[];
  devices: string[];
  expires?: string;
};

export function parseProfile(xml: string): Profile {
  const p = parsePlist(xml) as Record<string, unknown>;
  const ent = (p.Entitlements ?? {}) as Record<string, unknown>;
  const team = String((p.TeamIdentifier as string[] | undefined)?.[0] ?? '');
  const full = String(ent['application-identifier'] ?? '');
  return {
    team,
    appId: full.startsWith(`${team}.`) ? full.slice(team.length + 1) : full,
    certSha1: ((p.DeveloperCertificates as string[] | undefined) ?? []).map((b64) =>
      createHash('sha1').update(Buffer.from(b64, 'base64')).digest('hex').toUpperCase(),
    ),
    devices: ((p.ProvisionedDevices as string[] | undefined) ?? []).map(String),
    ...(p.ExpirationDate !== undefined && { expires: String(p.ExpirationDate) }),
  };
}

export async function readProfile(path: string): Promise<Profile> {
  const { stdout } = await run('security', ['cms', '-D', '-i', path]);
  return parseProfile(stdout);
}

/** The runner's entitlements: the minimum a development-signed UI test runner needs. */
export function runnerEntitlements(team: string, appId: string): string {
  const id = `${team}.${appId}`;
  return plistXml({
    'application-identifier': id,
    'com.apple.developer.team-identifier': team,
    'get-task-allow': true,
    'keychain-access-groups': [id],
  });
}

/** The stamp in CFBundleVersion: tells our build apart from any other runner with the same id. */
export const stampOf = (key: string) => `gd-${key.slice(0, 12)}`;

/**
 * The runner, re-signed for the phone: its bundle ids become the profile's (the test bundle's is the
 * runner's without ".xctrunner"), the profile is embedded, every bundle is signed inside out with the
 * profile's identity from the keychain. Cached per runner build, profile and identity.
 */
export async function signedRunner(
  builtApp: string,
  signing: PhoneSigning,
  cacheDir: string,
): Promise<{ app: string; appId: string; stamp: string; key: string }> {
  const profile = await readProfile(signing.profile);
  if (!profile.appId.endsWith('.xctrunner'))
    throw new DeviceError(
      'INVALID_ARGUMENT',
      `the profile is for ${profile.appId}, not a UI test runner (*.xctrunner)`,
    );
  const ids = (
    await run('security', ['find-identity', '-v', '-p', 'codesigning', signing.keychain])
  ).stdout;
  const identity = profile.certSha1.find((h) => ids.includes(h));
  if (!identity)
    throw new DeviceError(
      'UNSUPPORTED',
      `the keychain has no identity of the profile's certificates`,
    );
  const binary = join(builtApp, 'PlugIns/Runner.xctest/Runner');
  const key = createHash('sha256')
    .update(await readFile(binary))
    .update(await readFile(signing.profile))
    .update(identity)
    .update(`brand ${BRAND_VERSION}`)
    .digest('hex');
  const stamp = stampOf(key);
  const dir = join(cacheDir, key.slice(0, 16));
  const app = join(dir, 'Runner-Runner.app');
  if (existsSync(join(dir, '.ok'))) return { app, appId: profile.appId, stamp, key };

  const tmp = `${dir}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const tmpApp = join(tmp, 'Runner-Runner.app');
  await cp(builtApp, tmpApp, { recursive: true, verbatimSymlinks: true });
  const xctest = join(tmpApp, 'PlugIns/Runner.xctest');
  const plutil = (args: string[]) => run('plutil', args);
  await plutil([
    '-replace',
    'CFBundleIdentifier',
    '-string',
    profile.appId,
    join(tmpApp, 'Info.plist'),
  ]);
  await plutil(['-replace', 'CFBundleVersion', '-string', stamp, join(tmpApp, 'Info.plist')]);
  await plutil([
    '-replace',
    'CFBundleIdentifier',
    '-string',
    profile.appId.replace(/\.xctrunner$/, ''),
    join(xctest, 'Info.plist'),
  ]);
  await cp(signing.profile, join(tmpApp, 'embedded.mobileprovision'));
  // the home screen shows it as appdyno, with its icon
  await brandRunner(tmpApp);
  for (const d of [tmpApp, xctest])
    await rm(join(d, '_CodeSignature'), { recursive: true, force: true });
  const entitlements = join(tmp, 'entitlements.plist');
  await writeFile(entitlements, runnerEntitlements(profile.team, profile.appId));
  // the only keychain operation: unlocking it for codesign (its content is never changed)
  await run('security', ['unlock-keychain', '-p', signing.keychainPassword, signing.keychain]);
  const sign = (path: string, extra: string[] = []) =>
    run(
      'codesign',
      [
        '--force',
        '--sign',
        identity,
        '--keychain',
        signing.keychain,
        '--timestamp=none',
        ...extra,
        path,
      ],
      {
        timeout: 120_000,
      },
    );
  const inside = async (d: string) =>
    (await readdir(d).catch(() => [] as string[])).map((f) => join(d, f));
  for (const f of [
    ...(await inside(join(tmpApp, 'Frameworks'))),
    ...(await inside(join(xctest, 'Frameworks'))),
  ])
    await sign(f);
  await sign(xctest);
  await sign(tmpApp, ['--entitlements', entitlements]);
  await writeFile(join(tmp, '.ok'), key);
  await rm(dir, { recursive: true, force: true });
  await rename(tmp, dir);
  return { app, appId: profile.appId, stamp, key };
}

/** xcodebuild's input for the phone: the runner hosts the test bundle and is its own target app. */
export function phoneXctestrun(app: string, appId: string): string {
  return plistXml({
    Runner: {
      TestHostPath: app,
      TestBundlePath: '__TESTHOST__/PlugIns/Runner.xctest',
      UITargetAppPath: app,
      UITargetAppBundleIdentifier: appId,
      IsUITestBundle: true,
      IsXCTRunnerHostedTestBundle: true,
      IsAppHostedTestBundle: false,
      SystemAttachmentLifetime: 'keepNever',
      UserAttachmentLifetime: 'keepNever',
      TestingEnvironmentVariables: {},
      EnvironmentVariables: {},
      CommandLineArguments: [],
    },
    __xctestrun_metadata__: { FormatVersion: 1 },
  });
}
