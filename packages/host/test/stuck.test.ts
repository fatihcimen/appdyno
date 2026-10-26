import { describe, expect, it, vi } from 'vitest';
import { DeviceError } from '@appdyno/protocol';
import { afterTimeout } from '../src/stuck.js';
import { fakeAgent } from './fake-agent.js';

const timeout = new DeviceError('TIMEOUT', 'act took longer than 15000 ms');

describe('a call that timed out', () => {
  it('restarts an agent whose work lane does not answer a quick call either', async () => {
    const { rpc, seen } = fakeAgent({ 'app.foreground': () => new Promise(() => undefined) });
    const restart = vi.fn(async () => undefined);
    const e = (await afterTimeout(timeout, rpc, restart, 50)) as DeviceError;
    expect(seen.map((x) => x.method)).toContain('app.foreground');
    expect(restart).toHaveBeenCalledOnce();
    expect(e).toMatchObject({ code: 'TIMEOUT', hint: expect.stringMatching(/restarted/) });
  });

  it('leaves an agent that answers alone (a slow call, not a stuck agent)', async () => {
    const { rpc } = fakeAgent({ 'app.foreground': () => ({ result: { pkg: 'a.b' } }) });
    const restart = vi.fn(async () => undefined);
    expect(await afterTimeout(timeout, rpc, restart, 500)).toBe(timeout);
    expect(restart).not.toHaveBeenCalled();
  });

  it('asks nothing after any other failure', async () => {
    const { rpc, seen } = fakeAgent();
    const restart = vi.fn(async () => undefined);
    const other = new DeviceError('NO_FOCUS', 'no field');
    expect(await afterTimeout(other, rpc, restart, 50)).toBe(other);
    expect(seen).toHaveLength(0);
    expect(restart).not.toHaveBeenCalled();
  });
});
