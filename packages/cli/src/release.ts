import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolError } from '@appdyno/ops';
import type { Manager } from './installed.js';

/** A program on this Mac, as `run` of `@appdyno/core`: given, so that a test starts none. */
export type Run = (
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr?: string }>;

const READ_MS = 60_000;
const INSTALL_MS = 600_000;
/** The first npm whose audit names what it verified. */
export const MIN_NPM = '11.12.0';

const RELEASE = /^\d+\.\d+\.\d+$/;
const NETWORK = /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|ENETDOWN)\b/;
/** A SLSA statement's version of the provenance `npm publish --provenance` writes. */
const PROVENANCE = 'https://slsa.dev/provenance/v1';

/** A refusal as the command line prints it: what happened with its code, then what to do. */
export const refuse = (what: string, code: ToolError['code'], hint: string) =>
  new ToolError(`${what} (${code})`, code, hint);

/** From a folder of no project: a project's own `.npmrc` must not choose where a release comes from. */
export const call = async (
  run: Run,
  file: string,
  args: string[],
  { timeout = READ_MS, cwd = tmpdir() } = {},
) => (await run(file, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024 })).stdout;

/** A manager's failure in words, by the code it gave. */
export function failed(e: unknown, doing: string): ToolError {
  if (e instanceof ToolError) return e;
  const {
    code,
    killed,
    stdout = '',
    stderr = '',
  } = e as NodeJS.ErrnoException & {
    killed?: boolean;
    stdout?: string;
    stderr?: string;
  };
  const said = `${stdout}\n${stderr}`;
  if (killed) return refuse(`${doing} took too long`, 'TIMEOUT', 'try again');
  if (code === 'ENOENT')
    return refuse(`${doing}: the program is not on PATH`, 'UNSUPPORTED', 'put it on PATH');
  if (/\bE404\b|FETCH_404/.test(said))
    return refuse(
      `${doing}: the registry has no such package`,
      'NOT_FOUND',
      'it is not published there yet, or npm is set to another registry',
    );
  if (/\b(EACCES|EPERM)\b/.test(said))
    return refuse(
      `${doing}: this user may not write there`,
      'PERMISSION_REQUIRED',
      'give that folder to this user, or install under a prefix of your own: sudo would run the install as root',
    );
  if (NETWORK.test(said))
    return refuse(`${doing}: the registry cannot be reached`, 'OFFLINE', 'try again when online');
  if (/\bEINTEGRITY\b/.test(said))
    return refuse(
      `${doing}: the download is not what the registry says it is`,
      'CHECK_FAILED',
      'nothing was changed: do not install this by hand',
    );
  const line = /^npm error (?!code\b).*$/m.exec(said)?.[0] ?? said.trim().split('\n')[0] ?? '';
  return refuse(`${doing}: ${line.slice(0, 200)}`, 'UNSUPPORTED', 'see what the manager says');
}

/** Below 0 when `a` is older. A prerelease comes before its own release. */
export function compareVersions(a: string, b: string) {
  const [coreA = '', preA] = a.split('-');
  const [coreB = '', preB] = b.split('-');
  return coreA.localeCompare(coreB, 'en', { numeric: true }) || Number(!preA) - Number(!preB);
}

export const isRelease = (version: string) => RELEASE.test(version);

export const npmVersion = (run: Run) =>
  call(run, 'npm', ['--version'])
    .then((said) => said.trim())
    .catch((e: unknown) => {
      throw failed(e, 'asking npm its version, which verifying a release needs');
    });

/** What the registry calls latest, and whether it says that release has provenance. */
export async function latestRelease(name: string, run: Run, timeout = READ_MS) {
  const said = await call(run, 'npm', ['view', `${name}@latest`, 'version', 'dist', '--json'], {
    timeout,
  }).catch((e: unknown) => {
    throw failed(e, `asking the registry for ${name}`);
  });
  const { version, dist } = readJson<{
    version: string;
    dist?: { attestations?: { provenance?: unknown } };
  }>(said, `the registry's answer for ${name}`);
  return { version, attested: dist?.attestations?.provenance !== undefined };
}

function readJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw refuse(`${what} is not JSON`, 'UNSUPPORTED', 'see what npm says with the same words');
  }
}

