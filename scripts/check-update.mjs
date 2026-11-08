#!/usr/bin/env node
// `appdyno update` on real releases, by the code the command runs and the seam its unit tests use. appdyno
// has none published yet, so public packages stand in: semver has provenance, make-dir has none and depends on
// semver, which has it. npm's and pnpm's prefix, cache, config and store all stay in one temporary folder,
// and a proxy on loopback tampers with what the registry answers, for what no public package shows.
//   pnpm build && node scripts/check-update.mjs
import { execFile, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { update, verifyRelease } from '@appdyno/cli';
import { must } from '@appdyno/core';

const UPSTREAM = 'https://registry.npmjs.org';
const SEMVER_REPOSITORY = 'https://github.com/npm/node-semver';

const temp = realpathSync(mkdtempSync(join(tmpdir(), 'appdyno-check-update-')));
const prefix = join(temp, 'prefix');
const pnpmHome = join(temp, 'pnpm');
const tmp = join(temp, 'tmp');
for (const d of [prefix, pnpmHome, tmp]) mkdirSync(d);
const env = {
  ...process.env,
  PATH: `${join(pnpmHome, 'bin')}:${pnpmHome}:${String(process.env.PATH)}`,
  PNPM_HOME: pnpmHome,
  XDG_CONFIG_HOME: join(temp, 'xdg-config'),
  XDG_DATA_HOME: join(temp, 'xdg-data'),
  XDG_STATE_HOME: join(temp, 'xdg-state'),
  XDG_CACHE_HOME: join(temp, 'xdg-cache'),
  npm_config_prefix: prefix,
  npm_config_cache: join(temp, 'npm-cache'),
  npm_config_userconfig: join(temp, 'npmrc'),
  npm_config_update_notifier: 'false',
};

const executed = promisify(execFile);
/**
 * What runs npm and pnpm here, with what options a caller gives: `update` gives more than a step does.
 * @typedef {(file: string, args: string[], options: { cwd: string }) => Promise<{ stdout: string; stderr: string }>} Run
 */
/** @type {(extra?: object) => Run} */
const runWith =
  (extra = {}) =>
  (file, args, options) =>
    executed(file, args, { ...options, encoding: 'utf8', env: { ...env, ...extra } });
const run = runWith();

/**
 * @param {string} file
 * @param {...string} args
 */
const shell = (file, ...args) => {
  const r = spawnSync(file, args, { cwd: temp, env, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${file} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
/**
 * What JSON says, to be read as what it is known to be.
 * @param {string | Buffer} text
 * @returns {unknown}
 */
const parsed = (text) => JSON.parse(text.toString());
/** @param {...string} args */
const npmSays = (...args) => parsed(shell('npm', 'view', ...args, '--json'));
/** @param {string} root */
const versionAt = (root) =>
  /** @type {{ version: string }} */ (parsed(readFileSync(join(root, 'package.json'), 'utf8')))
    .version;

let failed = 0;
/**
 * @param {string} name
 * @param {() => Promise<unknown>} fn
 */
async function step(name, fn) {
  try {
    console.log(`ok   ${name}: ${String(await fn())}`);
  } catch (e) {
    failed = 1;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * The promise must be refused in these words, and not for another reason.
 * @param {Promise<unknown>} going
 * @param {RegExp} words
 */
async function refused(going, words) {
  const e = await going.then(
    () => undefined,
    (/** @type {unknown} */ x) => x,
  );
  const said = e instanceof Error ? e.message : String(e);
  if (!e) throw new Error('it was let through');
  if (!words.test(said)) throw new Error(`refused for another reason: ${said}`);
  return said;
}

/** @param {string[]} versions */
const stable = (versions) => versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v));
const semver = String(npmSays('semver', 'dist-tags.latest'));
const oldSemver = must(
  stable(/** @type {string[]} */ (npmSays('semver', 'versions'))).at(-2),
  'an older semver',
);
const makeDirLatest = String(npmSays('make-dir', 'dist-tags.latest'));
/**
 * @param {string} name
 * @param {string} version
 * @param {string} repository
 * @param {Run} [options]
 */
const verified = (name, version, repository, options) =>
  verifyRelease({ name, version, repository }, options ?? run, tmp);

/**
 * A packument's or a version's `dist`, as the registry has it: what of it is changed here.
 * @typedef {{ attestations?: unknown; signatures: { sig: string }[] }} Dist
 * @typedef {(url: string, body: Buffer) => string | Buffer | undefined} Change
 */

/**
 * A registry that hands on the real one's answers, changed by `change` where it returns something.
 * @param {Change} change
 */
async function registryWith(change) {
  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  const answer = async (req, res) => {
    const headers = { accept: req.headers.accept ?? '*/*' };
    const url = String(req.url);
    const upstream = await fetch(`${UPSTREAM}${url}`, { headers });
    let body = Buffer.from(await upstream.arrayBuffer());
    // pnpm follows a packument's tarball address, so it has to lead back here
    if (!url.endsWith('.tgz'))
      body = Buffer.from(body.toString().replaceAll(`${UPSTREAM}/`, registry));
    const changed = upstream.ok ? change(url, body) : undefined;
    if (changed) body = Buffer.from(changed);
    const type = upstream.headers.get('content-type') ?? 'application/json';
    res.writeHead(upstream.status, { 'content-type': type });
    res.end(body);
  };
  const server = createServer((req, res) => void answer(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  const registry = `http://127.0.0.1:${port}/`;
  // its own cache, so that an answer the tampering changed goes nowhere else
  const options = runWith({
    npm_config_registry: registry,
    npm_config_cache: mkdtempSync(join(temp, 'tampered-')),
    npm_config_fetch_retries: '0',
  });
  return { options, registry, close: () => server.close() };
}

/** @type {Change} */
const inTarball = (url, body) =>
  url.endsWith('.tgz') ? Buffer.concat([body, Buffer.from('x')]) : undefined;

/**
 * @param {string} url
 * @param {Buffer} body
 * @param {(dist: Dist) => void} edit
 */
const inPackument = (url, body, edit) => {
  if (url !== '/semver' && url !== `/semver/${semver}`) return undefined;
  const doc = /** @type {{ versions?: Record<string, { dist?: Dist }>; dist?: Dist }} */ (
    parsed(body)
  );
  edit(must((doc.versions?.[semver] ?? doc).dist, 'its dist'));
  return JSON.stringify(doc);
};

/** @param {string} text */
const flip = (text) => `${text.startsWith('A') ? 'B' : 'A'}${text.slice(1)}`;

/**
 * @template T
 * @param {Change} change
 * @param {(options: Run, registry: string) => Promise<T>} going
 */
async function tampered(change, going) {
  const { options, registry, close } = await registryWith(change);
  try {
    return await going(options, registry);
  } finally {
    close();
  }
}

/**
 * A real install fails while it unpacks, past the point where a manager has moved the old copy aside.
 * @param {(options: Run, registry: string) => Promise<unknown>} installing
 */
const failsMidway = async (installing) => {
  const e = /** @type {{ stdout?: string; stderr?: string } | undefined} */ (
    await tampered(inTarball, (options, registry) =>
      installing(options, registry).then(
        () => undefined,
        (/** @type {unknown} */ x) => x,
      ),
    )
  );
  if (!/INTEGRITY|TARBALL/i.test(`${String(e?.stdout)}${String(e?.stderr)}`))
    throw new Error(`no integrity failure: ${e?.stderr ?? 'it installed'}`);
};

try {
  await step(`semver@${semver}: provenance, verified`, async () => {
    const built = await verified('semver', semver, SEMVER_REPOSITORY);
    if (built !== SEMVER_REPOSITORY) throw new Error(`built from ${built}`);
    return `built from ${built}`;
  });
  await step('make-dir@4.0.0: no provenance of its own, while its dependency has it', () =>
    refused(
      verified('make-dir', '4.0.0', 'https://x'),
      /no verified attestation of its own \(only semver@/,
    ),
  );
  await step(`make-dir@${makeDirLatest}: no provenance and no dependency`, () =>
    refused(verified('make-dir', makeDirLatest, 'https://x'), /attestation of its own \(CHECK/),
  );
  await step(`semver@${semver}: provenance from another repository`, () =>
    refused(verified('semver', semver, 'https://github.com/someone/else'), /was built from/),
  );
  await step('a registry that strips the attestation', () =>
    tampered(
      (url, body) => inPackument(url, body, (dist) => delete dist.attestations),
      (options) =>
        refused(verified('semver', semver, SEMVER_REPOSITORY, options), /no verified attestation/),
    ),
  );
  await step('a registry that changes a signature', () =>
    tampered(
      (url, body) =>
        inPackument(url, body, (dist) => {
          for (const signature of dist.signatures) signature.sig = flip(signature.sig);
        }),
      (options) =>
        refused(verified('semver', semver, SEMVER_REPOSITORY, options), /bad signature or att/),
    ),
  );
  await step('a registry that changes the attestation', () =>
    tampered(
      (url, body) => {
        if (!url.startsWith('/-/npm/v1/attestations/')) return undefined;
        const doc =
          /** @type {{ attestations: { bundle: { dsseEnvelope: { signatures: { sig: string }[] } } }[] }} */ (
            parsed(body)
          );
        for (const { bundle } of doc.attestations) {
          const signature = must(bundle.dsseEnvelope.signatures[0], 'its signature');
          signature.sig = flip(signature.sig);
        }
        return JSON.stringify(doc);
      },
      (options) =>
        refused(verified('semver', semver, SEMVER_REPOSITORY, options), /bad signature or att/),
    ),
  );
  await step('a registry that changes the tarball', () =>
    tampered(inTarball, (options) =>
      refused(verified('semver', semver, SEMVER_REPOSITORY, options), /is not what/),
    ),
  );

  const say = {
    out: () => undefined,
    // an app's appcast is the one thing that asks for it, and these are packages
    get: () => Promise.reject(new Error('no appcast here')),
  };
  const npmRoot = join(prefix, 'lib/node_modules/semver');
  shell('npm', 'install', '--global', '--ignore-scripts', `semver@${oldSemver}`);

  /** What the semver this installed says it is. */
  const semverSays = () =>
    must(shell(join(prefix, 'bin/semver'), '-h').split('\n')[0], 'its first line');
  await step('--check changes nothing', async () => {
    /** @type {string[]} */
    const lines = [];
    await update({ root: npmRoot, run, tmp, check: true, ...say, out: (l) => lines.push(l) });
    if (versionAt(npmRoot) !== oldSemver) throw new Error(`moved to ${versionAt(npmRoot)}`);
    return lines.at(-1);
  });
  await step('a failed install leaves the old version working', async () => {
    const parent = join(prefix, 'lib/node_modules');
    chmodSync(parent, 0o555);
    try {
      const said = await refused(update({ root: npmRoot, run, tmp, ...say }), /stays$/);
      const ran = semverSays();
      if (ran !== `SemVer ${oldSemver}`) throw new Error(`it says ${ran}`);
      return `${said}; it runs: ${ran}`;
    } finally {
      chmodSync(parent, 0o755);
    }
  });
  await step('npm: an install that fails midway leaves the old version working', async () => {
    await failsMidway((options) =>
      options('npm', ['install', '--global', '--ignore-scripts', `semver@${semver}`], {
        cwd: temp,
      }),
    );
    const ran = semverSays();
    if (ran !== `SemVer ${oldSemver}`) throw new Error(`it says ${ran}`);
    return ran;
  });
  await step(`npm: ${oldSemver} to ${semver}`, async () => {
    await update({ root: npmRoot, run, tmp, ...say });
    const ran = semverSays();
    if (ran !== `SemVer ${semver}`) throw new Error(`it says ${ran}`);
    return ran;
  });
  await step('npm: already current', async () => {
    /** @type {string[]} */
    const lines = [];
    await update({ root: npmRoot, run, tmp, ...say, out: (l) => lines.push(l) });
    return lines.at(-1);
  });
  await step('pnpm: the same, by the manager that keeps it', async () => {
    const version = () =>
      must(
        /** @type {{ dependencies: { semver: { version: string; path: string } } }[]} */ (
          parsed(shell('pnpm', 'ls', '--global', '--json', '--depth', '0'))
        )[0],
        "pnpm's global packages",
      ).dependencies.semver;
    shell('pnpm', 'add', '--global', '--ignore-scripts', `semver@${oldSemver}`);
    const root = realpathSync(version().path);
    await failsMidway((options, registry) =>
      options(
        'pnpm',
        ['add', '--global', '--ignore-scripts', `--registry=${registry}`, `semver@${semver}`],
        { cwd: temp },
      ),
    );
    if (version().version !== oldSemver) throw new Error(`moved to ${version().version}`);
    await update({ root, run, tmp, ...say });
    if (version().version !== semver) throw new Error(`at ${version().version}`);
    return `${oldSemver} to ${semver} under ${root.slice(temp.length)}, past a failed install`;
  });
  await step('a release with no provenance is refused, and nothing moves', async () => {
    shell('npm', 'install', '--global', '--ignore-scripts', 'make-dir@4.0.0');
    const root = join(prefix, 'lib/node_modules/make-dir');
    const said = await refused(update({ root, run, tmp, ...say }), /no provenance attestation/);
    if (versionAt(root) !== '4.0.0') throw new Error(`moved to ${versionAt(root)}`);
    return said;
  });
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log(failed ? 'FAILED' : 'passed');
process.exitCode = failed;
