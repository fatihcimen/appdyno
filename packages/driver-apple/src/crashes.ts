import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callSignal,
  stateDir,
  type CrashesAnswer,
  type CrashesQuery,
  type CrashReport,
  type ExitReading,
  type Measured,
} from '@appdyno/core';
import type { Devicectl } from './devicectl.js';
import { withSymbols } from './symbols.js';

/** A folder holds every app's reports: only so many are opened per query. */
const MAX_OPENED = 200;
const FRAMES = 6;

type Ips = {
  bundle?: string;
  at: string;
  /** When it crashed, in ms: its capture's time, else the report's (written seconds after); 0 when it says none. */
  time: number;
  reason: string;
  detail?: string;
  procPath?: string;
  /** A simulator's process runs in a coalition named after it, the system's own apps too, whose path names none. */
  coalition?: string;
};

/** A `.ips` crash report: one line of JSON (the header), then JSON (the report). */
export function parseIps(text: string): Ips | undefined {
  const nl = text.indexOf('\n');
  if (nl < 0) return undefined;
  try {
    const head = JSON.parse(text.slice(0, nl)) as {
      bundleID?: string;
      timestamp?: string;
      bug_type?: string;
    };
    const body = JSON.parse(text.slice(nl + 1)) as {
      captureTime?: string;
      procPath?: string;
      exception?: { type?: string; signal?: string; subtype?: string };
      termination?: { indicator?: string; namespace?: string };
      faultingThread?: number;
      usedImages?: { name?: string }[];
      threads?: { frames?: { imageIndex?: number; symbol?: string }[] }[];
      lastExceptionBacktrace?: { imageIndex?: number; symbol?: string }[];
      asi?: Record<string, string[]>;
      bundleInfo?: { CFBundleIdentifier?: string };
      coalitionName?: string;
    };
    const ex = body.exception;
    // an uncaught exception ends in abort(): where it was thrown says why, past the throw's own frames
    const frames =
      body.lastExceptionBacktrace?.filter(
        (f) => !['__exceptionPreprocess', 'objc_exception_throw'].includes(f.symbol ?? ''),
      ) ??
      body.threads?.[body.faultingThread ?? 0]?.frames ??
      [];
    const detail = frames
      .slice(0, FRAMES)
      .map((f) => `${body.usedImages?.[f.imageIndex ?? -1]?.name ?? '?'} ${f.symbol ?? ''}`.trim())
      .join('\n');
    const bundle = head.bundleID ?? body.bundleInfo?.CFBundleIdentifier;
    // a phone's report has the exception's reason among what the system noted of the crash; a simulator's does not
    const said = Object.values(body.asi ?? {})
      .flat()
      .find((l) => /exception|fatal error/i.test(l));
    const signal = [ex?.type, ex?.signal, body.termination?.indicator].filter(Boolean).join(' ');
    return {
      ...(bundle && { bundle }),
      at: head.timestamp ?? '',
      time: Date.parse(body.captureTime ?? head.timestamp ?? '') || 0,
      reason:
        [signal, said].filter(Boolean).join(', ') || `report of type ${head.bug_type ?? 'unknown'}`,
      ...(detail && { detail }),
      ...(body.procPath && { procPath: body.procPath }),
      ...(body.coalitionName && { coalition: body.coalitionName }),
    };
  } catch {
    return undefined;
  }
}

/** The app's own, or one of its extensions (a widget, a share sheet), named under its id. */
const ofApp = (bundle: string | undefined, app: string) =>
  bundle === app || !!bundle?.startsWith(`${app}.`);

/** The reports of `q.app` in `dir`, newest first; `only` keeps a simulator's own (others run from their own folder). */
export async function reportsIn(
  dir: string,
  q: CrashesQuery,
  only?: (r: Ips) => boolean,
): Promise<CrashReport[]> {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true }) as string[];
  } catch {
    return [];
  }
  const files = names
    .filter((n) => n.endsWith('.ips'))
    .map((n) => {
      const file = join(dir, n);
      return { file, mtime: statSync(file).mtimeMs };
    })
    // a file is written after its crash and only touched since: one older than `since` holds none newer
    .filter((f) => !q.since || f.mtime >= q.since)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_OPENED);
  const out: { time: number; report: CrashReport }[] = [];
  for (const f of files) {
    const r = parseIps(await readFile(f.file, 'utf8').catch(() => ''));
    // the app's own extensions crash in its name
    const bundle = r?.bundle;
    if (!r || !bundle || !ofApp(bundle, q.app) || (q.own && bundle !== q.app)) continue;
    // by the crash's own time: macOS at its limit moves an old report's file time on at each new crash
    if (q.since && r.time < q.since) continue;
    if (only && !only(r)) continue;
    const reason = bundle === q.app ? r.reason : `${r.reason}, in its extension ${bundle}`;
    const report = { at: r.at, reason, ...(r.detail && { detail: r.detail }), file: f.file };
    out.push({ time: r.time, report });
  }
  return out
    .sort((a, b) => b.time - a.time)
    .slice(0, q.limit)
    .map((o) => o.report);
}

