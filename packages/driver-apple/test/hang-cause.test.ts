import { describe, expect, it } from 'vitest';
import { parseHangCauses } from '../src/hang-cause.js';
import { parseTimeProfile, samplesOf } from '../src/trace-parse.js';

const PID = 973;
const TID = 78032;
const MS = 1_000_000;
const APP = '/private/var/containers/Bundle/Application/X/Fixture.app/Fixture';

/** As Xcode 27 exports them: the first of a thing in full, a `ref` to it from then on. */
const HANGS = (startMs: number, ms: number) =>
  `<?xml version="1.0"?><trace-query-result><node><schema name="potential-hangs"><col><mnemonic>start</mnemonic></col><col><mnemonic>duration</mnemonic></col><col><mnemonic>hang-type</mnemonic></col><col><mnemonic>thread</mnemonic></col><col><mnemonic>process</mnemonic></col></schema><row><start-time id="1" fmt="00:01">${startMs * MS}</start-time><duration id="2" fmt="x">${ms * MS}</duration><hang-type id="3" fmt="Hang">Hang</hang-type><thread id="4" fmt="Main Thread (0x130d0) (Fixture, pid: ${PID})"><tid id="5" fmt="0x130d0">${TID}</tid><process id="6" fmt="Fixture (${PID})"><pid id="7" fmt="${PID}">${PID}</pid></process></thread><process ref="6"/></row></node></trace-query-result>`;

const frames = (names: string[], first: number) =>
  names
    .map(
      (n, i) =>
        `<frame id="${first + i}" name="${n}" addr="0x1"><binary id="${first + 100 + i}" name="b" path="${n.startsWith('sys') ? '/usr/lib/libsystem' : APP}"/></frame>`,
    )
    .join('');

/** Samples of the main thread every `everyMs`, each a millisecond of CPU in the same stack. */
function profile(fromMs: number, toMs: number, stack: string[], everyMs = 1) {
  let row = `<row><sample-time id="1" fmt="t">${fromMs * MS}</sample-time><thread id="2" fmt="Main Thread (0x130d0) (Fixture, pid: ${PID})"><tid id="3" fmt="0x130d0">${TID}</tid><process id="4" fmt="Fixture (${PID})"><pid id="5" fmt="${PID}">${PID}</pid></process></thread><process ref="4"/><weight id="6" fmt="1 ms">${MS}</weight><tagged-backtrace id="7">${frames(stack, 1000)}</tagged-backtrace></row>`;
  let id = 10;
  for (let t = fromMs + everyMs; t < toMs; t += everyMs)
    row += `<row><sample-time id="${id++}" fmt="t">${t * MS}</sample-time><thread ref="2"/><process ref="4"/><weight ref="6"/><tagged-backtrace ref="7"/></row>`;
  return `<node>${row}</node>`;
}

describe('a hang, busy or blocked', () => {
  it('reads a thread on the CPU all through as busy, in the app’s innermost function', () => {
    const xml = profile(2_000, 2_500, ['sysLeaf', 'busyMainThread', 'main']);
    expect(parseHangCauses(HANGS(2_000, 500), xml, PID)).toEqual([
      { ms: 500, kind: 'busy', cpuPercent: 100, function: 'busyMainThread' },
    ]);
  });

  it('reads a thread that stopped as blocked, in what it ran last', () => {
    const xml = profile(1_990, 2_010, ['sysusleep', 'waitsForIt', 'main']);
    expect(parseHangCauses(HANGS(2_000, 500), xml, PID)).toEqual([
      { ms: 500, kind: 'blocked', cpuPercent: 2, function: 'waitsForIt' },
    ]);
  });

  it('counts no other thread or process, and no sample after it', () => {
    const later = profile(2_600, 2_900, ['other', 'main']);
    expect(parseHangCauses(HANGS(2_000, 500), later, PID)).toEqual([
      { ms: 500, kind: 'blocked', cpuPercent: 0 },
    ]);
    const another = profile(2_000, 2_500, ['a', 'main']).replaceAll(String(PID), '111');
    expect(parseHangCauses(HANGS(2_000, 500), another, PID)[0]?.kind).toBe('blocked');
  });

  it('says an address where the build has no symbols', () => {
    const xml = profile(2_000, 2_500, ['sysLeaf', '0x1001bd02b', 'main']);
    expect(parseHangCauses(HANGS(2_000, 500), xml, PID)[0]?.function).toBe('0x1001bd02b');
  });

  it('reads a time, a thread and a process through their refs', () => {
    const rows = [...samplesOf(profile(100, 103, ['a']))];
    expect(rows.map((r) => r.ns)).toEqual([100 * MS, 101 * MS, 102 * MS]);
    expect(rows.every((r) => r.tid === TID && r.pid === PID && r.weight === MS)).toBe(true);
    expect(rows[2]?.stack.map((f) => f.name)).toEqual(['a']);
  });

  it('leaves the profile of a process as it read', () => {
    const p = parseTimeProfile(profile(0, 10, ['sysLeaf', 'mine']), PID);
    expect(p.top).toEqual([{ symbol: 'sysLeaf', samples: 10, percent: 100 }]);
    expect(p.appTop).toEqual([{ symbol: 'mine', samples: 10, percent: 100 }]);
    expect(parseTimeProfile(profile(0, 10, ['x']), 1).samples).toBe(0);
  });
});
