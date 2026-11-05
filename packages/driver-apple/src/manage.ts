import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';

/** What an iOS app owns in its container; the rest there is the system's. */
export const DATA_FOLDERS = ['Documents', 'Library', 'tmp'];

/** The platforms an app was built for, as its bundle says: `iPhoneOS`, `iPhoneSimulator`. */
async function platformsOf(app: string) {
  const { stdout } = await run('plutil', [
    '-extract',
    'CFBundleSupportedPlatforms',
    'json',
    '-o',
    '-',
    join(app, 'Info.plist'),
  ]);
  return JSON.parse(stdout) as string[];
}

/**
 * Installs an `.app`, or the one an `.ipa` holds under `Payload`, where it goes in as any other. What this kind of
 * device cannot run is refused before it is tried, as the tools' own words say nothing of why.
 */
export async function installingApp(
  path: string,
  platform: 'iPhoneOS' | 'iPhoneSimulator',
  install: (app: string) => Promise<unknown>,
) {
  if (!/\.(app|ipa)$/.test(path) || !existsSync(path))
    throw new DeviceError('INVALID_ARGUMENT', `not a local .app bundle or .ipa: ${path}`);
  const dir = path.endsWith('.ipa') ? mkdtempSync(join(tmpdir(), 'appdyno-ipa-')) : undefined;
  try {
    let app = path;
    if (dir) {
      await run('unzip', ['-q', path, 'Payload/*', '-d', dir]);
      const found = readdirSync(join(dir, 'Payload')).find((f) => f.endsWith('.app'));
      if (!found) throw new DeviceError('INVALID_ARGUMENT', `no app in Payload of ${path}`);
      app = join(dir, 'Payload', found);
    }
    const built = await platformsOf(app);
    if (!built.includes(platform))
      throw new DeviceError(
        'UNSUPPORTED',
        `${path} is built for ${built.join(', ')}, not for ${platform}`,
        platform === 'iPhoneOS'
          ? 'install a build for a device, signed for this phone'
          : 'install a build for a simulator',
      );
    await install(app);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** A language for one launch, in the arguments the system reads for it. */
export const languageArgs = (language: string | undefined) =>
  language ? ['-AppleLanguages', `(${language})`, '-AppleLocale', language.replace('-', '_')] : [];

export const on = (v: string, yes: string, no: string) => ({ on: yes, off: no })[v] ?? v;
