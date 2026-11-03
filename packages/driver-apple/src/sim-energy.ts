import { run, sleep, type EnergyReading, type Measured } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { helperBinary } from './simhelper.js';

const readNj = async (pid: number) => {
  const { stdout } = await run(await helperBinary('SimEnergy'), [String(pid)], {
    timeout: 30_000,
  }).catch((e: Error) => {
    throw new DeviceError('UNSUPPORTED', `no energy count of process ${pid}: ${e.message}`);
  });
  return Number((JSON.parse(stdout) as { energyNj: number }).energyNj);
};

/** What this Mac's kernel counts for a simulator app's process over the window: a reading, of the Mac's chip. */
export async function simulatorEnergy(
  pid: number,
  windowMs: number,
): Promise<Measured<EnergyReading>> {
  const before = await readNj(pid);
  await sleep(windowMs);
  const after = await readNj(pid);
  return {
    value: {
      mj: Math.round((after - before) / 1e5) / 10,
      note: "This Mac's energy for the app's process, as its kernel counts it (ri_energy_nj), not a phone's.",
    },
    raw: `${before} ${after}`,
    at: new Date().toISOString(),
  };
}
