import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { arch, loadavg, platform, release } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { osName, writeWhole, type SettingName } from '@appdyno/core';
import {
  junitXml,
  prBody,
  suitesOf,
  verdictText,
  type Contents,
  type RunCase,
  type RunRecord,
} from '@appdyno/flows';
import type { ServerContext } from '../context.js';
import type { Session } from '../session.js';
import { conditions, readCondition } from '../settings.js';
import { testPage } from './test-page.js';

/** How long a question to git may take: a run does not wait on a repository that does not answer. */
const GIT_MS = 2_000;

/** The commit a run was of, from git in `cwd`; none outside a repository. Files git does not track change nothing. */
function repoOf(cwd: string, env: NodeJS.ProcessEnv): RunRecord['repo'] {
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      timeout: GIT_MS,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  try {
    const commit = git('rev-parse', 'HEAD');
    const named = git('rev-parse', '--abbrev-ref', 'HEAD');
    // a CI job checks a commit out with no branch, and says in its environment which it was
    const branch = named === 'HEAD' ? env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME : named;
    return {
      commit,
      ...(branch && { branch }),
      dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
    };
  } catch {
    return undefined;
  }
}

/** The CI run this is part of, where its environment says so: nothing else is guessed. */
function ciOf(env: NodeJS.ProcessEnv): RunRecord['ci'] {
  if (env.GITHUB_ACTIONS !== 'true') return undefined;
  const pr = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '')?.[1];
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = env;
  return {
    provider: 'github',
    ...(server && repo && run && { runUrl: `${server}/${repo}/actions/runs/${run}` }),
    ...(pr && { pr }),
  };
}

/** What a run knows before its first device: this tool, this Mac, the commit and the CI run. */
export const runFacts = (ctx: ServerContext, cwd = process.cwd(), env = process.env) => {
  const repo = repoOf(cwd, env);
  const ci = ciOf(env);
  return {
    tool: { version: ctx.options.version ?? 'unknown' },
    host: { os: `${platform()} ${release()}`, arch: arch(), load1: loadavg()[0] ?? 0 },
    ...(repo && { repo }),
    ...(ci && { ci }),
  };
};

/** The conditions a record says a device stood in: few, and read once a run. */
const READ: SettingName[] = ['locale', 'dark_mode', 'text_size', 'orientation', 'animations'];

/** A device as the record has it, its conditions read now: one a device cannot say is left out. */
export async function deviceFacts(s: Session): Promise<RunRecord['devices'][number]> {
  const { serial, platform: os, virtual, hello } = s.device;
  const read: Record<string, string> = {};
  for (const name of READ) {
    const value = await readCondition(s, name).catch(() => undefined);
    if (value !== undefined) read[name] = value;
  }
  return {
    serial,
    name: hello?.model ?? serial,
    platform: os,
    os: hello ? osName(os, hello.osVersion) : os,
    ...(hello && { model: hello.model }),
    virtual,
    conditions: read,
  };
}

/** What this tool had changed on the device and not yet put back, each by what it was before: no device is asked. */
export const changedOn = (serial: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(conditions.read(serial) ?? {}).map(([name, c]) => [name, `was ${c.was}`]),
  );

/** The app's version and build as the device has it installed, asked once per device and app. */
export function appFacts() {
  const known = new Map<string, Promise<RunCase['app']>>();
  return (s: Session): Promise<RunCase['app']> => {
    const id = s.appId;
    if (!id) return Promise.resolve(undefined);
    const key = `${s.device.serial} ${id}`;
    const asked =
      known.get(key) ??
      (async () => {
        const { apps } = s.device;
        const info = await (
          apps.appInfo
            ? apps.appInfo(id)
            : apps.listApps(false).then((all) => all.find((a) => a.id === id))
        ).catch(() => undefined);
        return {
          id,
          ...(info?.version && { version: info.version }),
          ...(info && 'build' in info && info.build && { build: info.build }),
        };
      })();
    known.set(key, asked);
    return asked;
  };
}

