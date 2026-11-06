import { DeviceError } from '@appdyno/protocol';
import type { RpcClient } from './rpc.js';

/** How long the agent's work lane gets to answer a quick call after another call timed out. */
const STUCK_PROBE_MS = 3_000;

/**
 * After a call timed out: the agent does its device work one job at a time, so a job stuck past its
 * deadline would turn every later call into a TIMEOUT too. A quick call through the same lane tells;
 * when it times out as well, the agent is restarted (`restart`) and the caller's TIMEOUT says so. Any
 * other failure comes back as it was.
 */
export async function afterTimeout(
  e: unknown,
  rpc: RpcClient | undefined,
  restart: () => Promise<void>,
  probeMs = STUCK_PROBE_MS,
): Promise<unknown> {
  if (!(e instanceof DeviceError) || e.code !== 'TIMEOUT' || !rpc || rpc.closed) return e;
  const stuck = await rpc.call('app.foreground', {}, { timeoutMs: probeMs }).then(
    () => false,
    (x: unknown) => x instanceof DeviceError && x.code === 'TIMEOUT',
  );
  if (!stuck) return e;
  await restart().catch(() => undefined);
  return new DeviceError(
    'TIMEOUT',
    e.message,
    'the agent was stuck and has been restarted: try again',
    { cause: e },
  );
}
