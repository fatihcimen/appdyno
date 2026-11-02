import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DeviceError } from '@appdyno/protocol';
import { BRAND_VERSION, brandRunner } from './brand.js';
import { xcodeEnv } from './simctl.js';
import { parsePlist, plistXml } from './usbmux.js';

const run = promisify(execFile);

/**
 * Where the phone's signing comes from: a development profile for the runner and an identity. Without a
 * keychain the search list is asked (the login keychain, unlocked in a session); a password is needed
 * only for a keychain that is locked.
 */
export type PhoneSigning = { profile: string; keychain?: string; keychainPassword?: string };

/** From APPDYNO_IOS_PROFILE (with APPDYNO_IOS_KEYCHAIN, APPDYNO_IOS_KEYCHAIN_PASSWORD); nothing if unset. */
export function phoneSigningFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PhoneSigning | undefined {
  const { APPDYNO_IOS_PROFILE: profile, APPDYNO_IOS_KEYCHAIN: keychain } = env;
  const keychainPassword = env.APPDYNO_IOS_KEYCHAIN_PASSWORD;
  if (!profile) return undefined;
  return { profile, ...(keychain && { keychain }), ...(keychainPassword && { keychainPassword }) };
}

export type Profile = {
  team: string;
  appId: string;
  certSha1: string[];
  devices: string[];
  expires?: string;
};

/** The runner's id under a profile: a wildcard's own, or the profile's id for a UI test runner. */
export function runnerAppId(appId: string): string {
  if (appId === '*') return 'dev.appdyno.Runner.xctrunner';
  if (appId.endsWith('.*')) return `${appId.slice(0, -1)}appdynoRunner.xctrunner`;
  if (appId.endsWith('.xctrunner')) return appId;
  throw new DeviceError(
    'INVALID_ARGUMENT',
    `the profile is for ${appId}, not a UI test runner (*.xctrunner) or a wildcard`,
  );
}

