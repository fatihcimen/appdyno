import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mockedProviders, parseTestLocation, processAlive } from '../src/android/device.js';

describe('test location bookkeeping', () => {
  it('reads the mock providers from dumpsys location', () => {
    const dump = [
      '  Location Providers:',
      '    network provider:',
      '    fused provider [mock]:',
      '      last mock location=Location[fused 41.008200,28.978400 mock]',
      '    gps provider [mock]:',
    ].join('\n');
    expect([...mockedProviders(dump)].sort()).toEqual(['fused', 'gps']);
    expect(mockedProviders('    gps provider:\n').size).toBe(0);
  });

  it('knows its own file and nothing else as ours', () => {
    expect(parseTestLocation('4242 gps fused\n')).toEqual({
      pid: 4242,
      providers: ['gps', 'fused'],
    });
    expect(parseTestLocation('4242\n')).toEqual({ pid: 4242, providers: [] });
    // no file, or one not written by this library: nothing is removed
    for (const other of ['', 'cat: no such file', 'gps network', '12 passive x;rm'])
      expect(parseTestLocation(other).providers.filter((p) => p === 'passive')).toEqual([]);
    expect(parseTestLocation('').pid).toBeUndefined();
    expect(parseTestLocation('gps network').pid).toBeUndefined();
  });

  it('tells a running host process from one that is gone', () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(spawnSync('true').pid!)).toBe(false);
  });
});
