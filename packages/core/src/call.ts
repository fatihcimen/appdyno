import { AsyncLocalStorage } from 'node:async_hooks';
import { DeviceError } from '@appdyno/protocol';

/** What a client's request brings to every device call under it, however deep. */
export type CallScope = { signal?: AbortSignal; progress?: (message: string) => void };

const scope = new AsyncLocalStorage<CallScope>();

export const inCall = <T>(s: CallScope, fn: () => Promise<T>): Promise<T> => scope.run(s, fn);

/** The abort signal of the request being served, if any. */
export const callSignal = () => scope.getStore()?.signal;

/** Tells the client what a long operation is doing, when it asked to be told. */
export const reportProgress = (message: string) => scope.getStore()?.progress?.(message);

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
