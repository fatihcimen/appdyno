import { describe, expect, it } from 'vitest';
import { noiseOf, recordsOf, type DeviceInfo, type Metric } from '../src/record.js';

const device: DeviceInfo = {
  serial: 'Y9',
  platform: 'android',
  model: '25078RA3EY',
  os: '16',
  virtual: false,
};
const noise = (load: number, deviceParked?: number) =>
  noiseOf({
    device,
    build: 'release',
    load: {
      host: [1],
      hostCpus: 15,
      device: [load, load, load],
      ...(deviceParked !== undefined && { deviceParked }),
    },
  });

describe('the load of the Mac', () => {
  const run = (host: number, device_: DeviceInfo, metrics: Metric[]) =>
    recordsOf(
      {
        run: 'r',
        app: 'a',
        scenario: 's',
        source: 'x',
        raw: '',
        device: device_,
        build: 'release',
        load: { host: [host], hostCpus: 15 },
        tool: 't',
        at: '2026-11-04T00:00:00.000Z',
      },
      metrics,
    );
  const iphone = { ...device, platform: 'ios' as const, model: 'iPhone14,3', os: '27.0.1' };
  const throughTheMac: Metric = {
    kind: 'launch.until_ms',
    unit: 'ms',
    samples: [3_000],
    throughHost: true,
  };
  const itsOwn: Metric = { kind: 'memory.kb', unit: 'kb', samples: [1_000] };

  it('marks a phone’s reading through the Mac, at high load, and not its own', () => {
    const [through, own] = run(100, iphone, [throughTheMac, itsOwn]);
    expect(through).toMatchObject({ kind: 'launch.until_ms', noise: ['high-host-load'] });
    expect(own).toMatchObject({ kind: 'memory.kb', noise: [] });
  });

  it('keeps the number it marks', () => {
    expect(run(100, iphone, [throughTheMac])[0]).toMatchObject({ value: 3_000, samples: [3_000] });
  });

  it('marks nothing on a calm Mac, and nothing of a phone’s own however it is', () => {
    expect(run(5, iphone, [throughTheMac, itsOwn]).flatMap((r) => r.noise)).toEqual([]);
    expect(run(100, device, [{ ...throughTheMac, throughHost: false }])[0]!.noise).toEqual([]);
  });

  it('marks every reading of a virtual device at high load, as it did', () => {
    const emulator = { ...device, virtual: true };
    expect(run(100, emulator, [itsOwn])[0]!.noise).toEqual(['high-host-load']);
  });
});

describe('the device load a run is judged by', () => {
  it('leaves out kernel threads asleep: a calm Xiaomi reads 14.31 with 14 of them', () => {
    expect(noise(14.31, 14)).toEqual([]);
  });

  it('still calls a phone busy past the parked ones', () => {
    expect(noise(24, 14)).toEqual(['high-device-load']);
  });

  it('judges a record with no parked count by its whole load', () => {
    expect(noise(14.31)).toEqual(['high-device-load']);
    expect(noise(3)).toEqual([]);
  });

  it('goes by the CPU’s share where it has one: a Xiaomi at rest read 23.35 at 6 %', () => {
    const atShare = (deviceBusy: number) =>
      noiseOf({
        device,
        build: 'release',
        load: {
          host: [1],
          hostCpus: 15,
          device: [23.35, 22.74, 18.93],
          deviceParked: 14,
          deviceBusy,
        },
      });
    expect(atShare(6)).toEqual([]);
    expect(atShare(99)).toEqual(['high-device-load']);
  });
});
