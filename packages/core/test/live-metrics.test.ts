import { describe, expect, it } from 'vitest';
import { LIVE_FIELDS, perfMessage, type LiveSample } from '../src/index.js';

describe('a live sample', () => {
  it('keeps a reading of 0 apart from a measure the device cannot give', () => {
    const sample: LiveSample = {
      at: 1,
      app: 'dev.app',
      fps: 0,
      absent: { memoryMb: 'this device does not say' },
    };
    const { sample: told } = perfMessage(sample);
    expect(told.fps).toBe(0);
    expect(told).not.toHaveProperty('memoryMb');
    expect(told.absent?.memoryMb).toBe('this device does not say');
  });

  it('reaches a window as one message, marked as read under a stream', () => {
    expect(perfMessage({ at: 2, cpuPercent: 12.5 })).toEqual({
      op: 'perf',
      sample: { at: 2, cpuPercent: 12.5 },
      noise: ['mirrored'],
    });
  });

  it('names each measure once', () => {
    expect(new Set(LIVE_FIELDS).size).toBe(LIVE_FIELDS.length);
  });
});
