import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { repositoryOf, type Manifest, type TheApp } from './installed.js';
import { call, failed, refuse, type Run } from './release.js';

/** A file from the network: given, so that a test reaches none. */
export type Get = (url: string) => Promise<Buffer>;

export type Appcast = { version: string; url: string; sha256: string; size: number };

/** Beside the package in the app: the public half of the key that signs what a release says of itself. */
const KEY_FILE = 'update-key.pem';
const INSTALL_MS = 600_000;
const HINT = 'nothing was changed: wait for a release that passes, or download one by hand';

/** The app ships none of npm: a plain download, which fails as `failed` reads it. */
export const download: Get = async (url) => {
  const res = await fetch(url);
  if (res.status === 404) throw Object.assign(new Error('E404'), { stderr: 'E404' });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

const reached = async (get: Get, url: string) => {
  try {
    return await get(url);
  } catch (e) {
    const { cause } = e as { cause?: { code?: string } };
    throw failed(cause?.code ? { stderr: cause.code } : e, `asking for ${url}`);
  }
};

/**
 * What the latest release says of itself, once the key this app was built with has verified it. Nothing else of the
 * release is believed: the file's address may be anyone's, as all that matters is what it signs.
 */
export async function readAppcast(root: string, me: Manifest, get: Get): Promise<Appcast> {
  const key = join(root, KEY_FILE);
  if (!existsSync(key))
    throw refuse(
      'this build was made with no update key, so a release cannot be verified',
      'UNSUPPORTED',
      'download the new version by hand',
    );
  const at = `${repositoryOf(me)}/releases/latest/download/appcast.json`;
  const [cast, signature] = [await reached(get, at), await reached(get, `${at}.sig`)];
  const good = verify(
    null,
    cast,
    createPublicKey(readFileSync(key)),
    Buffer.from(signature.toString(), 'base64'),
  );
  if (!good) throw refuse('the signature of the appcast is bad', 'CHECK_FAILED', HINT);
  return JSON.parse(cast.toString()) as Appcast;
}

/** What identifies a signed app: both must match, or this is a different program. */
async function signer(bundle: string, run: Run) {
  // it answers on stderr
  const { stderr = '' } = await run('/usr/bin/codesign', ['-dv', bundle], {
    cwd: dirname(bundle),
    timeout: 60_000,
    maxBuffer: 1 << 20,
  });
  const field = (name: string) => new RegExp(`^${name}=(.*)$`, 'm').exec(stderr)?.[1];
  return `${field('Identifier')} of ${field('TeamIdentifier')}`;
}

/** A new app beside the old one, so that the last step is a rename on one disk. */
async function unpacked(cast: Appcast, image: string, place: TheApp, run: Run) {
  const folder = dirname(place.bundle);
  const mount = await mkdtemp(join(dirname(image), 'mount-'));
  const copy = join(folder, `.${basename(place.bundle, '.app')}-${cast.version}.app`);
  await call(run, '/usr/bin/hdiutil', [
    'attach',
    image,
    '-nobrowse',
    '-readonly',
    '-mountpoint',
    mount,
  ]);
  try {
    rmSync(copy, { recursive: true, force: true });
    const from = join(mount, basename(place.bundle));
    await call(run, '/usr/bin/ditto', [from, copy], { timeout: INSTALL_MS });
  } finally {
    await call(run, '/usr/bin/hdiutil', ['detach', mount, '-force']);
  }
  return copy;
}

/** That what was unpacked is whole, is this program, and is the version the signed appcast names. */
async function check(copy: string, cast: Appcast, place: TheApp, run: Run) {
  await call(run, '/usr/bin/codesign', ['--verify', '--deep', '--strict', copy], {
    cwd: dirname(copy),
    timeout: INSTALL_MS,
  }).catch((e: unknown) => {
    const said = `${(e as { stderr?: string }).stderr ?? ''}`.trim().split('\n').at(-1);
    throw refuse(`the app inside fails its signature: ${said}`, 'CHECK_FAILED', HINT);
  });
  const plist = join(copy, 'Contents/Info.plist');
  const version = await call(run, '/usr/bin/plutil', [
    '-extract',
    'CFBundleShortVersionString',
    'raw',
    plist,
  ]);
  if (version.trim() !== cast.version)
    throw refuse(`the app inside is ${version.trim()}, not ${cast.version}`, 'CHECK_FAILED', HINT);
  const [have, got] = [await signer(place.bundle, run), await signer(copy, run)];
  if (have !== got) throw refuse(`the app inside is ${got}, not ${have}`, 'CHECK_FAILED', HINT);
}

/** The last step, and the only one that touches the app: a failed second rename puts the first back. */
function swapIn(copy: string, bundle: string) {
  const old = `${copy}.old`;
  renameSync(bundle, old);
  try {
    renameSync(copy, bundle);
  } catch (e) {
    renameSync(old, bundle);
    throw e;
  }
  rmSync(old, { recursive: true, force: true });
}

/** Downloaded, verified and unpacked in full before the running app is touched. */
export async function installApp(
  cast: Appcast,
  place: TheApp,
  o: { run: Run; get: Get; tmp: string; out: (line: string) => void },
) {
  o.out(`downloading ${cast.url}`);
  const image = await reached(o.get, cast.url);
  const sha256 = createHash('sha256').update(image).digest('hex');
  if (image.length !== cast.size || sha256 !== cast.sha256)
    throw refuse(`the download is not what the appcast signs`, 'CHECK_FAILED', HINT);
  const folder = await mkdtemp(join(o.tmp, 'appdyno-update-'));
  const dmg = join(folder, 'Appdyno.dmg');
  let copy: string | undefined;
  try {
    await writeFile(dmg, image);
    copy = await unpacked(cast, dmg, place, o.run);
    o.out('checking its signature');
    await check(copy, cast, place, o.run);
    swapIn(copy, place.bundle);
    copy = undefined;
  } catch (e) {
    throw failed(e, 'replacing the app');
  } finally {
    rmSync(folder, { recursive: true, force: true });
    if (copy) rmSync(copy, { recursive: true, force: true });
  }
}
