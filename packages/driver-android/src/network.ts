import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  must,
  run,
  pause,
  type NetworkAnswer,
  type NetworkEntry,
  type NetworkHandle,
  type NetworkPath,
  type NetworkSource,
  type NetworkVia,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg, shq, type Adb } from './adb.js';
import { traceProcessor } from './tools.js';

/** `android.network_packets` has no data before Android 14. */
const PACKETS_SDK = 34;
/** A capture no one stops ends by itself. */
const PACKETS_MS = 600_000;
const NO_BODIES = 'no URLs, no bodies';

/** What a uid has sent and received since `dumpsys netstats` began counting, from its UID section. */
export function uidBytes(dump: string, uid: string) {
  let rx = 0;
  let tx = 0;
  let packets = 0;
  let inUid = false;
  let inSection = false;
  for (const line of dump.split('\n')) {
    if (line.startsWith('UID stats:')) inSection = true;
    else if (inSection && /^\S/.test(line)) break;
    if (!inSection) continue;
    if (line.includes('ident=[')) inUid = line.includes(` uid=${uid} `) && line.includes('tag=0x0');
    const m = inUid && /\brb=(\d+) rp=(\d+) tb=(\d+) tp=(\d+)/.exec(line);
    if (m) {
      rx += Number(m[1]);
      tx += Number(m[3]);
      packets += Number(m[2]) + Number(m[4]);
    }
  }
  return { rx, tx, packets };
}

/** Rows of the trace processor's CSV: a quoted word or a number per column. */
export function packetEntries(csv: string): NetworkEntry[] {
  return csv
    .split('\n')
    .filter((l) => /^"(Received|Transmitted)"/.test(l))
    .map((l) => {
      const [direction, transport, port, packets, bytes] = l.split(',');
      return {
        direction: must(direction, 'a direction').replaceAll('"', ''),
        host: `${must(transport, 'a transport').replaceAll('"', '').replace('IPPROTO_', '')} port ${String(port)}`,
        packets: Number(packets),
        bytes: Number(bytes),
      };
    });
}

/**
 * Perfetto's list of its sources, when this build has it: a Xiaomi's `user` build on Android 16 has no packet source,
 * so a trace of it holds nothing, while the emulator's `userdebug` build has.
 */
export const registersPackets = (query: string) =>
  !query.includes('DATA SOURCES REGISTERED') || query.includes('android.network_packets');

const NOT_REGISTERED =
  'this build does not register android.network_packets, so a trace would hold no packet: use bytes. A `user` build registers it only behind a flag (`device_config put tethering enable_network_tracing 1` and a reboot, not tried here, and this tool never sets it)';

/** Android's own counts of an app's traffic: `dumpsys netstats`, and Perfetto's packet trace on 14+. */
export class AndroidNetwork implements NetworkSource {
  constructor(
    private readonly adb: Adb,
    private readonly serial: string,
  ) {}

  private sh = (c: string, timeoutMs = 30_000) => this.adb.exec(this.serial, c, { timeoutMs });

  async paths(): Promise<NetworkPath[]> {
    const sdk = Number((await this.sh('getprop ro.build.version.sdk')).trim());
    const refused =
      sdk < PACKETS_SDK
        ? `the packet trace needs Android 14; this is SDK ${sdk}`
        : !registersPackets(await this.sh('perfetto --query 2>/dev/null').catch(() => ''))
          ? NOT_REGISTERED
          : undefined;
    return [
      { via: 'bytes', sees: `an app's bytes and packets over the window; ${NO_BODIES}` },
      refused
        ? { via: 'packets', refused }
        : {
            via: 'packets',
            sees: `an app's packets by remote port and direction, read at stop; ${NO_BODIES}`,
          },
      {
        via: 'probe',
        refused: 'the probe is for a simulator: an Android app takes no injected library here',
      },
    ];
  }

  private async uid(app: string) {
    const out = await this.sh(`cmd package list packages -U ${shq(assertPkg(app))}`);
    const uid = new RegExp(`package:${app.replace(/\./g, '\\.')} uid:(\\d+)`).exec(out)?.[1];
    if (!uid) throw new DeviceError('APP_NOT_RUNNING', `${app} is not installed`);
    return uid;
  }

