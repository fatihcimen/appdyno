import { describe, expect, it } from 'vitest';
import { packetEntries, registersPackets, uidBytes } from '../src/network.js';

describe('Android counts', () => {
  it('adds up a uid in the UID section only, untagged', () => {
    const dump = `Dev stats:
  ident=[{type=1}] uid=-1 set=ALL tag=0x0
    st=1 rb=9 rp=9 tb=9 tp=9
UID stats:
  ident=[{type=1}] uid=10193 set=FOREGROUND tag=0x0
    NetworkStatsHistory: bucketDuration=7200
      st=1 rb=100 rp=2 tb=10 tp=1 op=0
      st=2 rb=50 rp=1 tb=5 tp=1 op=0
  ident=[{type=1}] uid=10193 set=FOREGROUND tag=0xff
    NetworkStatsHistory: bucketDuration=7200
      st=1 rb=7 rp=7 tb=7 tp=7 op=0
  ident=[{type=1}] uid=10194 set=DEFAULT tag=0x0
    NetworkStatsHistory: bucketDuration=7200
      st=1 rb=70 rp=7 tb=70 tp=7 op=0
InterfaceMapUpdater:
  ident=[{type=1}] uid=10193 set=FOREGROUND tag=0x0
      st=1 rb=9 rp=9 tb=9 tp=9 op=0
`;
    expect(uidBytes(dump, '10193')).toEqual({ rx: 150, tx: 15, packets: 5 });
    expect(uidBytes(dump, '1')).toEqual({ rx: 0, tx: 0, packets: 0 });
  });

  it('tells a build with the packet source from one without, and takes no list for neither', () => {
    const list = 'DATA SOURCES REGISTERED:\nandroid.packages_list  perfetto.traced_probes (2)\n';
    expect(registersPackets(list)).toBe(false);
    expect(registersPackets(`${list}android.network_packets  system_server (4)\n`)).toBe(true);
    expect(registersPackets('')).toBe(true);
  });

  it("reads the trace processor's rows", () => {
    const csv = `Trace loaded
"direction","packet_transport","remote_port","sum(packet_count)","sum(packet_length)"
"Received","IPPROTO_TCP",18765,141,205771
"Transmitted","IPPROTO_UDP",53,1,40
`;
    expect(packetEntries(csv)).toEqual([
      { direction: 'Received', host: 'TCP port 18765', packets: 141, bytes: 205771 },
      { direction: 'Transmitted', host: 'UDP port 53', packets: 1, bytes: 40 },
    ]);
  });
});
