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
      bundleInfo?: { CFBundleIdentifier?: string };
    };
    const ex = body.exception;
    const frames = body.threads?.[body.faultingThread ?? 0]?.frames ?? [];
    const detail = frames
      .slice(0, FRAMES)
      .map((f) => `${body.usedImages?.[f.imageIndex ?? -1]?.name ?? '?'} ${f.symbol ?? ''}`.trim())
      .join('\n');
    const bundle = head.bundleID ?? body.bundleInfo?.CFBundleIdentifier;
    return {
      ...(bundle && { bundle }),
      at: head.timestamp ?? '',
      reason:
        [ex?.type, ex?.signal, body.termination?.indicator].filter(Boolean).join(' ') ||
        `report of type ${head.bug_type ?? 'unknown'}`,
      ...(detail && { detail }),
      ...(body.procPath && { procPath: body.procPath }),
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
    if (!r || r.bundle !== q.app || (only && !only(r))) continue;
    out.push({ at: r.at, reason: r.reason, ...(r.detail && { detail: r.detail }), file: f.file });
    if (out.length >= q.limit) break;
  }
  return out;
}

const SIM_SOURCE = '~/Library/Logs/DiagnosticReports';

/** A simulator's reports are on the Mac; a report names the simulator through the app's path, a system app does not. */
export async function simulatorCrashes(
  udid: string,
  q: CrashesQuery,
  dir = join(homedir(), 'Library/Logs/DiagnosticReports'),
): Promise<CrashesAnswer> {
  const reports = await reportsIn(dir, q, (r) => {
    const other = /\/Devices\/([0-9A-F-]{36})\//.exec(r.procPath ?? '')?.[1];
    return !other || other === udid;
  });
  const answer = { reports, source: SIM_SOURCE };
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
