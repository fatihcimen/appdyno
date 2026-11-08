import { describe, expect, it } from 'vitest';
import {
  clearStaleTestLocation,
  clearTestLocation,
  locationScript,
  parseLocationRun,
  parseTestLocation,
  removableProviders,
} from '../src/location.js';

describe('test location bookkeeping', () => {
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

describe('clearing the test location', () => {
  const dumpsys = `    gps provider [mock]:
      extra attribution tags={appdyno}
`;
  /** A device's shell with this marker file; what it was told to do comes back in `ran`. */
  const shellWith = (marker: string) => {
    const ran: string[] = [];
    return {
      ran,
      shell: (command: string) => {
        ran.push(command);
        if (command.startsWith('cat ')) return Promise.resolve(marker);
        return Promise.resolve(command === 'dumpsys location' ? dumpsys : '');
      },
    };
  };
  const removal = (ran: string[]) => ran.filter((c) => c.includes('remove-test-provider'));
  const GONE = 999_999;

  it('removes what is still ours, and the marker', async () => {
    const { ran, shell } = shellWith(`${process.pid} gps`);
    await clearTestLocation(shell);
    expect(removal(ran)[0]).toMatch(/remove-test-provider gps; rm -f /);
  });

  it('at a new agent, leaves the providers of a host that still runs', async () => {
    const { ran, shell } = shellWith(`${process.pid} gps`);
    await clearStaleTestLocation(shell);
    expect(removal(ran)).toEqual([]);
  });

  it('at a new agent, removes the providers of a host that has gone', async () => {
    const { ran, shell } = shellWith(`${GONE} gps`);
    await clearStaleTestLocation(shell);
    expect(removal(ran)).toHaveLength(1);
  });
});
