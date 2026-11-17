import { describe, expect, it } from 'vitest';
import type { Simctl } from '../src/simctl.js';
import { SimulatorSettings } from '../src/sim-settings.js';

const SIM = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';

/** A simulator whose runner turns it: down until something starts it, as one is before a turn. */
function turned(turns = 1) {
  const said: string[] = [];
  let up = false;
  const settings = new SimulatorSettings({} as Simctl, SIM, undefined, {
    start: () => {
      said.push('runner up');
      up = true;
      return Promise.resolve();
    },
    now: () => Promise.resolve(up ? turns : undefined),
    set: (rotation) => {
      said.push(`turned to ${rotation}`);
      turns = rotation;
      return Promise.resolve();
    },
  });
  return { settings, said };
}

describe("a simulator's turn", () => {
  it('is read by its runner once a turn brings it up, by the names a turn takes', async () => {
    const { settings, said } = turned(1);
    // a read alone starts no runner: what a run's record reads leaves it out
    await expect(settings.get('orientation')).rejects.toThrow('which is not up');
    await settings.willChange('orientation');
    expect(await settings.get('orientation')).toBe('landscape_left');
    expect(said).toEqual(['runner up']);
  });

  it('is put back as it was read, by the runner', async () => {
    const { settings, said } = turned(3);
    await settings.willChange('orientation');
    const was = await settings.get('orientation');
    await settings.set('orientation', 'portrait');
    await settings.set('orientation', was);
    expect(await settings.get('orientation')).toBe('landscape_right');
    expect(said).toEqual(['runner up', 'turned to 0', 'turned to 3']);
    await expect(settings.set('orientation', 'sideways')).rejects.toThrow(
      'orientation: as get reads it, not sideways',
    );
  });

  it('has nothing to read where no runner turns it', async () => {
    const settings = new SimulatorSettings({} as Simctl, SIM);
    await settings.willChange('orientation');
    await expect(settings.get('orientation')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});
