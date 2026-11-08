import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { must } from '@appdyno/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { readAppcast, type Get } from '../src/appcast.js';
import type { Manifest } from '../src/installed.js';
import type { Run } from '../src/release.js';
import { update } from '../src/update.js';

const REPOSITORY = 'https://github.com/example/tool';
const AT = `${REPOSITORY}/releases/latest/download/appcast.json`;
const IMAGE = Buffer.from('a disk image');
const NEWER = '1.1.0';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = (key: KeyObject) => key.export({ type: 'spki', format: 'pem' });

const cast = (over: object = {}) =>
  Buffer.from(
    JSON.stringify({
      version: NEWER,
      url: `${REPOSITORY}/releases/download/v1.1.0/Tool.dmg`,
      sha256: createHash('sha256').update(IMAGE).digest('hex'),
      size: IMAGE.length,
      ...over,
    }),
  );
const signed = (bytes: Buffer, key = privateKey) => sign(null, bytes, key).toString('base64');

/** The app in a folder of a test's, as the build lays it out. */
function anApp(key: object | null = publicKey) {
  const bundle = join(
    mkdtempSync(join(tmpdir(), 'appdyno-appcast-test-')),
    'Applications/Tool.app',
  );
  const root = join(bundle, 'Contents/Resources/app');
  mkdirSync(root, { recursive: true });
  const manifest = { name: 'tool', version: '1.0.0', repository: `git+${REPOSITORY}.git` };
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(bundle, 'old'), 'the old app');
  if (key) writeFileSync(join(root, 'update-key.pem'), pem(key as KeyObject));
  return { bundle, root };
}

const getting = (files: Record<string, Buffer | string | Error>): Get => {
  return (url) => {
    const found = files[url];
    if (found === undefined)
      return Promise.reject(Object.assign(new Error('E404'), { stderr: 'E404' }));
    if (found instanceof Error) return Promise.reject(found);
    return Promise.resolve(Buffer.from(found));
  };
};

const released = (bytes = cast()) => ({
  [AT]: bytes,
  [`${AT}.sig`]: signed(bytes),
  [`${REPOSITORY}/releases/download/v1.1.0/Tool.dmg`]: IMAGE,
});

type Say = {
  signer?: string;
  version?: string;
  unsigned?: boolean;
  noSigner?: boolean;
  failAt?: string;
};

/** The Mac's own tools as they answer, with an unpack that lays down the new app. */
function tools(say: Say = {}) {
  const calls: string[] = [];
  const run: Run = (file, args) => {
    const tool = must(file.split('/').at(-1), 'a tool');
    const [first, second] = args;
    const call = `${tool} ${String(first)}`;
    calls.push(call);
    if (say.failAt === call) return Promise.reject(new Error('it failed'));
    if (tool === 'ditto') {
      const into = must(second, 'where ditto unpacks');
      mkdirSync(into, { recursive: true });
      writeFileSync(join(into, 'new'), 'the new app');
      if (say.failAt === 'ditto') return Promise.reject(new Error('no space left on the disk'));
    }
    if (tool === 'codesign' && first === '--verify' && say.unsigned)
      return Promise.reject(new Error('a sealed resource is missing'));
    if (tool === 'plutil') return Promise.resolve({ stdout: `${say.version ?? NEWER}\n` });
    if (say.noSigner) return Promise.resolve({ stdout: '', stderr: '' });
    const identity = second?.includes('.Tool-') ? (say.signer ?? 'TEAM') : 'TEAM';
    return Promise.resolve({
      stdout: '',
      stderr: `Identifier=dev.tool\nTeamIdentifier=${identity}\n`,
    });
  };
  return { run, calls };
}

describe('the appcast', () => {
  it('is believed only when the key in this app verifies it', async () => {
    const { root } = anApp();
    const me = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;
    await expect(readAppcast(root, me, getting(released()))).resolves.toMatchObject({
      version: NEWER,
    });
  });

  it('is refused when signed by any other key', async () => {
    const { root } = anApp();
    const me = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;
    const other = generateKeyPairSync('ed25519').privateKey;
    const bytes = cast();
    const get = getting({ [AT]: bytes, [`${AT}.sig`]: signed(bytes, other) });
    await expect(readAppcast(root, me, get)).rejects.toMatchObject({ code: 'CHECK_FAILED' });
  });

  it('is refused when a byte of it changed', async () => {
    const { root } = anApp();
    const me = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;
    const get = getting({ [AT]: cast({ version: '9.9.9' }), [`${AT}.sig`]: signed(cast()) });
    await expect(readAppcast(root, me, get)).rejects.toThrow(/signature of the appcast is bad/);
  });

  it('cannot be trusted by a build with no key', async () => {
    const { root } = anApp(null);
    const me = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;
    await expect(readAppcast(root, me, getting(released()))).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: expect.stringMatching(/no update key/) as unknown,
    });
  });
});

