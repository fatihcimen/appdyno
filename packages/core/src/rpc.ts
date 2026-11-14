import type { Duplex } from 'node:stream';
import {
  DeviceError,
  ERROR_CODES,
  FRAME_JSON,
  FrameDecoder,
  METHODS,
  PROTOCOL,
  codeOfRpc,
  encodeJson,
  type ErrorCode,
  type Hello,
  type Method,
  type ParamsOf,
  type ResultOf,
} from '@appdyno/protocol';
import { z } from 'zod';
import { callSignal, cancelled } from './call.js';

/** Extra time the host gives a request over the agent's own deadline before it gives up itself. */
const DEADLINE_SLACK_MS = 1_000;

/** The timeouts this host gave up on: an agent's own TIMEOUT is an answer, and its lane moved. */
const unanswered = new WeakSet<Error>();
export const noAnswer = (e: unknown) => e instanceof Error && unanswered.has(e);

type Pending = {
  method: string;
  resolve: (v: { result: unknown; binary?: Buffer }) => void;
  reject: (e: DeviceError) => void;
  timer: NodeJS.Timeout;
  binary?: Buffer;
};

const Response = z.object({
  id: z.number().int(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number().int(),
      message: z.string(),
      data: z.object({ code: z.string().optional(), hint: z.string().optional() }).optional(),
    })
    .optional(),
});

/**
 * JSON-RPC over the agent's frame stream: one request per id, results validated against the protocol's
 * schemas, a deadline on every call (the agent gets it as `_deadlineMs` and stops its work; the host
 * gives up a second later and asks it to cancel), all pending calls failed when the stream ends.
 */
export class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly decoder = new FrameDecoder();
  private closedWith: DeviceError | undefined;
  private readonly closeListeners: ((e: DeviceError) => void)[] = [];

  constructor(
    private readonly stream: Duplex,
    initial: Buffer = Buffer.alloc(0),
  ) {
    stream.on('data', (b: Buffer) => this.onData(b));
    stream.on('close', () =>
      this.fail(new DeviceError('AGENT_UNAVAILABLE', 'the agent closed the connection')),
    );
    stream.on('error', (e) =>
      this.fail(new DeviceError('AGENT_UNAVAILABLE', `the agent connection failed: ${e.message}`)),
    );
    if (initial.length) this.onData(initial);
    stream.resume();
  }

  get closed(): boolean {
    return this.closedWith !== undefined;
  }

  /** What closed it. */
  get closedWhy(): string | undefined {
    return this.closedWith?.message;
  }

  onClose(fn: (e: DeviceError) => void) {
    this.closeListeners.push(fn);
  }

  async call<M extends Method>(
    method: M,
    params: ParamsOf<M>,
    opts: { timeoutMs: number },
  ): Promise<{ result: ResultOf<M>; binary?: Buffer }> {
    const asked = (METHODS[method].params as z.ZodType<object>).safeParse(params);
    if (!asked.success)
      throw new DeviceError('INVALID_ARGUMENT', `${method}: ${z.prettifyError(asked.error)}`);
    const raw = await this.callRaw(
      method,
      { ...asked.data, _deadlineMs: opts.timeoutMs },
      opts.timeoutMs,
    );
    const parsed = (METHODS[method].result as z.ZodType).safeParse(raw.result);
    if (!parsed.success)
      throw new DeviceError(
        'INTERNAL',
        `the agent's ${method} result does not match the protocol: ${parsed.error.message.slice(0, 300)}`,
      );
    return { result: parsed.data as ResultOf<M>, ...(raw.binary && { binary: raw.binary }) };
  }

  private callRaw(method: string, params: object, timeoutMs: number) {
    if (this.closedWith) return Promise.reject(this.closedWith);
    const signal = callSignal();
    if (signal?.aborted) return Promise.reject(cancelled(method));
    const id = this.nextId++;
    return new Promise<{ result: unknown; binary?: Buffer }>((resolve, reject) => {
      // fire and forget: the agent stops the work if it is still running
      const giveUp = (why: DeviceError) => {
        off();
        this.pending.delete(id);
        if (!this.closedWith)
          this.stream.write(
            encodeJson({ jsonrpc: '2.0', id: this.nextId++, method: 'cancel', params: { id } }),
          );
        reject(why);
      };
      const timer = setTimeout(() => {
        const e = new DeviceError('TIMEOUT', `${method} did not answer within ${timeoutMs} ms`);
        unanswered.add(e);
        giveUp(e);
      }, timeoutMs + DEADLINE_SLACK_MS);
      const abort = () => {
        clearTimeout(timer);
        giveUp(cancelled(method));
      };
      const off = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        method,
        resolve: (v) => {
          off();
          resolve(v);
        },
        reject: (e) => {
          off();
          reject(e);
        },
        timer,
      });
      this.stream.write(encodeJson({ jsonrpc: '2.0', id, method, params }));
    });
  }

  close() {
    this.stream.destroy();
    this.fail(new DeviceError('AGENT_UNAVAILABLE', 'the connection was closed'));
  }

  private onData(b: Buffer) {
    let frames;
    try {
      frames = this.decoder.push(b);
    } catch (e) {
      this.stream.destroy();
      this.fail(new DeviceError('INTERNAL', `the agent stream is broken: ${(e as Error).message}`));
      return;
    }
    for (const f of frames) {
      if (f.type !== FRAME_JSON) {
        const p = this.pending.get(f.id);
        if (p) p.binary = f.data;
        continue;
      }
      const msg = Response.safeParse(f.message);
      if (!msg.success) continue; // not a response (the agent sends no requests)
      const p = this.pending.get(msg.data.id);
      if (!p) continue; // a late answer to a call that timed out, or to a cancel
      this.pending.delete(msg.data.id);
      clearTimeout(p.timer);
      if (msg.data.error) {
        const e = msg.data.error;
        const named = e.data?.code;
        const code =
          named !== undefined && (ERROR_CODES as readonly string[]).includes(named)
            ? (named as ErrorCode)
            : codeOfRpc(e.code);
        p.reject(new DeviceError(code, e.message, e.data?.hint));
      } else {
        p.resolve({ result: msg.data.result, ...(p.binary && { binary: p.binary }) });
      }
    }
  }

  private fail(e: DeviceError) {
    if (this.closedWith) return;
    this.closedWith = e;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(e);
    }
    for (const fn of this.closeListeners) fn(e);
  }
}

/** A new connection, once the agent took the token and speaks this protocol; closed if not. */
export async function greet(
  socket: ConstructorParameters<typeof RpcClient>[0],
  rest: Buffer | undefined,
  who: 'agent' | 'runner',
  token: string,
  timeoutMs: number,
): Promise<{ rpc: RpcClient; hello: Hello }> {
  const rpc = new RpcClient(socket, rest);
  try {
    const { result } = await rpc.call('hello', { token, protocol: PROTOCOL.major }, { timeoutMs });
    if (result.protocol.major !== PROTOCOL.major)
      throw new DeviceError(
        'AGENT_VERSION_MISMATCH',
        `${who} protocol ${result.protocol.major}, host ${PROTOCOL.major}`,
      );
    return { rpc, hello: result };
  } catch (e) {
    rpc.close();
    throw e;
  }
}
