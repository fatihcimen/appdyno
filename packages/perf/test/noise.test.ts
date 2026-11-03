import { describe, expect, it } from 'vitest';
import { noiseOf, type DeviceInfo } from '../src/record.js';

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
});
