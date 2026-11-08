import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, beforeEach, describe, expect, it } from 'vitest';
import { compareVersions, type Run } from '../src/release.js';
import { update } from '../src/update.js';

const REPOSITORY = 'https://github.com/example/tool';
const MANIFEST = {
  name: 'tool',
  version: '1.0.0',
  repository: { type: 'git', url: `git+${REPOSITORY}.git` },
};
const LATEST = '1.1.0';
const SPEC = `tool@${LATEST}`;
const GLOBAL = 'lib/node_modules/tool';

const temp = () => mkdtempSync(join(tmpdir(), 'appdyno-update-test-'));
/** The registry's path never reads an appcast. */
const refusedGet = () => Promise.reject(new Error('no network here'));

function copyAt(path: string, manifest: object = MANIFEST) {
  const root = join(temp(), path);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  return root;
}

const versionAt = (root: string) =>
  (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;

/** What npm says of a release with provenance, as `npm view` gave it for a real one. */
const view = (version = LATEST, attested = true) =>
  JSON.stringify({
    version,
    dist: {
      integrity: 'sha512-x',
      ...(attested && {
        attestations: {
          url: `https://registry.npmjs.org/-/npm/v1/attestations/tool@${version}`,
          provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
        },
      }),
    },
  });

const bundle = (predicateType: string, statement: object) => ({
  predicateType,
  bundle: {
    dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') },
  },
});

/** One `verified` entry of `npm audit signatures --json --include-attestations`. */
const attested = (name: string, version: string, repository = REPOSITORY) => ({
  name,
  version,
  location: `node_modules/${name}`,
  registry: 'https://registry.npmjs.org/',
  attestations: { provenance: { predicateType: 'https://slsa.dev/provenance/v1' } },
  attestationBundles: [
    bundle('https://github.com/npm/attestation/tree/main/specs/publish/v0.1', {}),
    bundle('https://slsa.dev/provenance/v1', {
      predicate: { buildDefinition: { externalParameters: { workflow: { repository } } } },
    }),
  ],
});

const audit = (o: { invalid?: object[]; missing?: object[]; verified?: object[] }) =>
  JSON.stringify({ invalid: [], missing: [], ...o });

/** The command failing as execFile rejects: exit code, and npm's own words. */
const failure = (code: string, stdout = JSON.stringify({ error: { code, summary: code } })) =>
  Object.assign(new Error('Command failed'), {
    code: 1,
    stdout,
    stderr: `npm error code ${code}\nnpm error ${code} went wrong\n`,
  });

type Answer = string | Error | (() => string);
type Answers = {
  npm?: Answer;
  view?: Answer;
  fetch?: Answer;
  audit?: Answer;
  upgrade?: Answer;
  list?: Answer;
};
const wordOf = (file: string, args: string[]): keyof Answers => {
  if (args[0] === '--version') return 'npm';
  if (args[0] === 'view') return 'view';
  if (args[0] === 'audit') return 'audit';
  if (args[0] === 'ls') return 'list';
  return args.includes('--global') ? 'upgrade' : 'fetch';
};

/** npm and pnpm as they answer, with an upgrade that moves the copy at `root`; every call kept. */
function fake(root: string, answers: Answers = {}) {
  const calls: { file: string; args: string[]; cwd: string; word: keyof Answers }[] = [];
  const all: Required<Answers> = {
    npm: '11.19.0\n',
    view: view(),
    fetch: 'added 1 package\n',
    audit: audit({ verified: [attested('tool', LATEST)] }),
    upgrade: () => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ ...MANIFEST, version: LATEST }));
      return 'changed 1 package\n';
    },
    list: JSON.stringify([{ dependencies: { tool: { version: LATEST } } }]),
    ...answers,
  };
  const run: Run = (file, args, { cwd }) => {
    const word = wordOf(file, args);
    calls.push({ file, args, cwd, word });
    const answer = all[word];
    const given = typeof answer === 'function' ? answer() : answer;
    if (given instanceof Error) return Promise.reject(given);
    return Promise.resolve({ stdout: given });
  };
  return { run, calls, words: () => calls.map((c) => c.word) };
}

function updating(root: string, answers: Answers = {}, check = false) {
  const npm = fake(root, answers);
  const out: string[] = [];
  const tmp = temp();
  const going = update({
    root,
    run: npm.run,
    get: refusedGet,
    tmp,
    check,
    out: (s) => out.push(s),
  });
  return Promise.resolve({ npm, out, tmp, going });
}

