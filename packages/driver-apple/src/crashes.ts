import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
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
    .filter((f) => !q.since || f.mtime >= q.since)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_OPENED);
  const out: CrashReport[] = [];
  for (const f of files) {
    const r = parseIps(await readFile(f.file, 'utf8').catch(() => ''));
    // the app's own extensions (a widget, a share sheet) are named under its id, and crash in its name
    const bundle = r?.bundle;
    if (!r || !bundle || (bundle !== q.app && !bundle.startsWith(`${q.app}.`))) continue;
    if (only && !only(r)) continue;
    const reason = bundle === q.app ? r.reason : `${r.reason}, in its extension ${bundle}`;
    out.push({ at: r.at, reason, ...(r.detail && { detail: r.detail }), file: f.file });
    if (out.length >= q.limit) break;
  }
  return out;
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
  const note = [
    ...(left.length > 0 ? [`left out ${left.join(', and ')}`] : []),
    ...[reportLimit(dir, processName)].filter((n) => n !== undefined),
  ].join('\n');
  const answer = { reports, source: SIM_SOURCE, ...(note && { note }) };
  return q.symbols ? withSymbols(answer, q.symbols) : answer;
}

type PhoneFile = {
  relativePath: string;
  metadata?: { lastModDate?: string; extendedAttributes?: { bug_type?: string } };
};

/** What an app's end leaves on a phone: a crash (309, once 109), a resource limit (385). */
const END_TYPES = new Set(['109', '309', '385']);

/** Of the phone's crash folder, what can say how an app ended, newest first. */
export function endReports(files: PhoneFile[], q: CrashesQuery): PhoneFile[] {
  const at = (f: PhoneFile) => Date.parse(f.metadata?.lastModDate ?? '') || 0;
  return files
    .filter((f) => {
      const type = f.metadata?.extendedAttributes?.bug_type;
      return (
        f.relativePath.endsWith('.ips') &&
        (!type || END_TYPES.has(type)) &&
        (!q.since || at(f) >= q.since)
      );
    })
    .sort((a, b) => at(b) - at(a))
    .slice(0, MAX_OPENED);
}

/**
 * Copies the phone's reports here (a folder per phone), then reads them as a simulator's. One by one, from a
 * list: `devicectl device copy from` of the folder stops at the first file it cannot take, and iOS leaves such
 * files there (`19:24.spindump.txt`).
 */
/** A folder may hold more than a reading opens. */
const EXIT_REPORTS = 100;

/**
 * A device's crash reports as the reading every platform gives: how the app's processes ended. A run's are told by the
 * time in each report: a query's `since` goes by a file's, which on this Mac is when it was copied here. A report with no
 * time that can be read could be of any age, so with one among them there is no reading of a run.
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

export async function phoneCrashes(ctl: Devicectl, q: CrashesQuery): Promise<CrashesAnswer> {
  const dir = join(stateDir(), 'crashes', ctl.udid);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const on = ['--device', ctl.udid, '--domain-type', 'systemCrashLogs'];
  const listed = await ctl.json(['device', 'info', 'files', ...on]);
  const files = (listed.result as { files?: PhoneFile[] } | undefined)?.files ?? [];
  for (const f of endReports(files, q)) {
    callSignal()?.throwIfAborted();
    const local = join(dir, f.relativePath);
    if (existsSync(local)) continue;
    await mkdir(dirname(local), { recursive: true, mode: 0o700 });
    await ctl.json([
      'device',
      'copy',
      'from',
      ...on,
      '--source',
      f.relativePath,
      '--destination',
      local,
    ]);
  }
  const answer = { reports: await reportsIn(dir, q), source: 'devicectl systemCrashLogs' };
  return q.symbols ? withSymbols(answer, q.symbols) : answer;
}