describe('appdyno update, in the app', () => {
  let app: ReturnType<typeof anApp>;
  let tmp: string;
  const lines: string[] = [];
  const updating = (get: Get, say: Say = {}, check = false) => {
    const mac = tools(say);
    const going = update({
      root: app.root,
      run: mac.run,
      get,
      tmp,
      check,
      out: (l) => lines.push(l),
    });
    return { mac, going };
  };
  const oldStays = () => {
    expect(existsSync(join(app.bundle, 'old'))).toBe(true);
    expect(readdirSync(dirname(app.bundle))).toEqual(['Tool.app']);
    expect(readdirSync(tmp)).toEqual([]);
  };

  beforeEach(() => {
    app = anApp();
    tmp = mkdtempSync(join(tmpdir(), 'appdyno-appcast-tmp-'));
    lines.length = 0;
  });

  it('replaces the app, last of all, with what it verified', async () => {
    const { mac, going } = updating(getting(released()));
    await expect(going).resolves.toBe(0);
    expect(existsSync(join(app.bundle, 'new'))).toBe(true);
    expect(existsSync(join(app.bundle, 'old'))).toBe(false);
    expect(readdirSync(dirname(app.bundle))).toEqual(['Tool.app']);
    expect(readdirSync(tmp)).toEqual([]);
    const [, ditto] = mac.calls;
    expect(mac.calls).toEqual([
      'hdiutil attach',
      `ditto ${String(ditto?.split(' ')[1])}`,
      'hdiutil detach',
      'codesign --verify',
      'plutil -extract',
      'codesign -dv',
      'codesign -dv',
    ]);
    expect(lines.join('\n')).toMatch(/quit Appdyno and open it again/);
  });

  it('changes nothing with --check, and needs no npm', async () => {
    const { mac, going } = updating(getting(released()), {}, true);
    await expect(going).resolves.toBe(0);
    expect(mac.calls).toEqual([]);
    expect(lines.at(-1)).toMatch(/would download .*Tool\.dmg, verify it, then replace this app/);
    oldStays();
  });

  it('never goes back, whatever a signed appcast says', async () => {
    const bytes = cast({ version: '0.9.0' });
    const { going } = updating(getting({ [AT]: bytes, [`${AT}.sig`]: signed(bytes) }));
    await expect(going).resolves.toBe(0);
    expect(lines.at(-1)).toMatch(/never goes back/);
    oldStays();
  });

  it('refuses a prerelease, even signed', async () => {
    const bytes = cast({ version: '2.0.0-rc.1' });
    const { going } = updating(getting({ [AT]: bytes, [`${AT}.sig`]: signed(bytes) }));
    await expect(going).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    oldStays();
  });

  it('refuses a download the appcast does not sign', async () => {
    const { url } = JSON.parse(cast().toString()) as { url: string };
    const get = getting({ ...released(), [url]: 'something else' });
    const { mac, going } = updating(get);
    await expect(going).rejects.toThrow(/not what the appcast signs/);
    expect(mac.calls).toEqual([]);
    oldStays();
  });

  it('refuses an app with a broken signature, and keeps the old one', async () => {
    const { going } = updating(getting(released()), { unsigned: true });
    await expect(going).rejects.toMatchObject({ code: 'CHECK_FAILED' });
    oldStays();
  });

  it('refuses an app signed by someone else', async () => {
    const { going } = updating(getting(released()), { signer: 'STRANGER' });
    await expect(going).rejects.toThrow(/of STRANGER, not dev\.tool of TEAM/);
    oldStays();
  });

  it('refuses when it cannot tell who signed either app, as two blanks are alike', async () => {
    const { going } = updating(getting(released()), { noSigner: true });
    await expect(going).rejects.toThrow(/names no signer/);
    oldStays();
  });

  it('refuses an app inside that is not the version signed', async () => {
    const { going } = updating(getting(released()), { version: '1.0.5' });
    await expect(going).rejects.toThrow(/the app inside is 1\.0\.5, not 1\.1\.0/);
    oldStays();
  });

  it('detaches the disk image when the copy fails, and leaves none of the copy', async () => {
    const { mac, going } = updating(getting(released()), { failAt: 'ditto' });
    await expect(going).rejects.toThrow(/no space left on the disk/);
    expect(mac.calls.at(-1)).toBe('hdiutil detach');
    oldStays();
  });

  it('leaves none of the copy when the image will not detach', async () => {
    const { going } = updating(getting(released()), { failAt: 'hdiutil detach' });
    await expect(going).rejects.toThrow();
    oldStays();
  });

  it('says what stood in the way of a folder it may not write, not nothing', async () => {
    const locked = Object.assign(new Error("EACCES: permission denied, rename '/Applications'"), {
      code: 'EACCES',
    });
    const mac = tools();
    const run: Run = async (file, args, o) => {
      if (file.endsWith('ditto')) throw locked;
      return mac.run(file, args, o);
    };
    const going = update({
      root: app.root,
      run,
      get: getting(released()),
      tmp,
      out: () => undefined,
    });
    await expect(going).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
    oldStays();
  });

  it('says so offline, and when no release exists', async () => {
    const lost = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    await expect(updating(getting({ [AT]: lost })).going).rejects.toMatchObject({
      code: 'OFFLINE',
    });
    await expect(updating(getting({})).going).rejects.toMatchObject({ code: 'NOT_FOUND' });
    oldStays();
  });

  it('refuses an app still on its disk image or where it was downloaded', async () => {
    for (const bundle of [
      '/Volumes/Appdyno/Tool.app',
      '/private/var/AppTranslocation/x/d/Tool.app',
    ]) {
      const root = join(bundle, 'Contents/Resources/app');
      const { going } = (() => {
        const mac = tools();
        return {
          going: update({ root, run: mac.run, get: getting({}), tmp, out: () => undefined }),
        };
      })();
      await expect(going).rejects.toThrow();
    }
  });
});