const refused = async (root: string, answers: Answers, code: string, words: RegExp) => {
  const r = await updating(root, answers);
  await expect(r.going).rejects.toMatchObject({
    code,
    message: expect.stringMatching(words) as unknown,
  });
  expect(versionAt(root)).toBe('1.0.0');
  expect(r.npm.words()).not.toContain('upgrade');
  expect(readdirSync(r.tmp)).toEqual([]);
  return r;
};

describe('compareVersions', () => {
  it.each([
    ['0.9.0', '0.10.0', -1],
    ['1.0.0', '1.0.0', 0],
    ['2.0.0', '1.99.99', 1],
    ['1.0.0-rc.1', '1.0.0', -1],
    ['1.0.0', '1.0.0-rc.1', 1],
  ])('%s against %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });
});

describe('appdyno update', () => {
  let root: string;
  beforeEach(() => {
    root = copyAt(GLOBAL);
  });

  it('verifies the exact version before anything changes, then installs that version', async () => {
    const r = await updating(root);
    expect(await r.going).toBe(0);
    expect(r.npm.words()).toEqual(['npm', 'view', 'fetch', 'audit', 'upgrade']);
    const [, seen, fetched, audited, upgraded] = r.npm.calls;
    assert(seen && fetched && audited && upgraded);
    expect(seen.args.slice(0, 2)).toEqual(['view', 'tool@latest']);
    expect(fetched.args).toContain(SPEC);
    expect(fetched.args).toContain('--ignore-scripts');
    expect(audited.args).toEqual(['audit', 'signatures', '--json', '--include-attestations']);
    expect(audited.cwd).toBe(fetched.cwd);
    expect(upgraded.args).toEqual(expect.arrayContaining([SPEC, '--global', '--offline']));
    expect(upgraded.args).toContain(root.slice(0, -`/${GLOBAL}`.length));
    expect(versionAt(root)).toBe(LATEST);
    expect(readdirSync(r.tmp)).toEqual([]);
  });

  it('asks from no project, so that a folder cannot choose the registry', async () => {
    const r = await updating(root);
    await r.going;
    for (const { word, cwd } of r.npm.calls)
      if (word !== 'fetch' && word !== 'audit') expect(cwd).toBe(tmpdir());
  });

  it('says what happened and that a running server keeps the old code', async () => {
    const r = await updating(root);
    await r.going;
    const words = r.out.join('\n');
    expect(words).toContain(`installed: 1.0.0, installed by npm, at ${root}`);
    expect(words).toContain(`latest: ${LATEST}`);
    expect(words).toContain(`built from ${REPOSITORY}`);
    expect(words).toContain(`updated: 1.0.0 to ${LATEST}`);
    expect(words).toMatch(/running MCP server keeps the old code until its client restarts it/);
  });

  it('upgrades with pnpm where pnpm keeps it, and verifies with npm all the same', async () => {
    const pnpmRoot = copyAt('pnpm/global/5/.pnpm/tool@1.0.0/node_modules/tool');
    const r = await updating(pnpmRoot);
    expect(await r.going).toBe(0);
    expect(r.npm.calls.find((c) => c.word === 'audit')?.file).toBe('npm');
    expect(r.npm.calls.find((c) => c.word === 'upgrade')).toMatchObject({
      file: 'pnpm',
      args: ['add', '--global', '--ignore-scripts', SPEC],
    });
  });

  it('changes nothing with --check, and says what would happen', async () => {
    const r = await updating(root, {}, true);
    expect(await r.going).toBe(0);
    expect(r.npm.words()).toEqual(['npm', 'view']);
    expect(r.out.join('\n')).toContain(`would verify ${SPEC}, then upgrade it with npm`);
    expect(versionAt(root)).toBe('1.0.0');
  });

  it.each([
    ['no provenance', { view: view(LATEST, false) }, /no provenance attestation/],
    ['a prerelease', { view: view('2.0.0-rc.1') }, /prerelease, 2\.0\.0-rc\.1/],
    ['an old npm', { npm: '10.9.9\n' }, /npm 10\.9\.9 cannot say/],
  ])('says with --check that %s would be refused', async (_, answers, words) => {
    const r = await updating(root, answers, true);
    expect(await r.going).toBe(0);
    expect(r.out.join('\n')).toMatch(/would refuse: /);
    expect(r.out.join('\n')).toMatch(words);
    expect(r.npm.words()).toEqual(['npm', 'view']);
  });

  it('has nothing to do at the latest version', async () => {
    const r = await updating(root, { view: view('1.0.0') });
    expect(await r.going).toBe(0);
    expect(r.out.at(-1)).toBe('nothing to do: 1.0.0 is the latest release');
    expect(r.npm.words()).toEqual(['npm', 'view']);
  });

  it('never goes back to an older version', async () => {
    const r = await updating(root, { view: view('0.9.9') });
    expect(await r.going).toBe(0);
    expect(r.out.at(-1)).toMatch(/newer than the latest release: this never goes back/);
    expect(versionAt(root)).toBe('1.0.0');
    expect(r.npm.words()).toEqual(['npm', 'view']);
  });

  it('refuses a latest tag that points at a prerelease', async () => {
    await refused(root, { view: view('2.0.0-rc.1') }, 'UNSUPPORTED', /prerelease, 2\.0\.0-rc\.1/);
  });

  it('says so when the registry cannot be reached', async () => {
    await refused(root, { view: failure('ENOTFOUND') }, 'OFFLINE', /cannot be reached/);
    await refused(root, { fetch: failure('ECONNRESET') }, 'OFFLINE', /verifying tool@1\.1\.0/);
  });

  it('says what is installed before it asks the registry anything', async () => {
    const r = await updating(root, { view: failure('ENOTFOUND') }, true);
    await expect(r.going).rejects.toMatchObject({ code: 'OFFLINE' });
    expect(r.out).toEqual([`installed: 1.0.0, installed by npm, at ${root}`]);
  });

  it('says so when the registry does not have it', async () => {
    await refused(root, { view: failure('E404') }, 'NOT_FOUND', /no such package/);
  });

  it('says so when a command runs out of time', async () => {
    const hung = Object.assign(new Error('killed'), { killed: true });
    await refused(root, { view: hung }, 'TIMEOUT', /took too long/);
  });

  it('refuses without npm, which verifying needs', async () => {
    const gone = Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' });
    await refused(root, { npm: gone }, 'UNSUPPORTED', /not on PATH/);
  });

  it('refuses a release with no provenance before downloading it', async () => {
    const r = await refused(root, { view: view(LATEST, false) }, 'CHECK_FAILED', /no provenance/);
    expect(r.npm.words()).toEqual(['npm', 'view']);
  });

  it('refuses an npm that cannot say what it verified, before downloading', async () => {
    const r = await refused(root, { npm: '10.9.9\n' }, 'CHECK_FAILED', /cannot say which/);
    expect(r.npm.words()).toEqual(['npm', 'view']);
  });

  it('refuses a bad signature, which npm reports with exit 1 and a list', async () => {
    const list = audit({
      invalid: [
        { code: 'EINTEGRITYSIGNATURE', name: 'tool', version: LATEST, location: 'node_modules/x' },
      ],
    });
    const r = await refused(
      root,
      { audit: failure('EINTEGRITYSIGNATURE', list) },
      'CHECK_FAILED',
      /bad signature or attestation: tool@1\.1\.0/,
    );
    expect(r.npm.words()).toEqual(['npm', 'view', 'fetch', 'audit']);
  });

  it('refuses a signature that is missing', async () => {
    const list = audit({ missing: [{ name: 'dependency', version: '1.0.0' }] });
    await refused(root, { audit: failure('E1', list) }, 'CHECK_FAILED', /no signature: dependency/);
  });

  it('refuses an attestation that is a dependency’s only', async () => {
    const only = audit({ verified: [attested('dependency', '7.8.6')] });
    await refused(
      root,
      { audit: only },
      'CHECK_FAILED',
      /tool@1\.1\.0 has no verified attestation of its own \(only dependency@7\.8\.6\)/,
    );
  });

  it('refuses a verified attestation of another version', async () => {
    const other = audit({ verified: [attested('tool', '1.0.9')] });
    await refused(root, { audit: other }, 'CHECK_FAILED', /no verified attestation of its own/);
  });

  it('refuses a clean audit that verified no attestation', async () => {
    await refused(
      root,
      { audit: audit({ verified: [] }) },
      'CHECK_FAILED',
      /no verified attestation of its own/,
    );
  });

  it('refuses an audit that does not say what it verified', async () => {
    const old = JSON.stringify({ invalid: [], missing: [] });
    const r = await refused(root, { audit: old }, 'CHECK_FAILED', /attestation of its own/);
    expect(r.npm.words()).toContain('audit');
  });

  it('refuses a release built from another repository', async () => {
    const stranger = attested('tool', LATEST, 'https://github.com/someone/else');
    await refused(
      root,
      { audit: audit({ verified: [stranger] }) },
      'CHECK_FAILED',
      /built from https:\/\/github\.com\/someone\/else, not from https:\/\/github\.com\/example\/tool/,
    );
  });

  it('refuses a copy that names no repository to hold a release to', async () => {
    const bare = copyAt(GLOBAL, { name: 'tool', version: '1.0.0' });
    await refused(bare, {}, 'CHECK_FAILED', /a repository this copy names/);
  });

  it('refuses when the audit itself fails, and removes the folder', async () => {
    await refused(root, { audit: failure('ENETDOWN') }, 'OFFLINE', /verifying/);
    await refused(root, { fetch: failure('EINTEGRITY') }, 'CHECK_FAILED', /not what the registry/);
  });

  it('stays where it was when the install has no permission', async () => {
    const r = await updating(root, { upgrade: failure('EACCES') });
    const e = await r.going.catch((x: unknown) => x);
    expect(e).toMatchObject({
      code: 'PERMISSION_REQUIRED',
      message: expect.stringMatching(/may not write there.*; 1\.0\.0 stays$/) as unknown,
      hint: expect.stringMatching(/sudo would run the install as root/) as unknown,
    });
    expect(versionAt(root)).toBe('1.0.0');
  });

  it('does not say an old version stays when it has gone', async () => {
    const r = await updating(root, {
      upgrade: () => {
        writeFileSync(join(root, 'package.json'), '');
        throw failure('EEXIST');
      },
    });
    await expect(r.going).rejects.toThrow(/see what is there with appdyno doctor$/);
  });

  it('does not call an upgrade that changed nothing an upgrade', async () => {
    const same = await updating(root, { upgrade: 'up to date\n' });
    await expect(same.going).rejects.toThrow(/npm said it upgraded, and tool is 1\.0\.0/);
    const pnpmRoot = copyAt('pnpm/global/5/.pnpm/tool@1.0.0/node_modules/tool');
    const r = await updating(pnpmRoot, { list: JSON.stringify([{}]) });
    await expect(r.going).rejects.toThrow(/pnpm said it upgraded, and tool is undefined/);
  });

  it.each([
    ['a source checkout', 'packages/tool', /git pull/],
    ['a one-off npx run', '.npm/_npx/a9bef924/node_modules/tool', /npm install -g tool/],
    ['kept by another manager', 'homebrew/Cellar/tool/1.0.0/lib/node_modules/tool', /brew upgrade/],
    ['kept by no manager known here', 'work/node_modules/tool', /what installed it/],
  ])('refuses %s with what to do, with no network', async (by, path, instead) => {
    const copy = copyAt(path);
    if (by === 'a source checkout') {
      mkdirSync(join(copy, 'src'));
      writeFileSync(join(copy, 'src/main.ts'), '');
    }
    const r = await updating(copy);
    await expect(r.going).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: expect.stringContaining(by) as unknown,
      hint: expect.stringMatching(instead) as unknown,
    });
    expect(r.npm.calls).toEqual([]);
  });

  it('says with --check that a checkout would be refused, and still reads the latest', async () => {
    const copy = copyAt('packages/tool');
    mkdirSync(join(copy, 'src'));
    writeFileSync(join(copy, 'src/main.ts'), '');
    const r = await updating(copy, {}, true);
    expect(await r.going).toBe(0);
    expect(r.out.join('\n')).toMatch(/would refuse: tool here is a source checkout/);
    expect(r.out.join('\n')).toContain(`latest: ${LATEST}`);
  });

  it('reads the name from the package, not from this code', async () => {
    const other = copyAt('lib/node_modules/another', {
      ...MANIFEST,
      name: 'another',
    });
    const r = await updating(other, { view: view('1.0.0') });
    await r.going;
    expect(r.npm.calls[1]?.args[1]).toBe('another@latest');
  });
});
