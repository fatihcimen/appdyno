import { rm } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  modelledEnergy,
  sleep,
  type BuildType,
  type Measured,
  type NetworkReading,
  type EnergyReading,
  type ExitReading,
  type SizeReading,
  type DeviceVitals,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg, shq } from '../adb.js';
import { parseExitInfo } from '../crashes.js';
import { BATTERY_BACK, BATTERY_GUARD } from '../settings.js';
import { traceProcessor } from '../tools.js';
import {
  parseBuildType,
  parseCsv,
  parseNetstatsUid,
  parseBatteryUsage,
  usageSince,
  parseDiskstats,
  parseVitals,
} from './parse.js';
import { cpu } from './cpu.js';
import { type PerfDevice, sh, uidOf, at } from './shared.js';
import { recordTrace, queryFile } from './perfetto.js';

/**
 * The app as it is built: what a number of this build can be compared with. Android 14 prints no
 * profileable flag in `dumpsys package` even for a profileable build; Perfetto's package list has it
 * (so without the trace processor a build that is not debuggable is unknown).
 */
export async function buildType(d: PerfDevice, pkg: string): Promise<BuildType> {
  assertPkg(pkg);
  const flags = parseBuildType(
    await sh(d, `dumpsys package ${pkg} | grep -E '^ *(pkg|private|privatePkg)?[fF]lags=\\['`),
  );
  if (flags !== 'release') return flags;
  try {
    await traceProcessor();
    const file = await recordTrace(d, pkg, 'packages', [
      'buffers { size_kb: 4096 }',
      'data_sources { config { name: "android.packages_list" } }',
      'duration_ms: 100',
    ]);
    try {
      const csv = await queryFile(
        file,
        `SELECT profileable_from_shell FROM package_list WHERE package_name = '${pkg}';`,
      );
      return parseCsv(csv).rows[0]?.[0] === '1' ? 'profileable' : 'release';
    } finally {
      await rm(file, { force: true });
    }
  } catch {
    return 'unknown';
  }
}

/**
 * What the app's uid sent and received over the window (Android's own traffic accounting). netstats
 * counts on poll: `--poll` first, and it prints nothing else, so the read is a second command.
 */
export async function network(
  d: PerfDevice,
  pkg: string,
  windowMs: number,
  during?: () => Promise<unknown>,
): Promise<Measured<NetworkReading>> {
  const uid = await uidOf(d, pkg);
  const read = async () => {
    await sh(d, 'dumpsys netstats --poll');
    return sh(d, 'dumpsys netstats --uid', 60_000);
  };
  const a = await read();
  const t0 = Date.now();
  await Promise.all([during?.(), sleep(windowMs)]);
  const b = await read();
  const [before, after] = [parseNetstatsUid(a, uid), parseNetstatsUid(b, uid)];
  return {
    value: {
      windowMs: Date.now() - t0,
      rxBytes: after.rxBytes - before.rxBytes,
      txBytes: after.txBytes - before.txBytes,
      note: `everything uid ${uid} moved over the network, IP and TCP headers included; not loopback, and not what another process fetched for the app`,
    },
    raw: `${a}\n---\n${b}`,
    at: at(),
  };
}

/**
 * The charge batterystats estimates for the app over the window: the difference of its count since the last
 * charge, whose history is left alone. It counts on battery only, so the phone is told it is unplugged for the
 * time (and told the truth after). An estimate from the power profile's model, not a measure. A device whose power
 * profile computes nothing (an emulator's is all zeros: a core busy for seconds reads cpu=0) gets this tool's model.
 */
