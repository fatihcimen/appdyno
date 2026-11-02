import { describe, expect, it } from 'vitest';
import { DeviceError } from '@appdyno/protocol';
import { inCall } from '../src/call.js';
import { HELLO, TOKEN, fakeAgent, wireTree } from './fake-agent.js';

describe('rpc client', () => {
  it('validates results and passes the deadline to the agent', async () => {
    const { rpc, seen } = fakeAgent({ 'tree.get': () => ({ result: wireTree([{ t: 'x' }]) }) });
    expect(
      (await rpc.call('hello', { token: TOKEN, protocol: 1 }, { timeoutMs: 1000 })).result,
    ).toEqual(HELLO);
    const { result } = await rpc.call('tree.get', {}, { timeoutMs: 2500 });
    expect(result.nodes).toHaveLength(2);
    expect(seen[1]).toEqual({ method: 'tree.get', params: { _deadlineMs: 2500 } });
  });

  it('returns a typed error with its code and hint', async () => {
    const { rpc } = fakeAgent({ 'text.set': () => ({ error: 'NO_FOCUS', message: 'no field' }) });
    const e = await rpc
      .call('text.set', { text: 'a' }, { timeoutMs: 1000 })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DeviceError);
    expect((e as DeviceError).code).toBe('NO_FOCUS');
    expect((e as DeviceError).retryable).toBe(false);
  });

  it('refuses a result that does not match the protocol', async () => {
    const { rpc } = fakeAgent({ 'tree.get': () => ({ result: { nodes: 'nope' } }) });
    await expect(rpc.call('tree.get', {}, { timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('times out a call the agent never answers and asks it to cancel', async () => {
    const { rpc, seen } = fakeAgent({ 'tree.get': () => new Promise(() => undefined) });
    const t = Date.now();
    await expect(rpc.call('tree.get', {}, { timeoutMs: 50 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
    expect(Date.now() - t).toBeGreaterThanOrEqual(50);
    expect(seen.at(-1)?.method).toBe('cancel');
  }, 5_000);

  it('gives up a call when the client cancels, and tells the agent', async () => {
    const { rpc, seen } = fakeAgent({ 'tree.get': () => new Promise(() => undefined) });
    const abort = new AbortController();
    const call = inCall({ signal: abort.signal }, () =>
      rpc.call('tree.get', {}, { timeoutMs: 60_000 }),
    );
    setTimeout(() => abort.abort(), 10);
    await expect(call).rejects.toMatchObject({ code: 'CANCELLED' });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.at(-1)?.method).toBe('cancel');
    await expect(
      inCall({ signal: abort.signal }, () => rpc.call('tree.get', {}, { timeoutMs: 1000 })),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  }, 5_000);

  it('fails every pending call when the stream ends, and later calls at once', async () => {
    const { rpc, agent } = fakeAgent({ 'tree.get': () => new Promise(() => undefined) });
    const pending = rpc.call('tree.get', {}, { timeoutMs: 5_000 });
    agent.destroy();
    await expect(pending).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' });
    await expect(rpc.call('ping', {}, { timeoutMs: 100 })).rejects.toMatchObject({
      code: 'AGENT_UNAVAILABLE',
    });
  });

  it('delivers a binary attachment with its response', async () => {
    const png = Buffer.from([137, 80, 78, 71]);
    const { rpc } = fakeAgent({
      screenshot: () => ({ result: { w: 1, h: 1, format: 'png', bytes: 4 }, binary: png }),
    });
    const r = await rpc.call('screenshot', { format: 'png' }, { timeoutMs: 1000 });
    expect(r.binary).toEqual(png);
  });
});
