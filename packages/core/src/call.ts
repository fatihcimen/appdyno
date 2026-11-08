import { AsyncLocalStorage } from 'node:async_hooks';
import { DeviceError } from '@appdyno/protocol';

/** What a client's request brings to every device call under it, however deep. */
export type CallScope = {
  signal?: AbortSignal;
  progress?: (message: string) => void;
  /** Who is calling, as it named itself. */
  client?: string;
  /** Puts a yes or no question to the person, by the client's own prompt or a terminal: none where nobody can be asked. */
  ask?: (question: string) => Promise<boolean>;
  /** What the call did on the way that its answer says: a tool it fetched. */
  notes?: string[];
  /** When the op being served began, in ms since the epoch: what it set off on the device dates from then. */
  opStartedAt?: number;
};

const scope = new AsyncLocalStorage<CallScope>();

export const inCall = <T>(s: CallScope, fn: () => Promise<T>): Promise<T> => scope.run(s, fn);

/** `fn` as an op of its own, within the call it serves: what it does on the device dates from now. */
export const inOp = <T>(fn: () => Promise<T>): Promise<T> =>
  scope.run({ ...scope.getStore(), opStartedAt: Date.now() }, fn);

/** When the op being served began, if one is. */
export const opStartedAt = () => scope.getStore()?.opStartedAt;

/** The abort signal of the request being served, if any. */
export const callSignal = () => scope.getStore()?.signal;

/** Tells the client what a long operation is doing, when it asked to be told. */
export const reportProgress = (message: string) => scope.getStore()?.progress?.(message);

/** Puts a line in the answer of the call being served, once, where an answer is made by `noting`. */
export function noteInAnswer(line: string) {
  const notes = scope.getStore()?.notes;
  if (notes && !notes.includes(line)) notes.push(line);
}

/**
 * `fn` in the scope of the call it serves, with the lines it noted for its answer. Within another's, as a step or a
 * flow's op, what it notes goes to the outer one, whose answer is the one a client reads.
 */
export async function noting<T>(fn: () => Promise<T>): Promise<{ value: T; notes: string[] }> {
  const store = scope.getStore();
  if (store?.notes) return { value: await fn(), notes: [] };
  const notes: string[] = [];
  const value = await scope.run({ ...store, notes }, fn);
  return { value, notes };
}

/** The client whose request this is, if it gave a name. */
export const callClient = () => scope.getStore()?.client;

/** How to ask the person behind this request, if anyone can be asked. */
export const callAsk = () => scope.getStore()?.ask;

export const cancelled = (what: string) =>
  new DeviceError('CANCELLED', `${what}: cancelled by the client`, 'the client cancelled the call');

export function throwIfCancelled(what = 'the call') {
  if (callSignal()?.aborted) throw cancelled(what);
}

/** A wait the client's cancel ends at once. */
export function pause(ms: number): Promise<void> {
  const signal = callSignal();
  return new Promise((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener('abort', stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(cancelled('the wait'));
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
  });
}

/** A wait no cancel ends: what comes after it decides, as a start that must finish or clean up after itself. */
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
