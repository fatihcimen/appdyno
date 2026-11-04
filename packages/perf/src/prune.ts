import { existsSync } from 'node:fs';
import { appendFile, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { loadBaseline, readRun, runFiles, runKeys, type RunKey } from './store.js';
import type { PerfRecord } from './record.js';

/** What a limit of nothing asked for is: a phone's trace is tens of MB, and the Mac's disk is not ours. */
export const DEFAULT_TRACE_LIMIT_GB = 10;

/** A run's trace stays while the run is one of its key's newest this many, which is what a trend shows. */
const RECENT_RUNS = 30;
/** Nothing younger goes: `perf_query` may be about to read it, and it may not be a run's yet. */
const GRACE_MS = 86_400_000;

const TRACE = /\.(?:pftrace|perfetto-trace|trace|xcresult)$/;
const HEAP = /\.(?:hprof|memgraph)$/;
const NAMED = /[\w.-]+\.(?:pftrace|perfetto-trace|trace|xcresult|hprof|memgraph)\b/g;

export type PruneOptions = {
  /**
   * The one folder all of it goes by: the runs read are its `measurements`, and nothing outside it is ever removed. The
   * traces of a state folder are its own runs' to name, so no other folder's runs can speak for them.
   */
  state: string;
  /** Where this project's baselines are. */
  project: string;
  limitBytes: number;
  dryRun?: boolean;
};

export type PruneReport = {
  limitBytes: number;
  /** All of it, before and after. */
  beforeBytes: number;
  afterBytes: number;
  /** What went, or on a dry run what would have. */
  removed: { name: string; bytes: number }[];
  /** Still over the limit with nothing left that may go. */
  over: boolean;
  /** Why nothing went: what names the traces could not be read, so none of them can be called free. */
  stopped?: string;
  /** Every removal, with its time and size. */
  log: string;
};

/** What stops a prune: not knowing what is needed is never the same as nothing being needed. */
class Unread extends Error {}

const fileOf = (state: string) => ({
  traces: join(state, 'traces'),
  measurements: join(state, 'measurements'),
  pins: join(state, 'traces-pinned.json'),
  log: join(state, 'traces-pruned.log'),
});

/** What a path holds, its folders walked: a symbolic link counts as itself. */
async function sizeOf(path: string): Promise<number> {
  const info = await lstat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const n of await readdir(path)) total += await sizeOf(join(path, n));
  return total;
}

const textOf = (file: string) =>
  readFile(file, 'utf8').catch(() => {
    throw new Unread(`cannot read ${file}`);
  });

/** What a run's records lead to: `raw` is its measurement, or in an older record the trace itself. */
async function namedBy(records: PerfRecord[]): Promise<string[]> {
  const names: string[] = [];
  for (const raw of new Set(records.map((r) => r.raw).filter(Boolean))) {
    names.push(basename(raw));
    if (!raw.endsWith('.txt')) continue;
    const text = `${await textOf(raw)}\n${await textOf(raw.replace(/\.txt$/, '.json'))}`;
    for (const [name] of text.matchAll(NAMED)) names.push(name);
  }
  return names;
}

const pinned = async (pins: string) => {
  if (!existsSync(pins)) return new Set<string>();
  const list = JSON.parse(await textOf(pins)) as unknown;
  if (!Array.isArray(list)) throw new Unread(`${pins} is not a list`);
  return new Set(list as string[]);
};

/**
 * What a baseline took stays whichever project asks: one project cannot see another's baselines, so each says what it
 * took, at the moment it takes it. A baseline dropped later keeps its pins, which is only a trace kept for longer.
 */
export async function pinBaseline(state: string, records: PerfRecord[]) {
  const { pins } = fileOf(state);
  const held = await pinned(pins);
  for (const name of await namedBy(records)) held.add(name);
  await mkdir(state, { recursive: true });
  await writeFile(pins, JSON.stringify([...held]));
}

/** A key's run files a baseline took its numbers from: a run file's name begins with its time. */
const inBaseline = async (project: string, k: RunKey) => {
  const b = await loadBaseline(project, k).catch(() => {
    throw new Unread(`cannot read the baseline of ${k.scenario}`);
  });
  const times = Object.values(b?.metrics ?? {}).flatMap((m) => m.runs.map((r) => r.at));
  return times.map((at) => at.replace(/[:.]/g, '-'));
};

