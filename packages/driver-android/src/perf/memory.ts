import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  sleep,
  type AnonMemory,
  type Measured,
  type MemoryReading,
  type HeapProfileKind,
  type HeapProfile,
  type HeapReading,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg } from '../adb.js';
import { traceProcessor } from '../tools.js';
import { type MemoryStats, parseAnonMemory, parseMeminfo, parseCsv } from './parse.js';
import { type PerfDevice, sh, at, pidOf } from './shared.js';
import { buildType } from './app.js';
import { recordTrace, queryFile } from './perfetto.js';

export type HeapDump = { file: string; bytes: number };

/** Memory still held, by the function that asked for it: the leaf of a stack is malloc or operator new. */
const HEAPPROFD_SITES_SQL = `
WITH RECURSIVE up(leaf, depth, parent, name) AS (
  SELECT c.id, c.depth, c.parent_id, f.name
    FROM stack_profile_callsite c JOIN stack_profile_frame f ON f.id = c.frame_id
    WHERE c.id IN (SELECT callsite_id FROM heap_profile_allocation)
  UNION ALL
  SELECT up.leaf, c.depth, c.parent_id, f.name
    FROM up JOIN stack_profile_callsite c ON c.id = up.parent JOIN stack_profile_frame f ON f.id = c.frame_id
    WHERE up.name GLOB '*alloc*' OR up.name GLOB '_Zn[wa]*'
), site AS (SELECT leaf, name, MIN(depth) FROM up GROUP BY leaf)
SELECT s.name AS name, SUM(a.size) AS bytes, SUM(a.count) AS count
  FROM heap_profile_allocation a JOIN site s ON s.leaf = a.callsite_id
  GROUP BY s.name HAVING bytes > 0 ORDER BY bytes DESC;`;

export async function memory(
  d: PerfDevice,
  pkg: string,
): Promise<Measured<MemoryStats & MemoryReading>> {
  assertPkg(pkg);
  const raw = await sh(d, `dumpsys meminfo ${pkg}`);
  if (/No process found/i.test(raw))
    throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not running`);
  const stats = parseMeminfo(raw);
  return { value: { ...stats, kb: stats.pssKb, kind: 'pss' }, raw, at: at() };
}

/**
 * The memory Play judges (docs/reference/perf.md): `RssAnon` + `VmSwap` from the process's own status, the state the system holds
 * it in, its bitmaps, and the device's RAM, which picks the limit.
 */
export async function anonMemory(d: PerfDevice, pkg: string): Promise<Measured<AnonMemory>> {
  const pid = await pidOf(d, pkg);
  const raw = await sh(
    d,
    `grep -E '^(RssAnon|VmSwap):' /proc/${pid}/status; grep MemTotal /proc/meminfo; dumpsys activity processes ${pkg} | grep -m1 -o 'curProcState=[0-9]*'; dumpsys meminfo ${pkg} | grep -E 'Native Allocations|Bitmap \\((non)?malloced\\)'`,
  );
  return { value: parseAnonMemory(raw), raw, at: at() };
}

/**
 * A Perfetto heap profile with its largest classes (`java_hprof`, one heap snapshot taken as its data
 * source starts, so after `seconds` and `during`) or allocation sites (`heapprofd`, native memory
 * allocated and not freed while it records). The platform allows either only on a debuggable or
 * profileable build.
 */
export async function heapProfile(
  d: PerfDevice,
  pkg: string,
  kind: HeapProfileKind,
  seconds: number,
  during?: () => Promise<unknown>,
): Promise<Measured<HeapProfile>> {
  await traceProcessor();
  const build = await buildType(d, pkg);
  if (build !== 'debug' && build !== 'profileable')
    throw new DeviceError(
      'UNSUPPORTED',
      `${kind} needs a debuggable or profileable build of ${pkg}; this one is ${build}`,
      'add <profileable android:shell="true"/> to the manifest',
    );
  await pidOf(d, pkg);
  const s = Math.min(Math.max(Math.round(seconds), 1), 120);
  if (kind === 'java_hprof') await Promise.all([during?.(), sleep(s * 1000)]);
  const trace = await recordTrace(
    d,
    pkg,
    kind,
    kind === 'java_hprof'
      ? [
          'buffers { size_kb: 262144 fill_policy: DISCARD }',
          `data_sources { config { name: "android.java_hprof" java_hprof_config { process_cmdline: "${pkg}" } } }`,
          'data_source_stop_timeout_ms: 100000',
          'duration_ms: 1000',
        ]
      : [
          'buffers { size_kb: 65536 fill_policy: DISCARD }',
          `data_sources { config { name: "android.heapprofd" heapprofd_config { sampling_interval_bytes: 4096 process_cmdline: "${pkg}" shmem_size_bytes: 8388608 block_client: true } } }`,
          'data_source_stop_timeout_ms: 60000',
          `duration_ms: ${s * 1000}`,
        ],
    kind === 'heapprofd' && during ? { during } : {},
  );
  const raw = await queryFile(
    trace,
    kind === 'java_hprof'
      ? `SELECT c.name AS name, SUM(o.self_size) AS bytes, COUNT(*) AS count FROM heap_graph_object o
         JOIN heap_graph_class c ON o.type_id = c.id WHERE o.reachable GROUP BY c.name ORDER BY bytes DESC;`
      : HEAPPROFD_SITES_SQL,
  );
  const rows = parseCsv(raw).rows.map((r) => ({
    name: r[0]!,
    bytes: Number(r[1]),
    count: Number(r[2]),
  }));
  if (rows.length === 0) throw new DeviceError('UNSUPPORTED', `${kind} recorded nothing of ${pkg}`);
  return {
    value: {
      kind,
      tracePath: trace,
      top: rows.slice(0, 20),
      totalBytes: rows.reduce((a, r) => a + r.bytes, 0),
    },
    raw: parseCsv(raw).rows.slice(0, 50).join('\n'),
    at: at(),
  };
}

/** A heap dump of the app (HPROF, for a memory analyser) saved at `localPath`; the file stays on this machine. */
export async function heapDump(
  d: PerfDevice,
  pkg: string,
  localPath: string,
): Promise<Measured<HeapDump>> {
  assertPkg(pkg);
  await pidOf(d, pkg);
  const remote = `/data/local/tmp/appdyno-${randomBytes(4).toString('hex')}.hprof`;
  try {
    const out = await sh(d, `am dumpheap ${pkg} ${remote} 2>&1`, 120_000);
    // the dump is written by the app after the command returns: wait until its size stops growing
    let last = -1;
    for (let i = 0; i < 120; i++) {
      const size = Number((await d.shell(`stat -c %s ${remote} 2>/dev/null`)).trim() || -1);
      if (size > 0 && size === last) break;
      last = size;
      await sleep(500);
    }
    if (last <= 0)
      throw new DeviceError('UNSUPPORTED', `no heap dump of ${pkg}: ${out.trim().slice(0, 200)}`);
    await d.pull(remote, localPath);
    return { value: { file: localPath, bytes: last }, raw: out, at: at() };
  } finally {
    await d.shell(`rm -f ${remote}`).catch(() => undefined);
  }
}

/** The Java heap into a new HPROF file under `dir`. */
export async function heap(
  d: PerfDevice,
  pkg: string,
  dir: string,
): Promise<Measured<HeapReading>> {
  const m = await heapDump(d, pkg, join(dir, `heap-${pkg}-${Date.now()}.hprof`));
  return { ...m, value: { ...m.value, kind: 'hprof' } };
}
