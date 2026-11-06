import { tracesDir, type StartupAnalysis } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { parseLaunchPhases } from './launch-phases.js';
import { recordTrace, traceTable } from './trace.js';

/** Long enough for a start and its first frame; a start that takes longer loses its last phases, and says so by them. */
const LAUNCH_SECONDS = 8;

/**
 * One start under the App Launch template, by the phases of its life cycle table. The tool starts the app itself, and
 * iOS lets it only for an app signed for development (`get-task-allow`): a system app is refused at once.
 */
export async function appLaunchPhases(
  device: string,
  bundle: string,
  env?: Record<string, string>,
): Promise<StartupAnalysis> {
  const tracePath = await recordTrace({
    template: 'App Launch',
    device,
    launch: { app: bundle, ...(env && { env }) },
    seconds: LAUNCH_SECONDS,
    dir: tracesDir(),
  });
  const { phases, totalMs } = parseLaunchPhases(await traceTable(tracePath, 'life-cycle-period'));
  if (!phases.length)
    throw new DeviceError(
      'UNSUPPORTED',
      `App Launch recorded no phases of ${bundle}`,
      `the trace is at ${tracePath}`,
    );
  return {
    tracePath,
    durMs: totalMs,
    reasons: [],
    breakdown: phases.map((p) => ({ reason: p.name, ms: p.ms })),
    findings: [],
  };
}
