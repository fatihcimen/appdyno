import type { EnergyReading } from './measure.js';

/**
 * One busy core: about 260 mA at a nominal 3.8 V, within what Android's power profile documentation gives as examples
 * of `cpu.active` (https://source.android.com/docs/core/power/values). Round: to rank runs of one app, not to predict
 * a battery.
 */
const CPU_WATTS = 1;
/** The top of its examples of `radio.active`, 300 mA at 3.8 V, moving 5 MB/s, in the same round terms. */
const NANOJOULES_PER_BYTE = 200;

/**
 * The one model: where a device gives no energy of its own, an estimate from what it does count, never a reading:
 * `energy = 1 W x CPU time + 200 nJ x bytes`.
 */
export function modelledEnergy(cpuMs: number, bytes: number): EnergyReading {
  // a millisecond at a watt is a millijoule
  const cpu = Math.round(cpuMs * CPU_WATTS);
  const network = Math.round((bytes * NANOJOULES_PER_BYTE) / 1e6);
  return {
    mj: cpu + network,
    modelled: true,
    breakdown: { cpu, network },
    note: `A model, not a reading: ${CPU_WATTS} W x CPU time + ${NANOJOULES_PER_BYTE} nJ x bytes, for telling runs apart on one device.`,
  };
}