const SIM_SOURCE = '~/Library/Logs/DiagnosticReports';

/** macOS saves no crash report of a process that has as many in the folder: "the limit of 25 logs has been reached". */
const KEPT_REPORTS = 25;

/** What keeps a crash of the process `name` from leaving a report: the folder holds as many of its own as macOS keeps. */
function reportLimit(dir: string, name: string | undefined) {
  if (!name) return undefined;
  let held: number;
  try {
    held = readdirSync(dir).filter((n) => n.startsWith(`${name}-`) && n.endsWith('.ips')).length;
  } catch {
    return undefined;
  }
  return held >= KEPT_REPORTS
    ? `this Mac holds ${String(held)} crash reports of ${name}, and macOS saves none past ${String(KEPT_REPORTS)}: a crash now leaves no report. Move ${name}-*.ips out of ${SIM_SOURCE}, and the next one is kept`
    : undefined;
}

/** The simulator a report names: by the app's path, or by its coalition, which a system app's has as well. */
const simulatorOf = (r: Ips) =>
  /\/Devices\/([0-9A-F-]{36})\//.exec(r.procPath ?? '')?.[1] ??
  /^com\.apple\.CoreSimulator\.SimDevice\.([0-9A-F-]{36})$/.exec(r.coalition ?? '')?.[1];

/**
 * A simulator's reports are on the Mac, every simulator's in one folder: only what names this one is its own. What was
 * left out is said in the note, as a report that names no simulator could be any one's, this one's too.
 */
export async function simulatorCrashes(
  udid: string,
  q: CrashesQuery,
  dir = join(homedir(), 'Library/Logs/DiagnosticReports'),
  /** The app's process, by which macOS names its reports and keeps count of them. */
  processName?: string,
): Promise<CrashesAnswer> {
  let others = 0;
  let unnamed = 0;
  const reports = await reportsIn(dir, q, (r) => {
    const named = simulatorOf(r);
    if (named === udid) return true;
    if (named) others++;
    else unnamed++;
    return false;
  });
  const left = [
    ...(others > 0 ? [`${others} of another simulator`] : []),
    ...(unnamed > 0
      ? [`${unnamed} that name no simulator, so none could be told to be this one's`]
      : []),
  ];
  const unkept = reportLimit(dir, processName);
  const note = [
    ...(left.length > 0 ? [`left out ${left.join(', and ')}`] : []),
    ...(unkept ? [unkept] : []),
  ].join('\n');
  const answer = { reports, source: SIM_SOURCE, ...(note && { note }), ...(unkept && { unkept }) };
  return q.symbols ? withSymbols(answer, q.symbols) : answer;
}

type PhoneFile = {
  relativePath: string;
  metadata?: { lastModDate?: string; extendedAttributes?: { bug_type?: string } };
};

/** What an app's end leaves on a phone: a crash (309, once 109), a resource limit (385). */
const END_TYPES = new Set(['109', '309', '385']);

/**
 * Of the phone's crash folder, what can say how the app's process `name` ended, newest first. A phone names a report
 * after its process: `Shop-2026-11-17-101500.ips`, and `Shop.cpu_resource-….ips` for a resource limit.
 */
export function endReports(files: PhoneFile[], q: CrashesQuery, name: string): PhoneFile[] {
  const at = (f: PhoneFile) => Date.parse(f.metadata?.lastModDate ?? '') || 0;
  return files
    .filter((f) => {
      const type = f.metadata?.extendedAttributes?.bug_type;
      const file = basename(f.relativePath);
      return (
        (file.startsWith(`${name}-`) || file.startsWith(`${name}.`)) &&
        file.endsWith('.ips') &&
        (!type || END_TYPES.has(type)) &&
        (!q.since || at(f) >= q.since)
      );
    })
    .sort((a, b) => at(b) - at(a))
    .slice(0, MAX_OPENED);
}

/** A folder may hold more than a reading opens. */
const EXIT_REPORTS = 100;

/**
 * A device's crash reports as the reading every platform gives: how the app's processes ended. A run's are told by the
 * time in each report, of all it holds, which are asked for with no `since`. A report with no time that can be read
 * could be of any age, so with one among them there is no reading of a run.
 */
