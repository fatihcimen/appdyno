import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** What the runner shows on the home screen. */
export const RUNNER_NAME = 'appdyno';
/** Part of a signed runner's cache key: a new branding means a new build on the phone. */
export const BRAND_VERSION = '1';
const ICONS = ['AppIcon60x60@2x.png', 'AppIcon60x60@3x.png'];

/**
 * The repository's ios folder when this code runs from a checkout. An installed package sits at the same
 * depth, so a folder that merely is at that place must not count.
 */
export function checkoutIos(): string | undefined {
  const ios = join(dirname(fileURLToPath(import.meta.url)), '../../../ios');
  return existsSync(join(ios, 'Appdyno.xcodeproj')) ? ios : undefined;
}

/** The runner's icons: the repository's, else the packaged copy. */
export function brandingDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const repo = checkoutIos();
  return [repo && join(repo, 'Branding'), join(here, '../agents/ios-src/Branding')].find(
    (d): d is string => !!d && existsSync(join(d, ICONS[0]!)),
  );
}

const plist = (app: string) => join(app, 'Info.plist');

/** Already branded (its display name is ours)? */
export async function branded(app: string): Promise<boolean> {
  const { stdout } = await run('plutil', [
    '-extract',
    'CFBundleDisplayName',
    'raw',
    plist(app),
  ]).catch(() => ({ stdout: '' }));
  return stdout.trim() === RUNNER_NAME;
}

/**
 * The runner app as "appdyno" with its icon (name and icon files in its Info.plist, the icons in
 * the bundle). The caller signs it afterwards.
 */
export async function brandRunner(app: string): Promise<void> {
  const dir = brandingDir();
  if (dir) for (const icon of ICONS) await copyFile(join(dir, icon), join(app, icon));
  const p = plist(app);
  await run('plutil', ['-replace', 'CFBundleDisplayName', '-string', RUNNER_NAME, p]);
  await run('plutil', ['-replace', 'CFBundleName', '-string', RUNNER_NAME, p]);
  if (dir)
    await run('plutil', [
      '-replace',
      'CFBundleIcons',
      '-json',
      JSON.stringify({ CFBundlePrimaryIcon: { CFBundleIconFiles: ['AppIcon60x60'] } }),
      p,
    ]);
}

/** A simulator build branded once, then signed again for the simulator (ad hoc, its entitlements kept). */
export async function brandSimulatorRunner(app: string): Promise<void> {
  if (await branded(app)) return;
  await brandRunner(app);
  await run('codesign', [
    '--force',
    '--sign',
    '-',
    '--preserve-metadata=entitlements',
    '--timestamp=none',
    app,
  ]);
}
