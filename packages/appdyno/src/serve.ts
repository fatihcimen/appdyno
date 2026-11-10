import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer, listenOn, serveHttp } from '@appdyno/mcp';
import { DEFAULT_POLICY, opsFor, type Policy, type ServerContext } from '@appdyno/ops';
import { endWithClient, handOff, putBack, putBackAfter, PUT_BACK_AFTER } from './lifetime.js';
import { COMMANDS } from './usage.js';

const flags = (args: string[]) => parseArgs({ args, options: COMMANDS.mcp.flags }).values;

export type ServerFlags = ReturnType<typeof flags>;

const listOf = (s: string | undefined) =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * What this server may do, by its flags, else the environment: no tool call sets any of it. A list given empty, as a
 * script's unset variable gives it, is refused, as it would let in every device, app or link.
 */
export function policyOf(values: ServerFlags, env: NodeJS.ProcessEnv = process.env): Policy {
  const given = (flag: 'allow-devices' | 'allow-apps' | 'allow-urls', name: string) => {
    const said = values[flag] ?? env[name];
    if (said !== undefined && listOf(said).length === 0)
      throw new Error(
        `--${flag} (${name}) is empty, which would let in every one: give what it lets in, or leave it out`,
      );
    return said;
  };
  const regex = (s: string | undefined) => (s === undefined ? undefined : new RegExp(s));
  const devices = regex(given('allow-devices', 'APPDYNO_ALLOW_DEVICES'));
  const urls = regex(given('allow-urls', 'APPDYNO_ALLOW_URLS'));
  const loss = values['allow-data-loss'] ?? env.APPDYNO_ALLOW_DATA_LOSS;
  if (loss !== undefined && loss !== 'virtual' && loss !== 'all')
    throw new Error(`--allow-data-loss takes virtual or all, not ${loss}`);
  const power = values['allow-power'] ?? env.APPDYNO_ALLOW_POWER;
  if (power !== undefined && power !== 'virtual' && power !== 'all')
    throw new Error(`--allow-power takes virtual or all, not ${power}`);
  return {
    ...DEFAULT_POLICY,
    ...(devices && { devices }),
    ...(urls && { urls }),
    apps: listOf(given('allow-apps', 'APPDYNO_ALLOW_APPS')),
    allowHome: !values['no-home'],
    secrets: listOf(env.APPDYNO_SECRETS),
    ...(loss && { allowDataLoss: loss }),
    ...(power && { allowPower: power }),
  };
}

/** It goes in a URL as well as a header, and it is all that stands between a tunnel and a phone. */
const GOOD_TOKEN = /^[\w.~-]{32,}$/;

/** The one in the environment, if it will do: a flag's value would show in `ps`. */
export function tokenFromEnv(token = process.env.APPDYNO_HTTP_TOKEN) {
  if (token !== undefined && !GOOD_TOKEN.test(token))
    throw new Error(
      'APPDYNO_HTTP_TOKEN takes 32 or more letters, digits or . _ ~ -: openssl rand -hex 32 makes one',
    );
  return token;
}

/**
 * `appdyno mcp`: the MCP server over stdio, until its client closes stdin or a signal ends it. With `--http`,
 * the same server on this Mac's loopback until a signal ends it, with a context for each client in turn.
 * @internal the bin's own, and the published types have none of what it takes
 */
export async function serveCommand(
  args: string[],
  context: (values: ServerFlags) => ServerContext,
) {
  const values = flags(args);
  const log = (line: object) =>
    process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), ...line })}\n`);
  // a device named at the start: its first call finds what it needs started
  const started = (ctx: ServerContext) => {
    if (ctx.selected) ctx.warm(ctx.selected);
    return ctx;
  };
  const after = values[PUT_BACK_AFTER];
  if (after) {
    await putBackAfter(Number(after), context(values), log);
    process.exit(0);
  }
  if (!values.http) {
    const ctx = started(context(values));
    endWithClient(ctx, log, undefined, undefined, handOff);
    // either revision, as the client's first message says
    const ops = opsFor(ctx);
    serveStdio(() => createServer(ops, log));
    return;
  }
  const listen = listenOn(values.http);
  const given = tokenFromEnv();
  const token = given ?? randomBytes(32).toString('base64url');
  // a flag it cannot use is said now, not to the first client
  context(values).close();
  const http = await serveHttp({
    ...listen,
    token,
    open: () => {
      const ctx = started(context(values));
      return { ops: opsFor(ctx), end: () => putBack(ctx, log) };
    },
    log,
  });
  const nothingLeft = { end: () => http.stop().then(() => []), close: () => undefined };
  // the hub's own holds stdin open, so that a hub that dies with no word takes this way in with it
  const parent = values['end-with-parent'] ? process.stdin : null;
  parent?.resume();
  endWithClient(nothingLeft, log, undefined, parent);
  const shown = given ? '$APPDYNO_HTTP_TOKEN' : token;
  process.stderr.write(
    `appdyno mcp: ${http.url}\n  send the header  Authorization: Bearer ${shown}\n  or, for a client with no field for it, use  ${http.url}/${shown}\nwhoever has this token and can reach this address drives your devices\n`,
  );
}
