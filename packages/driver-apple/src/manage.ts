import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deviceState, run } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';

/** What an iOS app owns in its container; the rest there is the system's. */
export const DATA_FOLDERS = ['Documents', 'Library', 'tmp'];

/** A key of an app's Info.plist, as plutil writes it: `json`, or `raw` for a string. */
const plistKey = async (app: string, key: string, as: 'json' | 'raw') =>
  (await run('plutil', ['-extract', key, as, '-o', '-', join(app, 'Info.plist')])).stdout;

/** The platforms an app was built for, as its bundle says: `iPhoneOS`, `iPhoneSimulator`. */
const platformsOf = async (app: string) =>
  JSON.parse(await plistKey(app, 'CFBundleSupportedPlatforms', 'json')) as string[];

/**
 * Installs an `.app`, or the one an `.ipa` holds under `Payload`, where it goes in as any other. What this kind of
 * device cannot run is refused before it is tried, as the tools' own words say nothing of why.
 */
export async function installingApp(
  path: string,
  platform: 'iPhoneOS' | 'iPhoneSimulator',
  install: (app: string) => Promise<unknown>,
  allowed?: (app: string) => void,
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
    if (allowed) allowed((await plistKey(app, 'CFBundleIdentifier', 'raw')).trim());
    await install(app);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** A language for one launch, in the arguments the system reads for it. */
export const languageArgs = (language: string | undefined) =>
  language ? ['-AppleLanguages', `(${language})`, '-AppleLocale', language.replace('-', '_')] : [];

/** The language each app is launched in by this tool, kept on this Mac: nothing on the device holds one for an app. */
const appLanguages = deviceState('app-languages', z.record(z.string(), z.string()));
const LANGUAGE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;

/** The arguments of every launch this tool makes: its own language, else the one the app is held in. */
export const launchLanguage = (device: string, app: string, language?: string) =>
  languageArgs(language ?? appLanguages.read(device)?.[app]);

/**
 * An app held in a language for every launch this tool makes, or let go with ''; one that runs starts again in it.
 * What the answer says of where it holds.
 */
export async function holdAppLanguage(
  device: string,
  app: string,
  language: string,
  restart: () => Promise<void>,
) {
  if (language && !LANGUAGE.test(language))
    throw new DeviceError('INVALID_ARGUMENT', `locale: a language such as tr-TR, not ${language}`);
  appLanguages.update(device, (now = {}) => {
    const { [app]: _, ...rest } = now;
    const next = language ? { ...rest, [app]: language.replace('_', '-') } : rest;
    return Object.keys(next).length > 0 ? next : undefined;
  });
  await restart().catch((e: unknown) => {
    const held = language ? `held in ${language}` : 'let go';
    throw new DeviceError(
      e instanceof DeviceError ? e.code : 'INTERNAL',
      `${app} is ${held} for this tool's launches, but did not start again: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
  return `${app}'s launches by this tool, not the system's own text`;
}

export const appLanguage = (device: string, app: string) => appLanguages.read(device)?.[app] ?? '';

export const on = (v: string, yes: string, no: string) => ({ on: yes, off: no })[v] ?? v;

/** iOS's text sizes, as simctl and devicectl both take them. */
export const TEXT_SIZES = [
  'extra-small',
  'small',
  'medium',
  'large',
  'extra-large',
  'extra-extra-large',
  'extra-extra-extra-large',
  'accessibility-medium',
  'accessibility-large',
  'accessibility-extra-large',
  'accessibility-extra-extra-large',
  'accessibility-extra-extra-extra-large',
];

/** A text size iOS has, else a refusal that names them: simctl says "Invalid argument" to another and exits 0. */
export function textSize(value: string) {
  if (!TEXT_SIZES.includes(value))
    throw new DeviceError(
      'INVALID_ARGUMENT',
      `text_size on iOS is a size, not ${value}`,
      `one of ${TEXT_SIZES.join(', ')}`,
    );
  return value;
}

/** A text size that does not read back as it was set is refused, with what it reads. */
export function heldSize(value: string, now: string, said = '') {
  if (now !== value)
    throw new DeviceError(
      'UNSUPPORTED',
      `asked for text_size ${value} and it reads ${now}${said ? `: ${said}` : ''}`,
    );
}
