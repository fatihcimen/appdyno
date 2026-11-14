import { DeviceError } from '@appdyno/protocol';
import { noAnswer, type RpcClient } from './rpc.js';

/** How long the agent's work lane gets to answer a quick call after another call timed out. */
const STUCK_PROBE_MS = 3_000;

/**
 * After a call timed out: the agent does its device work one job at a time, so a job stuck past its
 * deadline would turn every later call into a TIMEOUT too. A quick call through the same lane tells;
 * when it times out as well, the agent is restarted (`restart`, which may say what held it up) and the
 * caller's TIMEOUT says so. Any other failure comes back as it was.
 */
export async function afterTimeout(
  e: unknown,
  rpc: RpcClient | undefined,
  restart: (rpc: RpcClient) => Promise<string | undefined | { left: string }>,
  probeMs = STUCK_PROBE_MS,
): Promise<unknown> {
  if (!(e instanceof DeviceError) || e.code !== 'TIMEOUT' || !rpc || rpc.closed) return e;
  // stuck is no answer at all: one that came too late to start (TIMEOUT) still says the lane moved
  const stuck = await rpc
    .call('app.foreground', {}, { timeoutMs: probeMs })
    .then(() => false, noAnswer);
  if (!stuck) return e;
  const why = await restart(rpc).catch(() => undefined);
  if (typeof why === 'object')
    return new DeviceError(
      'TIMEOUT',
      e.message,
      `the agent was left running: ${why.left}; wait, or end the app's work on this screen, then read it again`,
      { cause: e },
    );
  return new DeviceError(
    'TIMEOUT',
    e.message,
    // what the call said to do still holds: a touch it timed out on may have gone through
    `the agent was stuck and has been restarted: ${why ? `${why}; ` : ''}${e.hint ?? 'read the screen, then try again'}`,
    { cause: e },
  );
}