export async function crashExits(
  crashes: (q: CrashesQuery) => Promise<CrashesAnswer>,
  bundle: string,
  since?: number,
): Promise<Measured<ExitReading>> {
  const { reports, source } = await crashes({ app: bundle, limit: EXIT_REPORTS });
  const times = reports.map((r) => Date.parse(r.at));
  const fresh = times.filter((t) => since !== undefined && t >= since).length;
  return {
    value: {
      ...(since !== undefined &&
        !times.some(Number.isNaN) && { run: { crashes: fresh, total: fresh } }),
      held: {
        crashes: reports.length,
        total: reports.length,
        ...(reports.length >= EXIT_REPORTS && { atLeast: true }),
      },
      recent: reports.slice(0, 10).map((r) => ({
        at: r.at,
        reason: r.reason,
        ...(r.detail && { description: r.detail }),
      })),
    },
    raw: source,
    at: new Date().toISOString(),
  };
}

/** The files under `dir`, at any depth. */
const filesUnder = (dir: string) =>
  (readdirSync(dir, { recursive: true }) as string[])
    .map((n) => join(dir, n))
    .filter((p) => statSync(p, { throwIfNoEntry: false })?.isFile());

/** Whether a copied report is the app's; another's is deleted. Another app's process may have its name: every Flutter app's is `Runner`. */
async function keptIfOwn(file: string, app: string) {
  if (ofApp(parseIps(await readFile(file, 'utf8').catch(() => ''))?.bundle, app)) return true;
  await rm(file, { force: true });
  return false;
}

/**
 * A version before 1.3.0 copied every process's reports here: before the first read since, what is not the app's goes,
 * once. Which other apps were asked about then was not kept, and what the phone still holds of one is copied again.
 */
async function sweptOnce(dir: string, app: string) {
  const swept = join(dir, '.swept');
  if (existsSync(swept)) return;
  for (const file of filesUnder(dir)) if (file.endsWith('.ips')) await keptIfOwn(file, app);
  await writeFile(swept, '', { mode: 0o600 });
}

/**
 * Copies the app's reports from the phone here (a folder per phone), then reads them as a simulator's. Only those named
 * after its process, as the phone's folder holds every process's: an extension's are named after its own, which the
 * phone does not say, so they are not copied. One by one, from a list: `devicectl device copy from` of the folder stops
 * at the first file it cannot take, and iOS leaves such files there (`19:24.spindump.txt`).
 */
export async function phoneCrashes(ctl: Devicectl, q: CrashesQuery): Promise<CrashesAnswer> {
  const dir = join(stateDir(), 'crashes', ctl.udid);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await sweptOnce(dir, q.app);
  // a report waits apart until it is known to be the app's: what a process killed there left goes
  for (const n of readdirSync(dir))
    if (n.startsWith('.part-')) await rm(join(dir, n), { recursive: true, force: true });
  const part = join(dir, `.part-${String(process.pid)}`);
  // the app's process, as its bundle's folder is named (`Shop.app`), as on a simulator
  const url = (await ctl.app(q.app))?.url;
  const name = url && basename(fileURLToPath(url), '.app');
  if (name) {
    const on = ['--device', ctl.udid, '--domain-type', 'systemCrashLogs'];
    const listed = await ctl.json(['device', 'info', 'files', ...on]);
    const files = (listed.result as { files?: PhoneFile[] } | undefined)?.files ?? [];
    try {
      for (const f of endReports(files, q, name)) {
        callSignal()?.throwIfAborted();
        const local = join(dir, f.relativePath);
        // shortcut: another app's report of the same process name is copied at each read, to be deleted again; keep a list of them if that is ever slow
        if (existsSync(local)) continue;
        await rm(part, { recursive: true, force: true });
        await mkdir(part, { mode: 0o700 });
        await ctl.json([
          'device',
          'copy',
          'from',
          ...on,
          '--source',
          f.relativePath,
          '--destination',
          join(part, basename(f.relativePath)),
        ]);
        // devicectl writes the file at the path it is given, or in a folder of that name: whichever, it is the one file
        const got = filesUnder(part)[0];
        if (!got || !(await keptIfOwn(got, q.app))) continue;
        await mkdir(dirname(local), { recursive: true, mode: 0o700 });
        await rename(got, local);
      }
    } finally {
      await rm(part, { recursive: true, force: true });
    }
  }
  const answer = {
    reports: await reportsIn(dir, q),
    source: 'devicectl systemCrashLogs',
    ...(!name && {
      note: `${q.app} is not on this phone, and its reports are named after its process: none was copied`,
    }),
  };
  return q.symbols ? withSymbols(answer, q.symbols) : answer;
}
