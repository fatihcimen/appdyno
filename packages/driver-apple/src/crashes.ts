import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  callSignal,
  stateDir,
  type CrashesAnswer,
  type CrashesQuery,
  type CrashReport,
} from '@appdyno/core';
import { xcodeEnv } from './simctl.js';

const run = promisify(execFile);
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
  return { reports, source: SIM_SOURCE };
}

/** Copies the phone's crash logs here (a folder per phone), then reads them as a simulator's. */
export async function phoneCrashes(udid: string, q: CrashesQuery): Promise<CrashesAnswer> {
  const dir = join(stateDir(), 'crashes', udid);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await run(
    'xcrun',
    [
      'devicectl',
      'device',
      'copy',
      'from',
      '--device',
      udid,
      '--domain-type',
      'systemCrashLogs',
      '--source',
      '.',
      '--destination',
      dir,
      '--quiet',
    ],
    {
      timeout: 120_000,
      env: xcodeEnv(),
      ...(callSignal() && { signal: callSignal()! }),
    },
  );
  return { reports: await reportsIn(dir, q), source: 'devicectl systemCrashLogs' };
}