/**
 * The names of what kept runs need. A baseline holds samples and no path, and a run names only its measurement, so it
 * goes baseline to run by the run's time, run to measurement by its `raw`, and measurement to trace by the text of both
 * its files. Any of those it cannot read, or no run at all, is `Unread`.
 */
async function namedByRuns(dir: string, project: string): Promise<Set<string>> {
  const names = new Set<string>();
  const keys = await runKeys(dir);
  if (keys.length === 0) throw new Unread(`no kept runs in ${dir} to go by`);
  for (const key of keys) {
    const files = await runFiles(dir, key);
    const times = await inBaseline(project, key);
    const recent = new Set(files.slice(-RECENT_RUNS));
    for (const file of files) {
      if (!recent.has(file) && !times.some((t) => file.startsWith(t))) continue;
      const records = await readRun(dir, key, file).catch(() => {
        throw new Unread(`cannot read the run ${file}`);
      });
      if (!Array.isArray(records)) throw new Unread(`the run ${file} is no list of records`);
      for (const name of await namedBy(records)) names.add(name);
    }
  }
  return names;
}

/** The entries of a folder that match, as paths; none for a folder that is not there. A linked folder is not walked. */
const entries = async (dir: string, kind: RegExp) => {
  if (!existsSync(dir)) return [];
  if ((await lstat(dir)).isSymbolicLink()) throw new Unread(`${dir} is a link`);
  return (await readdir(dir)).filter((n) => kind.test(n)).map((n) => join(dir, n));
};

/** Refuses what is not a direct entry of the state folder's two: the last check before anything goes. */
function assertInside(state: string, path: string) {
  const root = resolve(state);
  const parent = resolve(path, '..');
  if (parent !== join(root, 'traces') && parent !== join(root, 'measurements'))
    throw new Error(`refusing to remove ${path}: it is not in ${root}${sep}`);
}

/**
 * Down to the limit, oldest first, and never what a baseline or a recent run names, or what is under a day old. It goes
 * by one state folder and removes only in it. With no kept run to go by, or any of it unreadable, it removes nothing and
 * says why. Each removal is logged as it happens; a dry run lists the same and touches nothing.
 */
export async function pruneTraces(o: PruneOptions): Promise<PruneReport> {
  const f = fileOf(o.state);
  const report = (beforeBytes: number, removed: PruneReport['removed'], stopped?: string) => {
    const afterBytes = beforeBytes - removed.reduce((a, r) => a + r.bytes, 0);
    return {
      limitBytes: o.limitBytes,
      beforeBytes,
      afterBytes,
      removed,
      over: afterBytes > o.limitBytes,
      ...(stopped && { stopped }),
      log: f.log,
    };
  };
  let paths: string[];
  try {
    paths = [...(await entries(f.traces, TRACE)), ...(await entries(f.measurements, HEAP))];
  } catch (e) {
    if (e instanceof Unread) return report(0, [], e.message);
    throw e;
  }
  const held = await Promise.all(
    paths.map(async (path) => {
      const info = await lstat(path);
      return { path, bytes: await sizeOf(path), ms: info.mtimeMs, link: info.isSymbolicLink() };
    }),
  );
  const beforeBytes = held.reduce((a, e) => a + e.bytes, 0);
  if (beforeBytes <= o.limitBytes) return report(beforeBytes, []);
  let named: Set<string>;
  try {
    named = await pinned(f.pins);
    for (const name of await namedByRuns(f.measurements, o.project)) named.add(name);
  } catch (e) {
    if (e instanceof Unread || e instanceof SyntaxError)
      return report(beforeBytes, [], (e as Error).message);
    throw e;
  }
  const young = Date.now() - GRACE_MS;
  const mayGo = (e: (typeof held)[number]) =>
    !e.link && e.ms < young && !named.has(basename(e.path));
  let left = beforeBytes;
  const removed: PruneReport['removed'] = [];
  for (const e of held.filter(mayGo).sort((a, b) => a.ms - b.ms)) {
    if (left <= o.limitBytes) break;
    assertInside(o.state, e.path);
    if (!o.dryRun) {
      await rm(e.path, { recursive: true, force: true });
      await appendFile(f.log, `${new Date().toISOString()}\t${e.bytes}\t${basename(e.path)}\n`);
    }
    left -= e.bytes;
    removed.push({ name: basename(e.path), bytes: e.bytes });
  }
  return report(beforeBytes, removed);
}
