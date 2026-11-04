import { round1, type HangCause } from '@appdyno/core';
import { hangRows, inApp, samplesOf, type Sample } from './trace-parse.js';

/** Over this share of a hang on the CPU, its thread was at work; under it, it was waiting. */
const BUSY_SHARE = 0.5;

/** The app's innermost frame of a stack: a name over an address. */
const ownFrame = (s: Sample) => s.stack.find(inApp)?.name;

/** What ran the longest in these samples, by the app's innermost frame. */
function mostRun(samples: Sample[]) {
  const spent = new Map<string, number>();
  for (const s of samples) {
    const name = ownFrame(s);
    if (name) spent.set(name, (spent.get(name) ?? 0) + s.weight);
  }
  const ranked = [...spent].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return ranked.find((name) => !name.startsWith('0x')) ?? ranked[0];
}

/**
 * Busy or blocked, as Apple's triage has it, from what a Time Profiler trace holds already. It samples only a thread
 * that runs, so the samples of the hung thread inside a hang are how much of it was on the CPU: a blocked thread has
 * almost none, and what it ran last is what it stopped in. There is no `thread-state` table to join in these traces.
 */
export function parseHangCauses(hangsXml: string, profileXml: string, pid: number): HangCause[] {
  const samples = [...samplesOf(profileXml)].filter((s) => s.pid === pid);
  return hangRows(hangsXml, pid).map((hang) => {
    const tid = Number(hang.thread?.value);
    const start = Number(hang.start?.value);
    const ns = Number(hang.duration?.value);
    const own = samples.filter((s) => s.tid === tid && s.ns < start + ns);
    const inside = own.filter((s) => s.ns >= start);
    const cpu = inside.reduce((a, s) => a + s.weight, 0) / ns;
    const kind = cpu >= BUSY_SHARE ? 'busy' : 'blocked';
    const last = own.findLast((s) => ownFrame(s));
    const where = kind === 'busy' ? mostRun(inside) : last && ownFrame(last);
    return {
      ms: round1(ns / 1e6),
      kind,
      cpuPercent: round1(cpu * 100),
      ...(where && { function: where }),
    };
  });
}
