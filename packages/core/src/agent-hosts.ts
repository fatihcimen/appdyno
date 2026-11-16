import { channel } from 'node:diagnostics_channel';
import { DeviceError, type Hello } from '@appdyno/protocol';
import { z } from 'zod';
import { reportProgress } from './call.js';
import { TIMEOUTS } from './device.js';
import { heldElsewhere, isThisProcess, Owner, thisOwner } from './owner.js';
import type { RpcClient } from './rpc.js';
import { must } from './must.js';
import { deviceState } from './state.js';

/** The processes of this Mac that use a device's agent: it has no word on who is connected, and a process's end says it left. */
const hosts = deviceState('agent-hosts', z.array(Owner));

/** The agent each device last gave this process. */
const met = new Map<string, number>();
/** By name: a process can hold this module twice, as what is built and what is not, and a test hears both. */
const lost = channel('appdyno.agent.lost');

/**
 * Says when a device's agent is not the one this process had. A read that loses its agent starts another and tries
 * again, and nothing else would show that: what the agent held went with it, and a person paid for its start. `why`:
 * what made this process take the last one as gone, where it knows (the log of the last was written over).
 */
export function agentMet(serial: string, pid: number | undefined, why?: string) {
  if (pid === undefined) return;
  const was = met.get(serial);
  met.set(serial, pid);
  if (was === undefined || was === pid) return;
  const line = `the agent on ${serial} stopped${why ? ` (${why})` : ''}, and another took its place`;
  reportProgress(line);
  process.stderr.write(`${line}\n`);
  lost.publish({ serial, was, pid });
}

/** This process ended it: the next is no news. */
export const agentLeft = (serial: string) => void met.delete(serial);

/** This process uses the device's agent; the live others that do. */
function join(serial: string): Owner[] {
  const now = hosts.update(serial, (was = []) => [...was.filter(heldElsewhere), thisOwner('host')]);
  return (now ?? []).filter((o) => !isThisProcess(o));
}

/**
 * The agent already on a device, if this host is to use it; undefined: it is to start one. A device has one agent, and
 * hosts of one build meet on it. One of another build is replaced, but never under a live host: that host's next call
 * would replace the new one in turn, and two builds, as an update leaves side by side, would take the device from each
 * other for as long as both run. So it stays until its last host has gone, and speaks the same protocol or says so.
 *
 * One that does not answer is gone, and its caller starts another, which ends it: but under a live host only where
 * nothing listens or its process is dead. A hello that only ran out of time, as on a loaded Mac, gets one more go with
 * `TIMEOUTS.hello`, and an agent still silent then is left to the hosts that use it, whose own calls tell a stuck one.
 * `alive`: whether the agent's process is; none: it is taken as alive.
 */
export async function sharedAgent<State extends { sha256: string }>(
  serial: string,
  state: State | undefined,
  sha256: string,
  reach: (state: State, helloMs?: number) => Promise<{ rpc: RpcClient; hello: Hello }>,
  alive: (state: State) => boolean | Promise<boolean> = () => true,
) {
  const others = join(serial);
  const otherBuild = state?.sha256 !== sha256;
  if (!state || (otherBuild && others.length === 0)) return undefined;
  const slow = (e: unknown) => e instanceof DeviceError && e.code === 'TIMEOUT' && !!others[0];
  const agent = await reach(state)
    .catch((e: unknown) => {
      if (!slow(e)) throw e;
      reportProgress(`the agent on ${serial} is slow to answer: asking once more`);
      return reach(state, TIMEOUTS.hello);
    })
    .catch(async (e: unknown) => {
      const [user] = others;
      if (e instanceof DeviceError && e.code === 'AGENT_VERSION_MISMATCH' && user)
        throw new DeviceError(
          e.code,
          `${e.message}, and pid ${user.pid} uses that agent`,
          'update that process, or close it, then retry',
        );
      if (user && slow(e) && (await alive(state)))
        throw new DeviceError(
          'AGENT_UNAVAILABLE',
          `the agent on ${serial} did not answer in ${TIMEOUTS.hello / 1000} s, and was left running: pid ${user.pid} uses it`,
          'retry; that process restarts an agent its own call finds stuck',
        );
      return undefined;
    });
  if (agent && otherBuild)
    reportProgress(
      `using the agent pid ${must(others[0], 'its host').pid} uses, of another build: this one's starts when that has gone`,
    );
  return agent && { ...agent, started: false };
}
