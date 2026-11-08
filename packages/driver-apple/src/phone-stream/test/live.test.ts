import { LIVE_FIELDS, type LiveSample, must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { PhoneLive } from '../../phone-live.js';
import type { Archived } from '../keyed-archive.js';
import { framesOf, isSample, pidOf, rowOf, sysmonConfig, unreadable } from '../live.js';

describe('what the phone instruments say', () => {
  const sample: Archived = [
    { Type: 41, System: [1], SystemCPUUsage: {} },
    { Processes: { 1908: [1908, 18.5, 20971520, 12], 229: [229, null, 120850608, 10] } },
  ];

  it('asks for what a row is read by, in that order', () => {
    expect(sysmonConfig()).toEqual({
      ur: 1000,
      bm: 0,
      procAttrs: ['pid', 'cpuUsage', 'physFootprint', 'threadCount'],
      sysAttrs: ['vmFreeCount'],
      cpuUsage: true,
      physFootprint: true,
      sampleInterval: 1_000_000_000,
    });
  });

  it('reads an app row out of a sample', () => {
    expect(isSample(sample)).toBe(true);
    expect(rowOf(sample, 1908)).toEqual({ cpuPercent: 18.5, memoryMb: 20, threads: 12 });
  });

  it('leaves out what the first sample has no number for, never as 0', () => {
    expect(rowOf(sample, 229)).toEqual({ memoryMb: 120850608 / (1024 * 1024), threads: 10 });
  });

  it('holds nothing for a process a sample does not list, and for what is no sample', () => {
    expect(rowOf(sample, 5)).toBeUndefined();
    expect(isSample({ Type: 'DTTapMessagePlist' })).toBe(false);
  });

  it('reads the frames, and a 0 is a reading', () => {
    expect(framesOf({ CoreAnimationFramesPerSecond: 0 })).toBe(0);
    expect(framesOf({ 'Device Utilization %': 3 })).toBeUndefined();
  });

  it('finds an app by its bundle', () => {
    const running = [
      { bundleIdentifier: 'dev.other', pid: 1 },
      { bundleIdentifier: 'dev.app', pid: 2 },
    ];
    expect(pidOf(running, 'dev.app')).toBe(2);
    expect(pidOf(running, 'dev.gone')).toBeUndefined();
    expect(pidOf(null, 'dev.app')).toBeUndefined();
  });

  it('says why for every field in a build without this folder, and stopping does nothing', async () => {
    const said: LiveSample[] = [];
    const stop = await new PhoneLive('phone', () => Promise.resolve(undefined)).start((s) =>
      said.push(s),
    );
    expect(Object.keys(must(said[0]?.absent, 'what is absent')).sort()).toEqual(
      [...LIVE_FIELDS].sort(),
    );
    stop();
    stop();
  });

  it('says why for every field when it can read nothing', () => {
    const s = unreadable('why', 'dev.app');
    expect(s.app).toBe('dev.app');
    expect(Object.keys(must(s.absent, 'what is absent')).sort()).toEqual([...LIVE_FIELDS].sort());
    expect(LIVE_FIELDS.some((f) => f in s)).toBe(false);
  });
});
