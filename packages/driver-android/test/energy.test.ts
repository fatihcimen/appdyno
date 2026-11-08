import { describe, expect, it } from 'vitest';
import { energy } from '../src/perf/app.js';
import type { PerfDevice } from '../src/perf/shared.js';

const UID = 10_192;
const usage = (row: string) =>
  `  Estimated power use (mAh):\n    Capacity: 3000, Computed drain: 0, actual drain: 0\n${row}\n\n`;
const row = (mah: number, cpu: number) =>
  `    UID u0a192: ${mah} ( cpu=${cpu} (1s) screen=0.1 (5s) ) `;

/** A device that answers what a read asks, in turn, and says which commands it was given. */
function device(reads: string[], guard = 'Enabled: no-auto-reset') {
  const sent: string[] = [];
  let tick = 0;
  const left = [...reads];
  const shell = (cmd: string) => {
    const c = cmd.replace(/^LC_ALL=C /, '');
    sent.push(c);
    if (c.startsWith('pm list packages')) return Promise.resolve(`package:dev.app uid:${UID}\n`);
    if (c.startsWith('pidof')) return Promise.resolve('4242\n');
    if (c.startsWith('cat /proc/4242/stat'))
      return Promise.resolve(`4242 (app) S 1 2 3 4 5 6 7 8 9 10 ${(tick += 200)} 0 0 0\n100\n`);
    if (c.includes('netstats')) return Promise.resolve('');
    if (c.includes('enable no-auto-reset')) return Promise.resolve(guard);
    if (c.includes('batterystats --usage')) return Promise.resolve(left.shift() ?? '');
    return Promise.resolve('');
  };
  return { sent, d: { serial: 'x', shell } as unknown as PerfDevice };
}

describe('energy on Android', () => {
  it('is the count of the window, a model of Android, with the battery put back', async () => {
    const { d, sent } = device([usage(row(1, 0.5)), usage(row(1.5, 0.9))]);
    const { value } = await energy(d, 'dev.app', 10);
    expect(value).toMatchObject({ mah: 0.5, modelled: true });
    expect(value.note).toMatch(/batterystats/);
    expect(value.mj).toBeUndefined();
    expect(sent.indexOf('dumpsys batterystats enable no-auto-reset')).toBeLessThan(
      sent.indexOf('dumpsys battery unplug'),
    );
    expect(sent.at(-1)).toMatch(/battery reset; dumpsys batterystats disable no-auto-reset/);
  });

  it("is this tool's model where the power profile computes nothing", async () => {
    // no row at all, as an emulator's for an app that only used the CPU
    const none = await energy(device([usage(''), usage('')]).d, 'dev.app', 10);
    expect(none.value).toMatchObject({ modelled: true, breakdown: { network: 0 } });
    expect(none.value.mj).toBeGreaterThan(0);
    // a row that grew, with nothing for a core that was busy
    const flat = await energy(device([usage(row(1, 0)), usage(row(1.2, 0))]).d, 'dev.app', 10);
    expect(flat.value.note).toMatch(/A model, not a reading/);
    expect(flat.value.mah).toBeUndefined();
  });

  it('never unplugs a build that does not take the guard', async () => {
    const { d, sent } = device([usage(row(1, 0.5)), usage(row(1.5, 0.9))], 'unknown option');
    const { value } = await energy(d, 'dev.app', 10);
    expect(sent).not.toContain('dumpsys battery unplug');
    expect(value.note).toMatch(/A model, not a reading/);
    expect(sent.at(-1)).toMatch(/battery reset/);
  });

  it('puts the battery back when a read fails', async () => {
    const { d, sent } = device([]);
    const failing = {
      ...d,
      shell: async (cmd: string) => {
        if (cmd.includes('--usage')) throw new Error('adb went away');
        return d.shell(cmd);
      },
    };
    await expect(energy(failing, 'dev.app', 10)).rejects.toThrow('adb went away');
    expect(sent.at(-1)).toMatch(/battery reset/);
  });
});
