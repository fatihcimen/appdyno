import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  locationScript,
  mockedProviders,
  parseLocationRun,
  parseTestLocation,
  processAlive,
  removableProviders,
} from '../src/location.js';

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

  const block = (p: string, tags?: string) =>
    [
      `    ${p} provider [mock]:`,
      '      enabled=true',
      ...(tags ? [`      extra attribution tags={${tags}}`] : []),
      '      last mock location=null',
    ].join('\n');

  it('takes as ours only what its own add created, never a provider by its absence from a snapshot', () => {
    // the owner's network mock was not in the snapshot taken before (it appeared late): the probe of its
    // test state succeeded on the device, so it is used as it is, never added, never listed
    const out = 'had network\nmade gps\nmade fused/plain\ndone\n';
    expect(parseLocationRun(out)).toEqual({ had: ['network'], made: ['gps', 'fused/plain'] });
    // the device script decides by that probe, then adds with our tag (and without it where none is taken)
    const script = locationScript('41.008200,28.978400');
    expect(script).toContain(
      'if cmd location providers set-test-provider-enabled network true >/dev/null 2>&1; then echo "had network"',
    );
    expect(script).toContain('add-test-provider gps --extraAttributionTags appdyno');
    expect(script).not.toContain('dumpsys');
  });

  it('removes a listed provider only while it is still a test provider with our tag', () => {
    const dump = [
      '  Location Providers:',
      block('gps', 'appdyno'),
      block('network'),
      block('fused'),
      '    passive provider:',
      '      enabled=true',
    ].join('\n');
    // gps: ours; network: not listed (the owner's); fused: listed with our tag but replaced since by
    // someone's own mock without it
    expect(removableProviders(['gps', 'fused'], dump)).toEqual(['gps']);
    // created where the release takes no tag: still a test provider is enough
    expect(removableProviders(['fused/plain'], dump)).toEqual(['fused']);
    // gone already: nothing to remove
    expect(
      removableProviders(['gps'], '  Location Providers:\n    gps provider:\n      enabled=true\n'),
    ).toEqual([]);
    expect(parseTestLocation('4242 gps fused/plain\n')).toEqual({
      pid: 4242,
      providers: ['gps', 'fused/plain'],
    });
  });
});
