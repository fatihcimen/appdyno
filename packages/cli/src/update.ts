import { ToolError } from '@appdyno/ops';
import {
  installedBy,
  manifestOf,
  repositoryOf,
  said,
  type Installed,
  type Manager,
  type Manifest,
} from './installed.js';
import {
  call,
  compareVersions,
  failed,
  install,
  isRelease,
  latestRelease,
  MIN_NPM,
  npmVersion,
  refuse,
  verifyRelease,
  type Run,
} from './release.js';

export type UpdateOptions = {
  /** The real path of this package: given, as what is running knows where it is and this file does not. */
  root: string;
  run: Run;
  out: (line: string) => void;
  /** Where a release is verified; the system's temporary folder by default. */
  tmp?: string;
};

const AFTER = [
  'a running MCP server keeps the old code until its client restarts it: restart the client',
  "a device's agent and runner need nothing: the next connection replaces them by their hash",
];

const SEE_DOCTOR = 'see what is there with appdyno doctor';

const notHere = (name: string, place: Exclude<Installed, Manager>) =>
  refuse(`${name} here is ${place.by}`, 'UNSUPPORTED', place.instead);

/** Words when nothing is to be done, a refusal, or the manager that goes on. */
function verdict(
  me: Manifest,
  place: Installed,
  latest: Awaited<ReturnType<typeof latestRelease>>,
  npm: string,
) {
  if (!isRelease(latest.version))
    return refuse(
      `the registry's latest is a prerelease, ${latest.version}`,
      'UNSUPPORTED',
      `only a release is installed: ${me.version} stays`,
    );
  const order = compareVersions(me.version, latest.version);
  if (order === 0) return `${me.version} is the latest release`;
  if (order > 0) return `${me.version} is newer than the latest release: this never goes back`;
  if ('instead' in place) return notHere(me.name, place);
  if (!latest.attested)
    return refuse(
      `${me.name}@${latest.version} has no provenance attestation`,
      'CHECK_FAILED',
      `it is not installed: ${me.version} stays`,
    );
  if (compareVersions(npm, MIN_NPM) < 0)
    return refuse(
      `npm ${npm} cannot say which package it verified`,
      'CHECK_FAILED',
      `npm ${MIN_NPM} or newer can: npm install -g npm@latest`,
    );
  return place;
}

/** The version the manager has now, to tell an upgrade from one that only said so. */
async function versionNow(root: string, name: string, place: Manager, run: Run) {
  if (place.by === 'npm') return manifestOf(root).version;
  const [global] = JSON.parse(
    await call(run, 'pnpm', ['ls', '--global', '--json', '--depth', '0']),
  ) as { dependencies?: Record<string, { version: string }> }[];
  return global?.dependencies?.[name]?.version;
}

const stays = (root: string, version: string) => {
  try {
    return manifestOf(root).version === version;
  } catch {
    return false;
  }
};

async function upgrade(o: UpdateOptions, me: Manifest, version: string, place: Manager) {
  const { name } = me;
  const spec = `${name}@${version}`;
  o.out(`verifying ${spec} in a temporary folder`);
  const built = await verifyRelease({ name, version, repository: repositoryOf(me) }, o.run, o.tmp);
  o.out(`verified: ${spec}, built from ${built}`);
  o.out(`upgrading with ${place.by}`);
  try {
    await install(place, spec, o.run);
  } catch (e) {
    const why = failed(e, `upgrading with ${place.by}`);
    const left = stays(o.root, me.version) ? `${me.version} stays` : SEE_DOCTOR;
    throw new ToolError(`${why.message}; ${left}`, why.code, why.hint);
  }
  const now = await versionNow(o.root, name, place, o.run);
  if (now !== version)
    throw refuse(`${place.by} said it upgraded, and ${name} is ${now}`, 'CHECK_FAILED', SEE_DOCTOR);
}

/** `appdyno update`: verified before anything changes, by what keeps this copy. Exit code 0; a refusal throws. */
export async function update(o: UpdateOptions & { check?: boolean | undefined }): Promise<number> {
  const me = manifestOf(o.root);
  const place = installedBy(o.root, me.name);
  // a refusal that needs no network does not wait for one
  if (!o.check && 'instead' in place) throw notHere(me.name, place);
  o.out(`installed: ${me.version}, ${said(place)}, at ${o.root}`);
  const npm = await npmVersion(o.run);
  const latest = await latestRelease(me.name, o.run);
  o.out(`latest: ${latest.version}`);
  const next = verdict(me, place, latest, npm);
  if (typeof next === 'string') o.out(`nothing to do: ${next}`);
  else if (next instanceof ToolError) {
    if (!o.check) throw next;
    o.out(`would refuse: ${next.message}`);
    o.out(`  ${next.hint}`);
  } else if (o.check) {
    const spec = `${me.name}@${latest.version}`;
    o.out(`would verify ${spec}, then upgrade it with ${next.by}; nothing was changed`);
  } else {
    await upgrade(o, me, latest.version, next);
    o.out(`updated: ${me.version} to ${latest.version}`);
    AFTER.forEach((line) => o.out(line));
  }
  return 0;
}