/** The development identities a `security find-identity` listing names, by certificate hash. */
export function developmentIdentities(listing: string): Set<string> {
  return new Set(
    [...listing.matchAll(/\b([0-9A-F]{40}) "(?:Apple Development|iPhone Developer):/g)].map(
      (m) => m[1]!,
    ),
  );
}

/**
 * The profile that signs the runner for a phone: it names the phone, has not expired and a development
 * identity at hand has one of its certificates. Found by itself only under a wildcard or an id of ours:
 * a profile for another app's runner would put ours over theirs on the phone (name it with
 * APPDYNO_IOS_PROFILE if that is meant). The broadest wildcard first, then the latest expiry, then the
 * path, so the same machine always chooses the same profile.
 */
export function chooseProfile<P extends Profile & { path: string }>(
  profiles: P[],
  udid: string,
  identities: Set<string>,
  now = Date.now(),
): P | undefined {
  const breadth = (id: string) => (id === '*' ? 2 : id.endsWith('.*') ? 1 : 0);
  return profiles
    .filter(
      (p) =>
        p.devices.includes(udid) &&
        (p.expires === undefined || Date.parse(p.expires) > now) &&
        p.certSha1.some((h) => identities.has(h)) &&
        (breadth(p.appId) > 0 || p.appId.startsWith('dev.appdyno.')),
    )
    .sort(
      (a, b) =>
        breadth(b.appId) - breadth(a.appId) ||
        Date.parse(b.expires ?? '') - Date.parse(a.expires ?? '') ||
        a.path.localeCompare(b.path),
    )[0];
}

const PROFILE_DIRS = [
  'Library/Developer/Xcode/UserData/Provisioning Profiles',
  'Library/MobileDevice/Provisioning Profiles',
];

/** Identities of a keychain (no keychain: the search list). */
const listIdentities = async (keychain?: string) =>
  (
    await run('security', [
      'find-identity',
      '-v',
      '-p',
      'codesigning',
      ...(keychain ? [keychain] : []),
    ])
  ).stdout;

/**
 * The phone's signing, by itself: APPDYNO_IOS_PROFILE when set, else the profile `chooseProfile` finds
 * among the installed ones. Else, with a team named (APPDYNO_IOS_TEAM: never guessed, a Mac can hold
 * several), Xcode is asked once to provision the runner's id from its account.
 */
export async function findPhoneSigning(
  udid: string,
  env: NodeJS.ProcessEnv = process.env,
  provision: (team: string) => Promise<void> = xcodeProvision,
): Promise<PhoneSigning> {
  const explicit = phoneSigningFromEnv(env);
  if (explicit) return explicit;
  const find = async () => {
    const files = PROFILE_DIRS.flatMap((d) => {
      const dir = join(homedir(), d);
      return existsSync(dir)
        ? readdirSync(dir)
            .filter((f) => f.endsWith('.mobileprovision'))
            .map((f) => join(dir, f))
        : [];
    });
    const profiles = await Promise.all(
      files.map((path) =>
        readProfile(path).then(
          (p) => ({ ...p, path }),
          () => undefined,
        ),
      ),
    );
    return chooseProfile(
      profiles.filter((p) => p !== undefined),
      udid,
      developmentIdentities(await listIdentities()),
    );
  };
  let found = await find();
  if (!found && env.APPDYNO_IOS_TEAM) {
    await provision(env.APPDYNO_IOS_TEAM);
    found = await find();
  }
  if (!found)
    throw new DeviceError(
      'UNSUPPORTED',
      `no signing for the iPhone runner: no wildcard development profile names ${udid} with an identity in the keychain`,
      "install one from Xcode (Settings, Accounts; a team's wildcard profile), or set APPDYNO_IOS_PROFILE, or APPDYNO_IOS_TEAM to let Xcode provision the runner",
    );
  return { profile: found.path };
}

/** Xcode provisions the runner's own id from its account (it stores the profile with the others). */
async function xcodeProvision(team: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  const packaged = join(here, '../agents/ios-src/Appdyno.xcodeproj');
  await run(
    'xcodebuild',
    [
      'build-for-testing',
      '-project',
      existsSync(packaged) ? packaged : join(here, '../../../ios/Appdyno.xcodeproj'),
      '-scheme',
      'Runner',
      '-destination',
      'generic/platform=iOS',
      '-derivedDataPath',
      join(homedir(), 'Library/Caches/appdyno/ios-provision'),
      '-allowProvisioningUpdates',
      '-allowProvisioningDeviceRegistration',
      `DEVELOPMENT_TEAM=${team}`,
      'CODE_SIGN_STYLE=Automatic',
      'PRODUCT_BUNDLE_IDENTIFIER=dev.appdyno.Runner',
      '-quiet',
    ],
    { env: xcodeEnv(), timeout: 1_800_000, maxBuffer: 64 * 1024 * 1024 },
  );
}

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
export const stampOf = (key: string) => `appdyno-${key.slice(0, 12)}`;

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
  const appId = runnerAppId(profile.appId);
  const ids = await listIdentities(signing.keychain);
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
  if (existsSync(join(dir, '.ok'))) return { app, appId, stamp, key };

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
    appId,
    join(tmpApp, 'Info.plist'),
  ]);
  await plutil(['-replace', 'CFBundleVersion', '-string', stamp, join(tmpApp, 'Info.plist')]);
  await plutil([
    '-replace',
    'CFBundleIdentifier',
    '-string',
    appId.replace(/\.xctrunner$/, ''),
    join(xctest, 'Info.plist'),
  ]);
  await cp(signing.profile, join(tmpApp, 'embedded.mobileprovision'));
  // the home screen shows it as appdyno, with its icon
  await brandRunner(tmpApp);
  for (const d of [tmpApp, xctest])
    await rm(join(d, '_CodeSignature'), { recursive: true, force: true });
  const entitlements = join(tmp, 'entitlements.plist');
  await writeFile(entitlements, runnerEntitlements(profile.team, appId));
  // the only keychain operation: unlocking a named one for codesign (its content is never changed)
  if (signing.keychain && signing.keychainPassword)
    await run('security', ['unlock-keychain', '-p', signing.keychainPassword, signing.keychain]);
  const sign = (path: string, extra: string[] = []) =>
    run(
      'codesign',
      [
        '--force',
        '--sign',
        identity,
        ...(signing.keychain ? ['--keychain', signing.keychain] : []),
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
  return { app, appId, stamp, key };
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
