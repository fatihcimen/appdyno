import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseActivityMonitor, parseHangs, parseTimeProfile, hitchSummary, parseTraceTable } from '../src/trace.js';

const fixture = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures', f), 'utf8');

describe('iOS trace export', () => {
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

  it('reads one process of Activity Monitor: footprint at the end, CPU over the window', () => {
    const am = `<schema><col><mnemonic>start</mnemonic></col><col><mnemonic>pid</mnemonic></col><col><mnemonic>cpu-total</mnemonic></col><col><mnemonic>memory-physical-footprint</mnemonic></col></schema>
<row><t>0</t><pid id="1" fmt="7">7</pid><c>100000000</c><m>4096</m></row>
<row><t>0</t><pid id="2" fmt="8">8</pid><c>1</c><m>1</m></row>
<row><t>2000000000</t><pid ref="1"/><c>600000000</c><m>8192</m></row>`;
    expect(parseActivityMonitor(am, 7)).toEqual({ footprintBytes: 8192, cpuPercent: 25, windowMs: 2000 });
    expect(parseActivityMonitor(am, 9)).toBeUndefined();
  });

  it('counts the hangs of the Time Profiler report', () => {
    const hangs = `<schema><col><mnemonic>start</mnemonic></col><col><mnemonic>duration</mnemonic></col></schema>
<row><t>1</t><d>300000000</d></row><row><t>2</t><d>500000000</d></row>`;
    expect(parseHangs(hangs)).toEqual({ hangs: 2, worstMs: 500, totalMs: 800 });
  });
});