type Package = { name: string; version: string };
type Audit = {
  invalid?: Package[];
  missing?: Package[];
  verified?: (Package & {
    attestationBundles?: { predicateType: string; bundle: { dsseEnvelope: { payload: string } } }[];
  })[];
};
type Statement = {
  predicate?: { buildDefinition?: { externalParameters?: { workflow?: { repository?: string } } } };
};
export type Wanted = Package & { repository: string | undefined };

/** Where the provenance npm verified says a package was built. */
function builtFrom(entry: NonNullable<Audit['verified']>[number]) {
  const found = entry.attestationBundles?.find((b) => b.predicateType === PROVENANCE);
  if (!found) return undefined;
  const statement = readJson<Statement>(
    Buffer.from(found.bundle.dsseEnvelope.payload, 'base64').toString(),
    `the provenance of ${entry.name}`,
  );
  return statement.predicate?.buildDefinition?.externalParameters?.workflow?.repository;
}

const names = (list: Package[]) => list.map((p) => `${p.name}@${p.version}`).join(', ');

/** Holds only for an attestation npm verified on this very release, from the project's own repository. */
function holds({ invalid = [], missing = [], verified = [] }: Audit, wanted: Wanted) {
  const spec = `${wanted.name}@${wanted.version}`;
  const hint = 'nothing was changed: wait for a release that passes';
  if (invalid.length > 0)
    throw refuse(`bad signature or attestation: ${names(invalid)}`, 'CHECK_FAILED', hint);
  if (missing.length > 0) throw refuse(`no signature: ${names(missing)}`, 'CHECK_FAILED', hint);
  const own = verified.find((p) => p.name === wanted.name && p.version === wanted.version);
  if (!own) {
    const others = verified.length > 0 ? ` (only ${names(verified)})` : '';
    throw refuse(`${spec} has no verified attestation of its own${others}`, 'CHECK_FAILED', hint);
  }
  const built = builtFrom(own);
  if (!wanted.repository || built !== wanted.repository)
    throw refuse(
      `${spec} was built from ${built ?? 'nowhere it says'}, not from ${wanted.repository ?? 'a repository this copy names'}`,
      'CHECK_FAILED',
      hint,
    );
  return built;
}

/**
 * That a release is what it claims, before anything on this machine changes: the exact version in a
 * folder of its own with none of its scripts run, then npm's own check of signatures and attestations.
 * npm exits 0 for a package with no attestation, and counts a dependency's: only its list of what it
 * verified tells them apart. Where it was built; refused otherwise.
 */
export async function verifyRelease(wanted: Wanted, run: Run, tmp = tmpdir()) {
  const spec = `${wanted.name}@${wanted.version}`;
  const dir = await mkdtemp(join(tmp, 'appdyno-update-'));
  const inDir = { cwd: dir, timeout: INSTALL_MS };
  const quiet = ['--ignore-scripts', '--no-audit', '--no-fund'];
  try {
    await writeFile(join(dir, 'package.json'), '{ "private": true }\n');
    await call(run, 'npm', ['install', ...quiet, '--save-exact', spec], inDir);
    const said = await call(
      run,
      'npm',
      ['audit', 'signatures', '--json', '--include-attestations'],
      inDir,
    ).catch((e: unknown) => {
      // it exits 1 with its verdict on stdout, and with nothing there when it could not give one
      const { stdout } = e as { stdout?: string };
      if (stdout?.includes('"invalid"')) return stdout;
      throw e;
    });
    return holds(readJson<Audit>(said, `npm's audit of ${spec}`), wanted);
  } catch (e) {
    throw failed(e, `verifying ${spec}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The exact version, by the manager that keeps this copy. npm takes it from what it just verified. */
export function install(place: Manager, spec: string, run: Run) {
  const args =
    place.by === 'npm'
      ? [
          'install',
          '--global',
          '--prefix',
          place.prefix,
          // from npm's cache, so that the tarball is the one verified, not the registry's of this moment
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          spec,
        ]
      : ['add', '--global', '--ignore-scripts', spec];
  return call(run, place.by, args, { timeout: INSTALL_MS });
}
