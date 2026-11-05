import { clientCalls, type ClientCall, type ClientLink } from '@appdyno/core';
import { BROWSER_CLIENTS, CLIENTS, type Client, type Named, type Stdio } from './clients.js';
import { fileOf, outcomeFor, type InstallOptions } from './install.js';

/**
 * How a client stands: `connected` only by a real call on record, `added` with its entry there and no call yet,
 * `open` with no entry, `refused` with a file `install` will not edit, `absent` where it has no file or folder on this
 * Mac, `browser` where there is nothing to do here.
 */
export type ClientState = 'connected' | 'added' | 'open' | 'refused' | 'absent' | 'browser';

export type ClientRow = {
  name: string;
  state: ClientState;
  /** Where its servers are kept, on a client that is here. */
  file?: string;
  /** Its entry does not hold what `install` would write, as after an app moved. */
  stale?: boolean;
  /** Why its file is left alone. */
  why?: string;
  /** Its last real call. */
  last?: string;
  check?: Named['check'];
  /** Its name in Turkish, where it has one. */
  tr?: string;
};

type Where = Pick<InstallOptions, 'home' | 'env' | 'server'>;

const heardFrom = (client: Named, link: ClientLink, calls: ClientCall[]) =>
  calls.filter((c) => c.link === link && client.says.test(c.name)).sort(newestFirst)[0];

const spoken = ({ name, check, tr }: Named) => ({ name, check, ...(tr && { tr }) });

const newestFirst = (a: ClientCall, b: ClientCall) => b.last.localeCompare(a.last);

function hereRow(client: Client, file: string, o: Where, calls: ClientCall[]): ClientRow {
  const { did, why } = outcomeFor(client, file, o);
  const base = { ...spoken(client), file };
  if (did === 'refused') return { ...base, state: 'refused', ...(why && { why }) };
  if (did === 'added') return { ...base, state: 'open' };
  // only the app has a command of its own: with none, a command set by hand is no staler than the npm package's
  const stale = did === 'replaced' && o.server !== undefined;
  const call = heardFrom(client, 'stdio', calls);
  return call
    ? { ...base, state: 'connected', last: call.last, ...(stale && { stale }) }
    : { ...base, state: 'added', ...(stale && { stale }) };
}

/** A name no row of the list answers to has still called: it gets a row of its own, and is never put under another's. */
const stranger = (call: ClientCall): ClientRow => ({
  name: call.name,
  state: 'connected',
  last: call.last,
});

/** Every client of the list as it stands on this Mac, and any other that has called. */
export function clientRows(o: Where, calls = clientCalls()): ClientRow[] {
  const rows = CLIENTS.map((client): ClientRow => {
    const file = fileOf(client, o);
    return file ? hereRow(client, file, o, calls) : { ...spoken(client), state: 'absent' };
  });
  const browser = BROWSER_CLIENTS.map((client): ClientRow => {
    const call = heardFrom(client, 'http', calls);
    return {
      ...spoken(client),
      state: call ? 'connected' : 'browser',
      ...(call && { last: call.last }),
    };
  });
  const known = (c: ClientCall) =>
    (c.link === 'stdio' ? CLIENTS : BROWSER_CLIENTS).some((n) => n.says.test(c.name));
  return [...rows, ...browser, ...calls.filter((c) => !known(c)).map(stranger)];
}

/** What a client runs, as its own entry says, for trying that and not what `install` would write. */
export function entryCommand(
  entry: unknown,
): (Stdio & { env?: Record<string, string> }) | undefined {
  const { command, args, env } = (entry ?? {}) as Record<string, unknown>;
  const [first, ...rest] = Array.isArray(command) ? (command as string[]) : [command];
  if (typeof first !== 'string') return undefined;
  const given = env && typeof env === 'object' ? (env as Record<string, string>) : undefined;
  return {
    command: first,
    args: Array.isArray(args) ? (args as string[]) : (rest as string[]),
    ...(given && { env: given }),
  };
}
