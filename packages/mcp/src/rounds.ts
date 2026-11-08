import { randomBytes, randomUUID } from 'node:crypto';
import {
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  type CallToolResult,
  type InputRequiredResult,
  type ServerContext,
} from '@modelcontextprotocol/server';

/** How long a question waits for the person, who may be away from the screen: past it, no answer is a no. */
export const ASK_MS = 5 * 60_000;

/** How often a call with a progress token says it is still working. */
const BEAT_MS = 5_000;

/** What a call has of the round it is in: its cancel, its progress, and a yes or no put to the person. */
export type Round = {
  signal: AbortSignal;
  progress: (message: string) => void;
  ask: (question: string) => Promise<boolean>;
};

type Turn = { reply: CallToolResult } | { question: string };

/** A waiting call's id, signed by this process: what a client brings back finds that call and no other. */
const WAITING_ID = createRequestStateCodec<string>({ key: randomBytes(32) });

/** What checks the id a round brings back, before its call is found. */
export const verifyRound = WAITING_ID.verify.bind(WAITING_ID);

type Call = ReturnType<typeof calling>;

/** Calls stopped at a question: every round of a call comes to the process that asked, over stdio and `--http` alike. */
const waiting = new Map<string, Call>();

/** One run of a call, across the rounds of its questions: its cancel and progress are those of the round it is in. */
function calling(name: string, run: (round: Round) => Promise<CallToolResult>) {
  const started = Date.now();
  const stop = new AbortController();
  let sent = 0;
  let progress: ((message: string) => void) | undefined;
  let wake: ((turn: Turn) => void) | undefined;
  let ready: Turn | undefined;
  let answer: ((yes: boolean) => void) | undefined;
  let expiry: NodeJS.Timeout | undefined;
  const turn = (t: Turn) => {
    if (wake) wake(t);
    else ready = t;
    wake = undefined;
  };
  const answered = (yes: boolean) => {
    clearTimeout(expiry);
    answer?.(yes);
    answer = undefined;
  };
  void run({
    signal: stop.signal,
    progress: (message) => progress?.(message),
    ask: (question) =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
        turn({ question });
      }),
  }).then((reply) => turn({ reply }));
  return {
    answered,
    /** Unanswered for `ASK_MS`, the question is a no, and the call goes on with it. */
    expire(forget: () => void) {
      expiry = setTimeout(() => {
        forget();
        answered(false);
      }, ASK_MS);
      // a client gone with a question open does not keep the process alive
      expiry.unref();
    },
    async round(ctx: ServerContext): Promise<Turn> {
      const token = ctx.mcpReq._meta?.progressToken;
      progress =
        token === undefined
          ? undefined
          : (message) =>
              void ctx.mcpReq
                .notify({
                  method: 'notifications/progress',
                  params: { progressToken: token, progress: ++sent, message },
                })
                .catch(() => undefined);
      const beat =
        progress &&
        setInterval(
          () =>
            progress?.(`${name}: still working (${Math.round((Date.now() - started) / 1000)} s)`),
          BEAT_MS,
        );
      const cancel = () => stop.abort();
      if (ctx.mcpReq.signal.aborted) cancel();
      ctx.mcpReq.signal.addEventListener('abort', cancel, { once: true });
      try {
        const t = ready ?? (await new Promise<Turn>((resolve) => (wake = resolve)));
        ready = undefined;
        return t;
      } finally {
        clearInterval(beat);
        progress = undefined;
        ctx.mcpReq.signal.removeEventListener('abort', cancel);
      }
    },
  };
}

/**
 * This round's answer to a tool call: the call's own, or the question it stopped at, which the person answers by the
 * client's prompt, an empty form whose accept is the yes. No request goes back to a client on 2026-07-28, so the round
 * that asks ends with the question, and the round that brings the answer finds the call where it stopped, so nothing
 * it did before is done again. The SDK does the same for a 2025 client, asking it itself. `late`: a round whose call is
 * no longer waiting.
 */
export async function inRound(
  name: string,
  ctx: ServerContext,
  run: (round: Round) => Promise<CallToolResult>,
  late: () => CallToolResult,
): Promise<CallToolResult | InputRequiredResult> {
  const id = ctx.mcpReq.requestState<string>();
  let call: Call | undefined;
  if (id !== undefined) {
    call = waiting.get(id);
    if (!call) return late();
    waiting.delete(id);
    const said = inputResponse(ctx.mcpReq.inputResponses, 'yes');
    call.answered(said.kind === 'elicit' && said.action === 'accept');
  }
  call ??= calling(name, run);
  const t = await call.round(ctx);
  if ('reply' in t) return t.reply;
  const key = randomUUID();
  waiting.set(key, call);
  call.expire(() => waiting.delete(key));
  return inputRequired({
    inputRequests: {
      yes: inputRequired.elicit({
        mode: 'form',
        message: t.question,
        requestedSchema: { type: 'object', properties: {} },
      }),
    },
    requestState: await WAITING_ID.mint(key),
  });
}
