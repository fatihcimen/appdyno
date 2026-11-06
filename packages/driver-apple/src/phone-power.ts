import {
  sleep,
  tracesDir,
  type EnergyReading,
  type Measured,
  type NetworkReading,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { parsePowerBytes, parsePowerImpact } from './trace-parse.js';
import { recordTrace, traceTable } from './trace.js';

const clamp = (seconds: number, least: number) =>
  Math.min(Math.max(Math.round(seconds), least), 30);

/** Its bytes come in periods of 5 s and the unfinished last one is left out: this much longer holds what `during` moved. */
const LAST_PERIOD_SECONDS = 6;
const LEAST_POWER_SECONDS = 5;

/**
 * The Power Profiler attached to the app. Over every process it has no app's rows, and the template holds the
 * instrument that crashes the tool at stop (measured with Xcode 27.1, iOS 27.0.1): the instrument alone, attached,
 * records on a cable and charging, and needs no `get-task-allow`.
 */
async function recordPower(
  device: string,
  bundle: string,
  pid: () => Promise<number>,
  seconds: number,
  during?: () => Promise<unknown>,
) {
  const trace = await recordTrace({
    template: 'Power Profiler',
    instrument: true,
    device,
    attach: pid,
    attachedOnly: true,
    seconds,
    dir: tracesDir(),
    ...(during && { during }),
  });
  const xml = await traceTable(trace, 'ProcessSubsystemPowerImpact');
  const known = await pid();
  if (!parsePowerImpact(xml, known))
    throw new DeviceError(
      'UNSUPPORTED',
      `the Power Profiler recorded no row of ${bundle}`,
      `the trace is at ${trace}`,
    );
  return { trace, xml, pid: known };
}

/** The app's power impact, iOS's own estimate by subsystem. */
export async function phoneEnergy(
  device: string,
  bundle: string,
  pid: () => Promise<number>,
  windowMs: number,
): Promise<Measured<EnergyReading>> {
  const r = await recordPower(device, bundle, pid, clamp(windowMs / 1000, LEAST_POWER_SECONDS));
  const breakdown = parsePowerImpact(r.xml, r.pid)!;
  return {
    value: {
      impact: Object.values(breakdown).reduce((a, b) => a + b, 0),
      breakdown,
      note: "Instruments' power impact of the app, a relative score by subsystem from iOS's own estimate; no joules, no mAh.",
    },
    raw: r.trace,
    at: new Date().toISOString(),
  };
}

/** The app's bytes over Wi-Fi and cellular, as iOS counts its process. */
export async function phoneNetwork(
  device: string,
  bundle: string,
  pid: () => Promise<number>,
  windowMs: number,
  during?: () => Promise<unknown>,
): Promise<Measured<NetworkReading>> {
  const seconds = clamp(windowMs / 1000, 1) + LAST_PERIOD_SECONDS;
  const r = await recordPower(
    device,
    bundle,
    pid,
    seconds,
    // the recording's first moment reads no process yet
    during && (() => sleep(1_000).then(during)),
  );
  return {
    value: {
      ...parsePowerBytes(r.xml, r.pid),
      note: "The app's process as iOS counts it, Wi-Fi and cellular, IP and TCP headers included, in periods of 5 s; not what another process fetched for the app.",
    },
    raw: r.trace,
    at: new Date().toISOString(),
  };
}
