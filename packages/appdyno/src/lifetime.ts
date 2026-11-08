/** How long putting a session's conditions back may hold up the end of the server. */
const END_MS = 20_000;
/** How long a command has to end its own way, as a flight recorder saves on its way out. */
export const STOP_MS = 5_000;
/** Says that a command's stdin is the hub's, held for as long as the hub lives. */
export const HELD_BY_HUB = 'APPDYNO_HELD_BY_HUB';

type Ending = { end(): Promise<string[]>; close(): void };

/** A session's end: what it changed goes back, within END_MS, and its devices close. */
export async function putBack(ctx: Ending, log: (line: object) => void) {
  const giveUp = new Promise<string[]>((r) => setTimeout(() => r(['timed out']), END_MS));
  const failed = await Promise.race([
    ctx.end().catch((e: unknown) => [e instanceof Error ? e.message : String(e)]),
    giveUp,
  ]);
  for (const f of failed) log({ conditionNotRestored: f });
  ctx.close();
}

/**
 * The client closing stdin, a kill and ctrl-C end the session the same way, once. A second signal of a kind
 * finds no listener left, so a server stuck on a device can still be stopped by hand. With no stdin to watch,
 * as a server over HTTP has no client that started it, only the signals.
 */
export function endWithClient(
  ctx: Ending,
  log: (line: object) => void,
  exit: (code: number) => void = (code) => process.exit(code),
  stdin: NodeJS.ReadableStream | null = process.stdin,
) {
  let ending = false;
  const end = () => {
    if (ending) return;
    ending = true;
    void putBack(ctx, log).then(() => exit(0));
  };
  stdin?.once('close', end);
  process.once('SIGTERM', end);
  process.once('SIGINT', end);
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