const quoted = (word: string) =>
  /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;

/** The command that runs one file alone on one device. A param's value is never in it: its name is what `needs` holds. */
export const rerunOf = (
  file: string,
  serial: string,
  o: { envFile?: string; params?: Record<string, string> },
): Pick<RunCase, 'rerun' | 'needs'> => {
  const needs = Object.keys(o.params ?? {});
  return {
    rerun: [
      'appdyno',
      'test',
      file,
      ...['--device', serial],
      ...(o.envFile ? ['--env-file', o.envFile] : []),
    ]
      .map(quoted)
      .join(' '),
    ...(needs.length > 0 && { needs }),
  };
};

/** Every file under a folder, which may not be there yet. */
export const filesUnder = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((f) =>
        f.isDirectory() ? filesUnder(join(dir, f.name)) : f.isFile() ? [join(dir, f.name)] : [],
      )
    : [];

const KINDS: [keyof Contents, (file: string) => boolean][] = [
  ['shots', (f) => /^\.(jpe?g|png)$/.test(extname(f))],
  ['videos', (f) => /^\.(mp4|mov)$/.test(extname(f))],
  ['trees', (f) => basename(f) === 'tree.json'],
  ['logs', (f) => basename(f) === 'log.txt'],
  ['crashes', (f) => basename(f) === 'crash.txt'],
  ['hars', (f) => extname(f) === '.har'],
];

/** The kind of a file of a run's folder, as its contents count it. */
export const kindOf = (file: string) => KINDS.find(([, is]) => is(file))?.[0];

/** What the folder holds, counted from its files: whatever put a file there, it is said. */
export function contentsOf(dir: string, cases: RunCase[], secretsListed: number): Contents {
  const files = filesUnder(dir);
  const n = (kind: keyof Contents) => files.filter((f) => kindOf(f) === kind).length;
  return {
    shots: n('shots'),
    painted: cases
      .flatMap((c) => c.attempts)
      .filter((a) => a.evidence.shot?.endsWith('.png') === true).length,
    videos: n('videos'),
    trees: n('trees'),
    logs: n('logs'),
    crashes: n('crashes'),
    hars: n('hars'),
    bytes: files.reduce((sum, f) => sum + statSync(f).size, 0),
    secretsListed,
  };
}

/** A file of a report: whole or not at all, and for anyone the folder is given to. */
const put = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeWhole(file, text, { mode: 0o644 });
};

export type RunFiles = {
  /** Where JUnit goes: `junit.xml` in the folder unless given. */
  junit?: string;
  /** Where the pull request's text goes: `pr.md` in the folder unless given. */
  prBody?: string;
  /** False: the record and JUnit alone, as a part of a run that another merges. */
  report?: boolean;
};

/** The record alone, as a run keeps it after each case: a run that is killed leaves what it finished. */
export function saveRecord(dir: string, r: RunRecord) {
  put(join(dir, 'run.json'), `${JSON.stringify(r, null, 1)}\n`);
}

/** All a run leaves in its folder, from its record: the record, JUnit, the verdict, the page and the pull request's text. */
export function writeRun(dir: string, r: RunRecord, o: RunFiles = {}) {
  saveRecord(dir, r);
  // by the working folder, where a CI system looks for a file a report names
  const fromHere = (under: string) => {
    const path = relative(process.cwd(), join(dir, under));
    return path.startsWith('..') ? resolve(dir, under) : path;
  };
  const junit = o.junit ?? join(dir, 'junit.xml');
  put(junit, junitXml(suitesOf(r, fromHere), r.shard && `shard ${r.shard.i}/${r.shard.n}`));
  if (o.report === false) return { junit };
  put(join(dir, 'verdict.txt'), verdictText(r, fromHere));
  const page = join(dir, 'index.html');
  put(page, testPage(r));
  put(o.prBody ?? join(dir, 'pr.md'), prBody(r));
  return { junit, page: resolve(page) };
}
