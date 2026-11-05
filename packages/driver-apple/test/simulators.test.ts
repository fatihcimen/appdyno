import { describe, expect, it } from 'vitest';
import { Simulators } from '../src/simulator-manage.js';
import type { Simctl } from '../src/simctl.js';

const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-27-2';
const TYPE = 'com.apple.CoreSimulator.SimDeviceType.';

const simulators = () =>
  new Simulators({
    list: async () => [
      {
        udid: 'A',
        name: 'Mine',
        state: 'Booted',
        runtime: RUNTIME,
        deviceType: `${TYPE}iPhone-17-Pro`,
      },
      {
        udid: 'B',
        name: 'A watch',
        state: 'Shutdown',
        runtime: RUNTIME,
        deviceType: `${TYPE}Apple-Watch-Series-12-46mm`,
      },
    ],
  } as unknown as Simctl);

describe("a Mac's simulators", () => {
  it('are named as people name them, with the hardware each stands for', async () => {
    expect(await simulators().startable()).toEqual([
      { id: 'A', name: 'Mine (iOS 27.2)', state: 'running', serial: 'A', model: 'iPhone 17 Pro' },
    ]);
  });
});
