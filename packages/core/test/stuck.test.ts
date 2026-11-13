import { describe, expect, it, vi } from 'vitest';
import { DeviceError } from '@appdyno/protocol';
import { afterTimeout } from '../src/stuck.js';
import { fakeAgent } from '@appdyno/testing/fake-agent.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';

const timeout = new DeviceError('TIMEOUT', 'act took longer than 15000 ms');

describe('a call that timed out', () => {
  it(
    'restarts an agent whose work lane does not answer a quick call either',
    fakeTimed(async () => {
      const { rpc, seen } = fakeAgent({ 'app.foreground': () => new Promise(() => undefined) });
      const restart = vi.fn(() => Promise.resolve(undefined));
      const e = (await afterTimeout(timeout, rpc, restart, 50)) as DeviceError;
      expect(seen.map((x) => x.method)).toContain('app.foreground');
      expect(restart).toHaveBeenCalledOnce();
      expect(e).toMatchObject({
        code: 'TIMEOUT',
        hint: expect.stringMatching(/restarted/) as unknown,
      });
    }),
  );

  it(
    'keeps what the call that timed out said to do, as a touch it was may have gone through',
    fakeTimed(async () => {
      const { rpc } = fakeAgent({ 'app.foreground': () => new Promise(() => undefined) });
      const restart = () => Promise.resolve(undefined);
      const tap = new DeviceError(
        'TIMEOUT',
        "XCTest's event synthesizer did not answer a tap, which may have gone through",
        'read the screen to see whether it did before doing it again',
      );
      expect(((await afterTimeout(tap, rpc, restart, 50)) as DeviceError).hint).toBe(
        'the agent was stuck and has been restarted: read the screen to see whether it did before doing it again',
      );
      expect(((await afterTimeout(timeout, rpc, restart, 50)) as DeviceError).hint).toBe(
        'the agent was stuck and has been restarted: read the screen, then try again',
      );
    }),
  );

  it('leaves an agent that answers alone (a slow call, not a stuck agent)', async () => {
    const { rpc } = fakeAgent({ 'app.foreground': () => ({ result: { pkg: 'a.b' } }) });
    const restart = vi.fn(() => Promise.resolve(undefined));
    expect(await afterTimeout(timeout, rpc, restart, 500)).toBe(timeout);
    expect(restart).not.toHaveBeenCalled();
  });

  it('asks nothing after any other failure', async () => {
    const { rpc, seen } = fakeAgent();
    const restart = vi.fn(() => Promise.resolve(undefined));
    const other = new DeviceError('NO_FOCUS', 'no field');
    expect(await afterTimeout(other, rpc, restart, 50)).toBe(other);
    expect(seen).toHaveLength(0);
    expect(restart).not.toHaveBeenCalled();
  });
});

describe('what held a stuck agent up', () => {
  it(
    'is said before what to do, where the device can tell',
    fakeTimed(async () => {
      const { rpc } = fakeAgent({ 'app.foreground': () => new Promise(() => undefined) });
      const restart = () => Promise.resolve('a.b is not responding');
      expect(((await afterTimeout(timeout, rpc, restart, 50)) as DeviceError).hint).toBe(
        'the agent was stuck and has been restarted: a.b is not responding; read the screen, then try again',
      );
    }),
  );
});
