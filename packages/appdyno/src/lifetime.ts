/** How long putting a session's conditions back may hold up the end of the server. */
const END_MS = 20_000;

type Ending = { end(): Promise<string[]>; close(): void };

/** A session's end: what it changed goes back, within END_MS, and its devices close. */
export async function putBack(ctx: Ending, log: (line: object) => void) {
  const giveUp = new Promise<string[]>((r) => setTimeout(() => r(['timed out']), END_MS));
  const failed = await Promise.race([ctx.end().catch((e: Error) => [e.message]), giveUp]);
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
  exit: (code: number) => void = process.exit,
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