export async function energy(
  d: PerfDevice,
  pkg: string,
  windowMs: number,
): Promise<Measured<EnergyReading>> {
  const uid = await uidOf(d, pkg);
  try {
    // a build that does not take the guard is never told it is unplugged: that could reset its history
    const guarded = /Enabled: no-auto-reset/.test(await sh(d, BATTERY_GUARD));
    if (guarded) await sh(d, 'dumpsys battery unplug');
    // Android 15 and later collect their samples first for this one, and it prints no more than the estimate
    const read = () => sh(d, 'dumpsys batterystats --usage', 60_000);
    const before = parseBatteryUsage(await read(), uid);
    const [used, moved] = await Promise.all([cpu(d, pkg, windowMs), network(d, pkg, windowMs)]);
    const raw = await read();
    const after = parseBatteryUsage(raw, uid);
    const cpuMs = (used.value.percent / 100) * used.value.windowMs;
    if (!guarded || after.mah === undefined || (cpuMs > 0 && !after.breakdown?.cpu))
      return {
        value: modelledEnergy(cpuMs, moved.value.rxBytes + moved.value.txBytes),
        raw: `${raw}\n---\n${used.raw}\n---\n${moved.raw}`,
        at: at(),
      };
    return {
      value: {
        ...usageSince(before, after),
        modelled: true,
        note: 'model-based: batterystats multiplies time in each state by the power profile, it does not read a power meter',
      },
      raw,
      at: at(),
    };
  } finally {
    await sh(d, BATTERY_BACK);
  }
}

/** How the app's processes ended, as far back as the system keeps (16 by default): crashes and ANRs apart. */
export async function exits(d: PerfDevice, pkg: string): Promise<Measured<ExitReading>> {
  assertPkg(pkg);
  const raw = await sh(d, `dumpsys activity exit-info ${pkg}`, 30_000);
  const exits = parseExitInfo(raw);
  return {
    value: {
      crashes: exits.filter((e) => /CRASH/i.test(e.reason)).length,
      anrs: exits.filter((e) => /\bANR\b/i.test(e.reason)).length,
      total: exits.length,
      recent: exits.slice(0, 10).map((e) => ({
        at: e.at,
        reason: e.reason,
        ...(e.detail && { description: e.detail }),
      })),
    },
    raw,
    at: at(),
  };
}

/** The installed apks' bytes, each a part; with what `dumpsys diskstats` lists for the app, if it does. */
export async function size(d: PerfDevice, pkg: string): Promise<Measured<SizeReading>> {
  assertPkg(pkg);
  const paths = (await sh(d, `pm path ${pkg}`)).match(/(?<=^package:).+/gm) ?? [];
  if (paths.length === 0) throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not installed`);
  const stat = await sh(d, `stat -c '%s %n' ${paths.map((p) => shq(p.trim())).join(' ')}`);
  const disk = await sh(d, 'dumpsys diskstats', 30_000);
  const parts: Record<string, number> = {};
  for (const [, bytes, path] of stat.matchAll(/^(\d+) (.+)$/gm))
    parts[basename(path!.trim())] = Number(bytes);
  const bytes = Object.values(parts).reduce((a, b) => a + b, 0);
  const listed = parseDiskstats(disk, pkg);
  return {
    value: {
      bytes,
      parts: { ...parts, ...listed },
      note:
        Object.keys(listed).length > 0
          ? '`bytes` counts the apks; code, data and cache are the last daily count of dumpsys diskstats'
          : '`bytes` counts the apks; dumpsys diskstats does not list the app yet',
    },
    raw: `${stat}\n---\n${disk}`,
    at: at(),
  };
}

/** The device's own state: load, CPU pressure, memory, thermal status, battery temperature. */
export async function vitals(d: PerfDevice): Promise<Measured<DeviceVitals>> {
  const raw = await sh(
    d,
    'echo ==load==; cat /proc/loadavg; echo ==parked==; ps -A -o STAT,PID,PPID,WCHAN:24,NAME 2>/dev/null | grep "^D"; ' +
      'echo ==pressure==; cat /proc/pressure/cpu 2>/dev/null; ' +
      'echo ==mem==; head -3 /proc/meminfo; echo ==thermal==; dumpsys thermalservice 2>/dev/null | head -5; ' +
      'echo ==battery==; dumpsys battery 2>/dev/null',
  );
  return { value: parseVitals(raw), raw, at: at() };
}
