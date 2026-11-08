import { describe, expect, it } from 'vitest';
import { PhoneConditions } from '../src/phone-conditions.js';
import type { PhoneCondition, PhoneStreamModule } from '../src/phone-stream-port.js';

const UDID = '00008110-000000000000001E';

/** A phone stream that offers these conditions, and keeps what it was told to turn on. */
const phone = (offered: PhoneCondition[]) => {
  const induced: ({ id: string; profile: string } | undefined)[] = [];
  const stream = {
    conditions: () => Promise.resolve(offered),
    induce: (_: string, c?: { id: string; profile: string }) => {
      induced.push(c);
      for (const o of offered) delete o.on;
      const on = offered.find((o) => o.id === c?.id);
      if (on && c) on.on = c.profile;
      return Promise.resolve();
    },
  } as unknown as PhoneStreamModule;
  return { conditions: new PhoneConditions(UDID, () => Promise.resolve(stream)), induced };
};
const offer = (): PhoneCondition[] => [
  {
    id: 'SlowNetworkCondition',
    profiles: ['SlowNetwork3G', 'SlowNetworkEdgeAverage', 'SlowNetworkLTE'],
  },
  { id: 'ThermalCondition', profiles: ['ThermalFair', 'ThermalSerious', 'ThermalCritical'] },
];

describe("an iPhone's conditions", () => {
  it('turns one on by a word or its profile, reads it back, and off by its plain value', async () => {
    const { conditions, induced } = phone(offer());
    expect(await conditions.get('network')).toBe('full');
    expect(await conditions.set('network', 'slow')).toBe(
      "the phone's own SlowNetworkEdgeAverage, as Xcode sets it",
    );
    expect(await conditions.get('network')).toBe('SlowNetworkEdgeAverage');
    await conditions.set('network', 'lte');
    expect(await conditions.get('network')).toBe('SlowNetworkLTE');
    await conditions.set('network', 'full');
    expect(await conditions.get('network')).toBe('full');
    await conditions.set('thermal', 'serious');
    expect(await conditions.get('thermal')).toBe('ThermalSerious');
    expect(induced).toEqual([
      { id: 'SlowNetworkCondition', profile: 'SlowNetworkEdgeAverage' },
      { id: 'SlowNetworkCondition', profile: 'SlowNetworkLTE' },
      undefined,
      { id: 'ThermalCondition', profile: 'ThermalSerious' },
    ]);
  });

  it('holds one at a time, and says what it takes', async () => {
    const { conditions, induced } = phone(offer());
    await conditions.set('thermal', 'critical');
    await expect(conditions.set('network', 'slow')).rejects.toThrow(
      'an iPhone holds one condition at a time, and ThermalCondition is on: restore it first',
    );
    await expect(conditions.set('thermal', 'warm')).rejects.toThrow(
      'thermal: nominal, ThermalFair, ThermalSerious, ThermalCritical, not warm',
    );
    // what is off is left alone
    await conditions.set('network', 'full');
    expect(induced).toHaveLength(1);
  });

  it('refuses with why where the phone stream is not in this build', async () => {
    const gone = new PhoneConditions(UDID, () => Promise.resolve(undefined));
    await expect(gone.set('network', 'slow')).rejects.toThrow('this build has no phone stream');
    await expect(gone.get('thermal')).rejects.toThrow('this build has no phone stream');
  });
});
