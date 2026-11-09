import { describe, expect, it } from 'vitest';
import { Simulators } from '../src/simulators.js';
import type { Simctl } from '../src/simctl.js';

const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-27-2';
const TYPE = 'com.apple.CoreSimulator.SimDeviceType.';

const simulators = (said: string[] = []) =>
  new Simulators(
    {
      list: () =>
        Promise.resolve([
          {
            udid: 'A',
            name: 'Mine',
            state: 'Booted',
            runtime: RUNTIME,
            deviceType: `${TYPE}iPhone-17-Pro`,
          },
          {
            udid: 'C',
            name: 'Tablet',
            state: 'Shutdown',
            runtime: RUNTIME,
            deviceType: `${TYPE}iPad-Pro-11-inch-M5-12GB`,
          },
          {
            udid: 'B',
            name: 'A watch',
            state: 'Shutdown',
            runtime: RUNTIME,
            deviceType: `${TYPE}Apple-Watch-Series-12-46mm`,
          },
        ]),
      typeNames: () =>
        Promise.resolve(new Map([[`${TYPE}iPad-Pro-11-inch-M5-12GB`, 'iPad Pro 11-inch (M5)']])),
      shutdown: (udid: string) => {
        said.push(`shutdown ${udid}`);
        return Promise.resolve();
      },
    } as unknown as Simctl,
    (udid) => {
      said.push(`end the runner of ${udid}`);
      return Promise.resolve();
    },
  );

describe("a Mac's simulators", () => {
  it('are named as people name them, with the hardware each stands for', async () => {
    expect(await simulators().startable()).toEqual([
      { id: 'A', name: 'Mine (iOS 27.2)', state: 'running', serial: 'A', model: 'iPhone 17 Pro' },
      { id: 'C', name: 'Tablet (iOS 27.2)', state: 'stopped', model: 'iPad Pro 11-inch (M5)' },
    ]);
  });

  it('end the runner on one before it shuts down, as a runner alive boots it again', async () => {
    const said: string[] = [];
    await simulators(said).shutdown('A');
    expect(said).toEqual(['end the runner of A', 'shutdown A']);
  });
});