  private async counts(uid: string) {
    await this.sh('dumpsys netstats --poll');
    return uidBytes(await this.sh('dumpsys netstats --uid', 60_000), uid);
  }

  async start(via: NetworkVia, app: string | undefined): Promise<NetworkHandle> {
    if (!app) throw new DeviceError('INVALID_ARGUMENT', `${via} is about one app: give app`);
    const uid = await this.uid(app);
    if (via === 'bytes') return { via, uid, ...(await this.counts(uid)) };
    if (via !== 'packets')
      throw new DeviceError('UNSUPPORTED', `${via} is not a way of an Android device`);
    const refused = (await this.paths()).find((p) => p.via === via)?.refused;
    if (refused) throw new DeviceError('UNSUPPORTED', refused);
    await traceProcessor();
    const remote = `/data/misc/perfetto-traces/appdyno-${randomBytes(4).toString('hex')}.pftrace`;
    const config = [
      'buffers { size_kb: 8192 }',
      'data_sources { config { name: "android.network_packets" network_packet_trace_config { poll_ms: 250 } } }',
      `duration_ms: ${PACKETS_MS}`,
    ].join('\n');
    const out = await this.sh(
      `echo '${config}' | perfetto --txt -c - -o ${remote} --background 2>&1`,
    );
    const pid = /^(\d+)\s*$/m.exec(out)?.[1];
    if (!pid)
      throw new DeviceError('UNSUPPORTED', `perfetto did not start: ${out.trim().slice(0, 200)}`);
    return { via, uid, remote, pid };
  }

  async read(h: NetworkHandle): Promise<NetworkAnswer> {
    if (h.via === 'packets')
      return { entries: [], note: 'a packet trace can be read when it ends: action stop' };
    const now = await this.counts(String(h.uid));
    const rx = now.rx - Number(h.rx);
    const tx = now.tx - Number(h.tx);
    return {
      entries: [
        { direction: 'Received', host: `uid ${String(h.uid)}`, bytes: rx },
        { direction: 'Transmitted', host: `uid ${String(h.uid)}`, bytes: tx },
      ],
      note: `${now.packets - Number(h.packets)} packets. Traffic on the loopback (an adb reverse) is not counted.`,
    };
  }

  async stop(h: NetworkHandle): Promise<NetworkAnswer> {
    if (h.via !== 'packets') return this.read(h);
    const pid = String(h.pid);
    const remote = String(h.remote);
    await this.sh(`kill ${pid}`);
    const end = Date.now() + 15_000;
    while (Date.now() < end && (await this.sh(`[ -d /proc/${pid} ] && echo up`)).includes('up'))
      await pause(200);
    const dir = await mkdtemp(join(tmpdir(), 'appdyno-net-'));
    try {
      const file = join(dir, 'net.pftrace');
      const query = join(dir, 'net.sql');
      await this.adb.run(['-s', this.serial, 'pull', remote, file]);
      await writeFile(
        query,
        `INCLUDE PERFETTO MODULE android.network_packets;
SELECT direction, packet_transport, remote_port, sum(packet_count), sum(packet_length)
FROM android_network_packets WHERE socket_uid = ${Number(h.uid)}
GROUP BY 1, 2, 3 ORDER BY 5 DESC LIMIT 200;`,
      );
      const ask = async () =>
        (
          await run(await traceProcessor(), ['-q', query, file], {
            timeout: 120_000,
            maxBuffer: 64 * 1024 * 1024,
          })
        ).stdout;
      const entries = packetEntries(await ask());
      if (entries.length > 0) return { entries };
      // no row is not "no traffic" until the trace is known to hold any
      await writeFile(
        query,
        `INCLUDE PERFETTO MODULE android.network_packets;
SELECT count(*) FROM android_network_packets;`,
      );
      const any = /\d+/.exec((await ask()).split('\n').slice(1).join('\n'))?.[0];
      return {
        entries,
        note:
          any === '0' || any === undefined
            ? "this device's trace recorded no packets of any app, so this says nothing of the traffic: use bytes"
            : `the trace holds ${any} packet rows of other apps and none of this one`,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
      await this.sh(`rm -f ${remote}`).catch(() => undefined);
    }
  }
}
