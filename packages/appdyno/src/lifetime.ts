import { spawn } from 'node:child_process';
import { processAlive, sleep } from '@appdyno/core';
import type { ServerContext } from '@appdyno/ops';

/** How long putting a session's conditions back may hold up the end of the server. */
const END_MS = 20_000;
/** How long a command has to end its own way, as a flight recorder saves on its way out. */
export const STOP_MS = 5_000;
/** Says that a command's stdin is the hub's, held for as long as the hub lives. */
export const HELD_BY_HUB = 'APPDYNO_HELD_BY_HUB';

type Ending = {
  end(handedOff?: string[]): Promise<string[]>;
  close(): void;
  leftBehind?(): string[];
};

/**
 * A session's end: what it changed goes back, within END_MS, and its devices close. Of the devices in `handedOff`,
 * another process puts back what is kept on disk once this one has gone.
 */
export async function putBack(ctx: Ending, log: (line: object) => void, handedOff: string[] = []) {
  const giveUp = new Promise<string[]>((r) => setTimeout(() => r(['timed out']), END_MS));
  const failed = await Promise.race([
    ctx.end(handedOff).catch((e: unknown) => [e instanceof Error ? e.message : String(e)]),
    giveUp,
  ]);
  for (const f of failed) log({ conditionNotRestored: f });
  ctx.close();
}

/**
 * The client closing stdin, a kill and ctrl-C end the session the same way, once. A second signal of a kind
 * finds no listener left, so a server stuck on a device can still be stopped by hand. With no stdin to watch,
 * as a server over HTTP has no client that started it, only the signals. `handOff` starts what puts back the rest once
 * this process has gone, and says for which devices: a client may kill its server half a second after its first word,
 * as claude -p does (SIGINT, SIGTERM 0.1 s later, SIGKILL 0.5 s after that), where an emulator's text size takes
 * seconds to go back, and a kill midway left 1.0 and en-US where both were unset.
 */
export function endWithClient(
  ctx: Ending,
  log: (line: object) => void,
  exit: (code: number) => void = (code) => process.exit(code),
  stdin: NodeJS.ReadableStream | null = process.stdin,
  handOff?: (devices: string[]) => string[],
) {
  let ending = false;
  const end = () => {
    if (ending) return;
    ending = true;
    const away = handOff?.(ctx.leftBehind?.() ?? []) ?? [];
    void putBack(ctx, log, away).then(() => exit(0));
  };
  stdin?.once('close', end);
  process.once('SIGTERM', end);
  process.once('SIGINT', end);
}

/** What makes `appdyno mcp` the process that puts back what a server left on a device, once that server has gone. */
export const PUT_BACK_AFTER = 'put-back-after';

/**
 * Starts `appdyno mcp`, as this one was started, for each device: once this process has gone, it puts back what this
 * one left there. Apart from this process's group, so that no kill of the server reaches it. The devices it started for.
 */
export function handOff(devices: string[], argv = process.argv): string[] {
  return devices.filter((serial) => {
    try {
      const args = [
        ...argv.slice(1),
        `--${PUT_BACK_AFTER}`,
        String(process.pid),
        '--device',
        serial,
      ];
      spawn(process.execPath, [...process.execArgv, ...args], {
        detached: true,
        stdio: ['ignore', 'ignore', 'inherit'],
      })
        .on('error', () => undefined)
        .unref();
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * `appdyno mcp --put-back-after <pid>`: once that server has gone, a session on its device starts, which puts back what
 * the server left there, and the device's settings are let reach its disk.
 */
export async function putBackAfter(pid: number, ctx: ServerContext, log: (line: object) => void) {
  // the client's pipe, its stderr, may have gone with the server
  process.stderr.on('error', () => undefined);
  // the server's own end takes up to END_MS
  const end = Date.now() + 2 * END_MS;
  while (processAlive(pid) && Date.now() < end) await sleep(100);
  const serial = ctx.selected;
  if (serial && !processAlive(pid)) {
    const s = await ctx.use(serial).catch((e: unknown) => {
      log({ putBackAfter: pid, serial, failed: [e instanceof Error ? e.message : String(e)] });
      return undefined;
    });
    const { restored = [], failed = [] } = ctx.leftovers.get(serial) ?? {};
    if (s) log({ putBackAfter: pid, serial, restored, failed });
    if (s && restored.length > 0) await s.device.settings.persist?.().catch(() => undefined);
  }
  ctx.close();
}

/**
 * A command the hub runs: a hub that dies with no word would leave it driving a device with no window. Its stdin closing
 * is a Ctrl-C to all it started, then an end none can refuse, with no one left to ask. The word stops here, as what it
 * starts has a stdin of its own, and a command that is done is done, whatever its stdin.
 */
export function endWithHub(
  given?: Pick<typeof process.stdin, 'once' | 'resume' | 'unref'>,
  signal: (name: NodeJS.Signals) => void = (name) => process.kill(0, name),
) {
  if (!process.env[HELD_BY_HUB]) return;
  Reflect.deleteProperty(process.env, HELD_BY_HUB);
  // only here: a command no hub started has its stdin left as it found it
  const stdin = given ?? process.stdin;
  stdin.once('close', () => {
    signal('SIGINT');
    setTimeout(() => signal('SIGKILL'), STOP_MS).unref();
  });
  stdin.resume();
  stdin.unref();
}
