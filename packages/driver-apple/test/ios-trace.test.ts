import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  heldTable,
  hitchFrames,
  hitchSummary,
  parseActivityMonitor,
  parseLeakRows,
  parsePowerBytes,
  parseHangs,
  parsePowerImpact,
  parseTimeProfile,
  parseTraceTable,
  parseXctMetrics,
  traceDigest,
} from '../src/trace-parse.js';
import { queryTraceFile } from '../src/trace.js';

const fixture = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures', f), 'utf8');

describe('iOS trace export', () => {
  it('tells a table with no rows from one the trace does not hold, as an export of a phone’s trace does', () => {
    const none = `<?xml version="1.0"?>\n<trace-query-result>\n<node xpath='//trace-toc[1]/run[1]/data[1]/table[1]'><schema name="potential-hangs"><col><mnemonic>start</mnemonic></col></schema></node></trace-query-result>`;
    expect(parseHangs(heldTable(none, 'potential-hangs'))).toMatchObject({ hangs: 0 });
    const absent = `<?xml version="1.0"?>\n<trace-query-result>\n</trace-query-result>`;
    expect(() => heldTable(absent, 'potential-hangs')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED' }),
    );
  });

  it('reads an exported table, references resolved', () => {
    const rows = parseTraceTable(fixture('ios-hitches.xml'));
    expect(rows).toHaveLength(5);
    expect(rows[0]!.duration).toEqual({ value: '62504375', fmt: '62.50 ms' });
    expect(rows[1]!.process!.fmt).toBe('Settings (1235)'); // a ref to the first row's process
    expect(rows[0]!['narrative-description']!.value).toBe('Potentially expensive app update(s)');
  });

  it('sums the app hitches over the recording', () => {
    const s = hitchSummary(fixture('ios-hitches.xml'), fixture('ios-surfaces.xml'), 6_000);
    expect(s.frames).toBe(40);
    expect(s.hitches).toBeGreaterThan(0);
    expect(s.worstMs).toBe(62.5);
    expect(s.hitchRatio).toBeCloseTo(s.hitchMs / 6, 0);
    expect(s.frozen).toBe(0);
  });

  it('counts a hitch of 700 ms or longer as a frozen frame, and reads as frames of any platform', () => {
    const hitch = (at: number, ns: number) =>
      `<row><start fmt="x">${at * 1e9}</start><duration fmt="x">${ns}</duration></row>`;
    const table = `<node><schema name="hitches"><col><mnemonic>start</mnemonic></col><col><mnemonic>duration</mnemonic></col></schema>${[
      hitch(1, 699e6),
      hitch(2, 700e6),
      hitch(3, 1_000e6),
    ].join('')}</node>`;
    const s = hitchSummary(table, fixture('ios-surfaces.xml'), 6_000);
    expect(s).toMatchObject({ hitches: 3, frozen: 2, worstMs: 1_000 });
    // a blocked main thread may show as no hitch: the same recording's hang table has it, once
    const hang = (at: number, ms: number, type: string) =>
      `<row><start fmt="x">${at * 1e6}</start><duration fmt="x">${ms * 1e6}</duration><hang-type fmt="x">${type}</hang-type></row>`;
    const hangs = `<node><schema><col><mnemonic>start</mnemonic></col><col><mnemonic>duration</mnemonic></col><col><mnemonic>hang-type</mnemonic></col></schema>${[
      hang(100, 1_020, 'Hang'),
      hang(5_000, 60, 'Potential Interaction Delay'),
    ].join('')}</node>`;
    const none = '<node><schema><col><mnemonic>duration</mnemonic></col></schema></node>';
    expect(hitchSummary(none, fixture('ios-surfaces.xml'), 6_000, hangs)).toMatchObject({
      hitches: 0,
      frozen: 1,
      stalls: { count: 1, worstMs: 1_020 },
    });
    const overlapping = `<node><schema><col><mnemonic>start</mnemonic></col><col><mnemonic>duration</mnemonic></col></schema><row><start fmt="x">${200e6}</start><duration fmt="x">${900e6}</duration></row></node>`;
    expect(hitchSummary(overlapping, fixture('ios-surfaces.xml'), 6_000, hangs).frozen).toBe(1);
    expect(hitchFrames(s)).toMatchObject({
      totalFrames: 40,
      jankyFrames: 3,
      jankyPercent: 7.5,
      frozenFrames: 2,
      worstHitchMs: 1_000,
      fewFrames: true,
    });
  });

  const profile = `<trace-query-result><node><schema name="time-profile"><col><mnemonic>weight</mnemonic></col><col><mnemonic>stack</mnemonic></col></schema>
<row><weight id="1" fmt="1 ms">1000000</weight><tagged-backtrace id="2"><frame id="3" name="spin" addr="0x1"><binary id="4" name="Fixture" UUID="X" arch="arm64" load-addr="0x0" path="/x/Fixture.app/Fixture"/></frame><frame id="5" name="main" addr="0x2"><binary ref="4"/></frame></tagged-backtrace></row>
<row><weight ref="1"/><tagged-backtrace ref="2"/></row>
<row><weight ref="1"/><tagged-backtrace id="6"><frame id="7" name="memcpy &amp; co" addr="0x3"><binary id="8" name="libsystem" UUID="Y" arch="arm64" load-addr="0x0" path="/usr/lib/libsystem.dylib"/></frame><frame ref="5"/></tagged-backtrace></row>
</node></trace-query-result>`;

  it('reads the Time Profiler: top of stack, and the app by inclusive weight', () => {
    const p = parseTimeProfile(profile);
    expect(p.samples).toBe(3);
    expect(p.top[0]).toEqual({ symbol: 'spin', samples: 2, percent: 66.7 });
    expect(p.top[1]!.symbol).toBe('memcpy & co');
    expect(p.appTop[0]).toEqual({ symbol: 'main', samples: 3, percent: 100 });
    expect(p.appTop[1]!.symbol).toBe('spin');
  });

  it('ranks the app’s named functions over the addresses, addresses when all are', () => {
    const binary =
      '<binary id="9" name="F" UUID="X" arch="arm64" load-addr="0x0" path="/x/F.app/F"/>';
    const row = (
      first: string,
      second: string,
    ) => `<schema><col><mnemonic>weight</mnemonic></col><col><mnemonic>stack</mnemonic></col></schema>
<row><weight id="1">1000000</weight><tagged-backtrace id="2"><frame id="3" name="${first}" addr="0x1">${binary}</frame><frame id="5" name="${second}" addr="0x2"><binary ref="9"/></frame></tagged-backtrace></row>`;
    expect(parseTimeProfile(row('0xabc', 'spin')).appTop.map((e) => e.symbol)).toEqual(['spin']);
    expect(parseTimeProfile(row('0xabc', '0xdef')).appTop).toHaveLength(2);
  });

  it('reads one process of a recording of every process', () => {
    const all = `<schema><col><mnemonic>process</mnemonic></col><col><mnemonic>weight</mnemonic></col><col><mnemonic>stack</mnemonic></col></schema>
<row><process id="1" fmt="App (7)"><pid>7</pid></process><weight id="2">1000000</weight><tagged-backtrace id="3"><frame id="4" name="mine" addr="0x1"/></tagged-backtrace></row>
<row><process id="5" fmt="Other (8)"><pid>8</pid></process><weight ref="2"/><tagged-backtrace id="6"><frame id="7" name="theirs" addr="0x1"/></tagged-backtrace></row>
<row><process ref="1"/><weight ref="2"/><tagged-backtrace ref="3"/></row>`;
    const p = parseTimeProfile(all, 7);
    expect(p.samples).toBe(2);
    expect(p.top.map((e) => e.symbol)).toEqual(['mine']);
  });

  it('reads one process of Activity Monitor: footprint at the end, CPU over the window', () => {
    const am = `<schema><col><mnemonic>start</mnemonic></col><col><mnemonic>pid</mnemonic></col><col><mnemonic>cpu-total</mnemonic></col><col><mnemonic>memory-physical-footprint</mnemonic></col></schema>
<row><t>0</t><pid id="1" fmt="7">7</pid><c>100000000</c><m>4096</m></row>
<row><t>0</t><pid id="2" fmt="8">8</pid><c>1</c><m>1</m></row>
<row><t>2000000000</t><pid ref="1"/><c>600000000</c><m>8192</m></row>`;
    expect(parseActivityMonitor(am, 7)).toEqual({
      footprintBytes: 8192,
      cpuPercent: 25,
      windowMs: 2000,
    });
    expect(parseActivityMonitor(am, 9)).toBeUndefined();
  });

  it('counts the hangs of the Time Profiler report', () => {
    const hangs = `<schema><col><mnemonic>start</mnemonic></col><col><mnemonic>duration</mnemonic></col></schema>
<row><t>1</t><d>300000000</d></row><row><t>2</t><d>500000000</d></row>`;
    expect(parseHangs(hangs)).toEqual({ hangs: 2, worstMs: 500, totalMs: 800 });
  });

  // columns as Xcode 27.1 names them; on a charging phone the table comes empty, so these rows are written by hand
  it('sums one process of the Power Profiler by subsystem', () => {
    const cols = ['process', 'cpu-impact', 'display-impact', 'gpu-impact', 'networking-impact']
      .map((c) => `<col><mnemonic>${c}</mnemonic></col>`)
      .join('');
    const xml = `<schema>${cols}</schema>
<row><process id="1" fmt="App (7)"><pid>7</pid></process><i>2</i><i>1</i><i>0</i><i>0.5</i></row>
<row><process id="2" fmt="Other (8)"><pid>8</pid></process><i>9</i><i>9</i><i>9</i><i>9</i></row>
<row><process ref="1"/><i>3</i><i>1</i><sentinel/><i>0.5</i></row>`;
    expect(parsePowerImpact(xml, 7)).toEqual({ cpu: 2.5, display: 1, gpu: 0, networking: 0.5 });
    expect(parsePowerImpact(xml, 9)).toBeUndefined();
  });

  it('reads a recording of a 5,000,000 byte fetch, its bytes by process', () => {
    const xml = fixture('ios-power-network.xml');
    expect(parsePowerBytes(xml, 10217)).toEqual({
      windowMs: 16_059,
      rxBytes: 5_322_769,
      txBytes: 10_432,
    });
    expect(parsePowerBytes(xml, 1)).toEqual({ windowMs: 0, rxBytes: 0, txBytes: 0 });
  });

  it('counts each leaked object, and none in an empty table', () => {
    const row =
      '<row leaked-object="Node" size="32" responsible-frame="f" count="1" address="0x1"/>';
    const xml = `<?xml version="1.0"?><trace-query-result><node xpath='x'>${row}\n${row}\n</node></trace-query-result>`;
    expect(parseLeakRows(xml)).toEqual({ leaks: 2, leakedBytes: 64 });
    expect(
      parseLeakRows("<trace-query-result><node xpath='x'></node></trace-query-result>"),
    ).toEqual({
      leaks: 0,
      leakedBytes: 0,
    });
  });

  it('digests a table: the heaviest rows first, cells cut, the rest counted', () => {
    const d = traceDigest('/t.trace', 'hitches', fixture('ios-hitches.xml'), 2);
    expect(d.columns).toContain('duration');
    expect(d.rows).toHaveLength(2);
    expect(d.dropped).toBe(3);
    const i = d.columns.indexOf('duration');
    expect(d.rows[0]![i]).toBe('62.50 ms');
    const long = `<schema><col><mnemonic>weight</mnemonic></col><col><mnemonic>name</mnemonic></col></schema>
<row><w fmt="1 ms">1000000</w><n>a</n></row><row><w fmt="3 ms">3000000</w><n>${'x'.repeat(500)}</n></row>`;
    const w = traceDigest('/t.trace', 'x', long, 10);
    expect(w.rows[0]![0]).toBe('3 ms');
    expect(w.rows[0]![1]).toHaveLength(200);
    expect(w.dropped).toBe(0);
    // no duration or weight: the rows stay in their order
    const plain = `<schema><col><mnemonic>name</mnemonic></col></schema><row><n>b</n></row><row><n>a</n></row>`;
    expect(traceDigest('/t.trace', 'x', plain, 10).rows).toEqual([['b'], ['a']]);
  });

  it('reads the metrics of a result bundle', () => {
    const m = parseXctMetrics(fixture('ios-xct-launch.json'));
    const durations = m['com.apple.dt.XCTMetric_ApplicationLaunch-AppLaunch.duration'];
    expect(durations).toHaveLength(5);
    expect(durations![0]).toBeCloseTo(1.1223, 3);
    expect(parseXctMetrics('[{"testRuns":[{"metrics":[]}]}]')).toEqual({});
  });

  it('a trace of another kind is not this driver’s', async () => {
    await expect(queryTraceFile('/t/probe.jsonl', { limit: 5 })).resolves.toBeUndefined();
    await expect(queryTraceFile('/t/x.trace', { sql: 'select 1', limit: 5 })).rejects.toThrow(
      /SQL/,
    );
    await expect(queryTraceFile('/t/x.trace', { table: 'a"b', limit: 5 })).rejects.toThrow(
      /not a table/,
    );
  });
});
