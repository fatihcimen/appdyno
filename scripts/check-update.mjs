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
import { update, verifyRelease } from '../packages/cli/dist/index.js';

const UPSTREAM = 'https://registry.npmjs.org';
const SEMVER_REPOSITORY = 'https://github.com/npm/node-semver';

const temp = realpathSync(mkdtempSync(join(tmpdir(), 'appdyno-check-update-')));
const prefix = join(temp, 'prefix');
const pnpmHome = join(temp, 'pnpm');
const tmp = join(temp, 'tmp');
for (const d of [prefix, pnpmHome, tmp]) mkdirSync(d);
const env = {
  ...process.env,
  PATH: `${join(pnpmHome, 'bin')}:${pnpmHome}:${process.env.PATH}`,
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
const runWith =
  (extra = {}) =>
  (file, args, options) =>
    executed(file, args, { ...options, env: { ...env, ...extra } });
const run = runWith();

const shell = (file, ...args) => {
  const r = spawnSync(file, args, { cwd: temp, env, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${file} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const npmSays = (...args) => JSON.parse(shell('npm', 'view', ...args, '--json'));
const versionAt = (root) => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

let failed = 0;
async function step(name, fn) {
  try {
    console.log(`ok   ${name}: ${await fn()}`);
  } catch (e) {
    failed = 1;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

/** The promise must be refused in these words, and not for another reason. */
async function refused(going, words) {
  const e = await going.then(
    () => undefined,
    (x) => x,
  );
  if (!e) throw new Error('it was let through');
  if (!words.test(e.message)) throw new Error(`refused for another reason: ${e.message}`);
  return e.message;
}

const stable = (versions) => versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v));
const semver = npmSays('semver', 'dist-tags.latest');
const oldSemver = stable(npmSays('semver', 'versions')).at(-2);
const makeDirLatest = npmSays('make-dir', 'dist-tags.latest');
const verified = (name, version, repository, options) =>
  verifyRelease({ name, version, repository }, options ?? run, tmp);

/** A registry that hands on the real one's answers, changed by `change` where it returns something. */
async function registryWith(change) {
  const server = createServer(async (req, res) => {
    const headers = { accept: req.headers.accept ?? '*/*' };
    const upstream = await fetch(`${UPSTREAM}${req.url}`, { headers });
    let body = Buffer.from(await upstream.arrayBuffer());
    // pnpm follows a packument's tarball address, so it has to lead back here
    if (!req.url.endsWith('.tgz'))
      body = Buffer.from(body.toString().replaceAll(`${UPSTREAM}/`, registry));
    const changed = upstream.ok ? change(req.url, body) : undefined;
    if (changed) body = Buffer.from(changed);
    const type = upstream.headers.get('content-type') ?? 'application/json';
    res.writeHead(upstream.status, { 'content-type': type });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const registry = `http://127.0.0.1:${server.address().port}/`;
  // its own cache, so that an answer the tampering changed goes nowhere else
  const options = runWith({
    npm_config_registry: registry,
    npm_config_cache: mkdtempSync(join(temp, 'tampered-')),
    npm_config_fetch_retries: '0',
  });
  return { options, registry, close: () => server.close() };
}

const inTarball = (url, body) =>
  url.endsWith('.tgz') ? Buffer.concat([body, Buffer.from('x')]) : undefined;

const inPackument = (url, body, edit) => {
  if (url !== '/semver' && url !== `/semver/${semver}`) return undefined;
  const doc = JSON.parse(body);
  edit((doc.versions?.[semver] ?? doc).dist);
  return JSON.stringify(doc);
};

const flip = (text) => `${text[0] === 'A' ? 'B' : 'A'}${text.slice(1)}`;

async function tampered(change, going) {
  const { options, registry, close } = await registryWith(change);
  try {
    return await going(options, registry);
  } finally {
    close();
  }
}

/** A real install fails while it unpacks, past the point where a manager has moved the old copy aside. */
const failsMidway = async (installing) => {
  const e = await tampered(inTarball, (options, registry) =>
    installing(options, registry).then(
      () => undefined,
      (x) => x,
    ),
  );
  if (!/INTEGRITY|TARBALL/i.test(`${e?.stdout}${e?.stderr}`))
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
        const doc = JSON.parse(body);
        for (const { bundle } of doc.attestations)
          bundle.dsseEnvelope.signatures[0].sig = flip(bundle.dsseEnvelope.signatures[0].sig);
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

  const say = { out: () => undefined };
  const npmRoot = join(prefix, 'lib/node_modules/semver');
  shell('npm', 'install', '--global', '--ignore-scripts', `semver@${oldSemver}`);

  await step('--check changes nothing', async () => {
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
      const ran = shell(join(prefix, 'bin/semver'), '-h').split('\n')[0];
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
    const ran = shell(join(prefix, 'bin/semver'), '-h').split('\n')[0];
    if (ran !== `SemVer ${oldSemver}`) throw new Error(`it says ${ran}`);
    return ran;
  });
  await step(`npm: ${oldSemver} to ${semver}`, async () => {
    await update({ root: npmRoot, run, tmp, ...say });
    const ran = shell(join(prefix, 'bin/semver'), '-h').split('\n')[0];
    if (ran !== `SemVer ${semver}`) throw new Error(`it says ${ran}`);
    return ran;
  });
  await step('npm: already current', async () => {
    const lines = [];
    await update({ root: npmRoot, run, tmp, ...say, out: (l) => lines.push(l) });
    return lines.at(-1);
  });
  await step('pnpm: the same, by the manager that keeps it', async () => {
    const version = () =>
      JSON.parse(shell('pnpm', 'ls', '--global', '--json', '--depth', '0'))[0].dependencies.semver;
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
