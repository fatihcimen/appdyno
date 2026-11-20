import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import {
  holdsLines,
  MergeError,
  mergeRecords,
  prBody,
  RunRecord,
  type Contents,
  type Evidence,
} from '@appdyno/flows';
import { ToolError } from '../tool.js';
import { contentsOf, kindOf, put, writeRun, type RunFiles } from './test-record.js';

/** What a run writes at the top of its folder from its record: a merge or a copy writes its own. */
const WRITTEN = ['run.json', 'verdict.txt', 'index.html', 'junit.xml', 'pr.md'];

/** The record of the run a folder holds. */
export function readRun(dir: string): RunRecord {
  const file = join(dir, 'run.json');
  if (!existsSync(file))
    throw new ToolError(`no run.json in ${dir}: it is not a test run's folder`, 'NOT_FOUND');
  const read = RunRecord.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!read.success)
    throw new ToolError(
      `${file} is not a run's record as this version writes it`,
      'INVALID_ARGUMENT',
    );
  return read.data;
}

/**
 * A run's folder into another, the files written from the record aside, those `skip` names, and every link in it: what
 * a link leads to may be any file of this Mac, and is no part of the run. How many links it left out.
 */
function copyRun(from: string, to: string, skip: (file: string) => boolean = () => false) {
  let links = 0;
  cpSync(from, to, {
    recursive: true,
    filter: (file) => {
      // the folder named is the one a person chose, a link to it or not
      if (file !== from && lstatSync(file).isSymbolicLink()) return (links++, false);
      return !(WRITTEN.includes(relative(from, file)) || skip(file));
    },
  });
  return links;
}

/** What a copy says of the links it left out, if any. */
export const linksLine = (links: number) =>
  links > 0
    ? `left out ${String(links)} link${links === 1 ? '' : 's'}: what a link leads to may be any file of this Mac, and is no part of the run`
    : undefined;

/**
 * Several runs' folders as one, in `out`: lanes of one run or shards of one suite. Their files are copied, and one
 * record, verdict, page, JUnit and pull request text are written over them all. What cannot be one run is refused
 * before anything is written: see `mergeRecords`.
 */
export function mergeRuns(
  dirs: string[],
  out: string,
  o: RunFiles & { allowMixed?: boolean } = {},
) {
  let merged: RunRecord;
  try {
    merged = mergeRecords(dirs.map(readRun), o);
  } catch (e) {
    if (e instanceof MergeError) throw new ToolError(e.message, 'INVALID_ARGUMENT');
    throw e;
  }
  let links = 0;
  for (const dir of dirs) if (resolve(dir) !== resolve(out)) links += copyRun(dir, out);
  const record = {
    ...merged,
    command: ['appdyno', 'test', 'merge', ...dirs, '--out', out],
    contents: contentsOf(out, merged.cases, merged.contents.secretsListed),
  };
  return { record, links, ...writeRun(out, record, o) };
}

/** The kinds a copy can be made without, by the kinds of file each takes away and the evidence that named them. */
const LEAVES: Record<string, { files: (keyof Contents)[]; evidence: (keyof Evidence)[] }> = {
  video: { files: ['videos'], evidence: ['video'] },
  logs: { files: ['logs', 'crashes'], evidence: ['log', 'crash'] },
  trees: { files: ['trees'], evidence: ['tree'] },
};

/** What a folder holds, as sentences, the least hidden first: what to read before it is sent to anyone. */
export const shareLines = (r: RunRecord) => [
  'This folder holds:',
  ...holdsLines(r.contents).map((line) => `  ${line}`),
];

const kindsOf = (words: string | undefined) => {
  const kinds = (words ?? '').split(',').filter(Boolean);
  const unknown = kinds.find((k) => !Object.hasOwn(LEAVES, k));
  if (unknown)
    throw new ToolError(
      `${unknown} is no kind to leave out or keep: ${Object.keys(LEAVES).join(', ')}`,
      'INVALID_ARGUMENT',
    );
  return kinds;
};

/**
 * A run's folder packed into one zip file, the kinds `without` names left out of it and of its record and page. A
 * folder that holds a video is not packed until `with` or `without` says video: a video is not painted over, so a
 * person has to choose.
 */
export function zipRun(dir: string, file: string, o: { with?: string; without?: string } = {}) {
  const r = readRun(dir);
  const [keep, without] = [kindsOf(o.with), kindsOf(o.without)];
  if (r.contents.videos > 0 && !keep.includes('video') && !without.includes('video'))
    throw new ToolError(
      [
        ...shareLines(r),
        'a video is not painted over: say --without video to leave the videos out, or --with video to send them',
      ].join('\n'),
      'INVALID_ARGUMENT',
    );
  const left = without.flatMap((k) => LEAVES[k]?.files ?? []);
  const gone = new Set(without.flatMap((k) => LEAVES[k]?.evidence ?? []));
  const copy = mkdtempSync(join(tmpdir(), 'appdyno-share-'));
  try {
    const links = copyRun(dir, copy, (f) => left.some((kind) => kindOf(f) === kind));
    const cases = r.cases.map((c) => ({
      ...c,
      attempts: c.attempts.map((a) => ({
        ...a,
        evidence: Object.fromEntries(
          Object.entries(a.evidence).filter(([k]) => !gone.has(k as keyof Evidence)),
        ),
      })),
    }));
    const contents = {
      ...contentsOf(copy, cases, r.contents.secretsListed),
      ...(without.length > 0 && { without }),
    };
    // by the folder itself: the copy is opened wherever it is unpacked
    writeRun(copy, { ...r, cases, contents }, { named: (under) => under });
    const to = resolve(file);
    rmSync(to, { force: true });
    execFileSync('/usr/bin/zip', ['-r', '-q', to, '.'], { cwd: copy });
    return { file: to, contents, links };
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/** The pull request's text again, from the record a folder holds: `pr.md` in it unless `out` names another file. */
export function commentRun(dir: string, out = join(dir, 'pr.md')) {
  put(out, prBody(readRun(dir)));
  return resolve(out);
}
