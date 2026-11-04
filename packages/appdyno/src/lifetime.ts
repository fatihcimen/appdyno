import type { ServerContext } from '@appdyno/ops';

/** How long putting a session's conditions back may hold up the end of the server. */
const END_MS = 20_000;

/**
 * The client closing stdin, a kill and ctrl-C end the session the same way, once. A second signal of a kind
 * finds no listener left, so a server stuck on a device can still be stopped by hand.
 */
export function endWithClient(
  ctx: ServerContext,
  log: (line: object) => void,
  exit: (code: number) => void = process.exit,
  stdin: NodeJS.ReadableStream = process.stdin,
) {
  let ending = false;
  const end = () => {
    if (ending) return;
    ending = true;
    const giveUp = new Promise<string[]>((r) => setTimeout(() => r(['timed out']), END_MS));
    void Promise.race([ctx.end().catch((e: Error) => [e.message]), giveUp]).then((failed) => {
      for (const f of failed) log({ conditionNotRestored: f });
      ctx.close();
      exit(0);
    });
  };
  stdin.once('close', end);
  process.once('SIGTERM', end);
  process.once('SIGINT', end);
}
