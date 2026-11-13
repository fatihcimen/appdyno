import { describe, expect, it, vi } from 'vitest';
import { DeviceError } from '@appdyno/protocol';
import { IosSimulatorDevice } from '../src/index.js';
import { Simctl } from '../src/simctl.js';

const UDID = 'C8F701E7-9A02-4465-AC91-F4C85FBA788D';
const APP = 'dev.appdyno.fixture';

/** A simulator tool that answers every call with nothing. */
const quiet = () => Object.assign(new Simctl({}), { exec: () => Promise.resolve('') });

const tree = { windows: [], nodes: [], hash: 'h', truncated: false };

describe("a simulator's runner, started behind the helper", () => {
  const device = (direct: object) => {
    const d = new IosSimulatorDevice(UDID, quiet(), { close: vi.fn(), ...direct } as never);
    const callNow = vi.fn(() => Promise.reject(new Error('a runner was asked for')));
    Object.assign(d, { callNow, keepDump: () => Promise.resolve(undefined) });
    return { d, callNow };
  };

  it('starts at the first read of an opened simulator, once and out of the queue, not as it is chosen', async () => {
    const read = vi.fn(() => Promise.resolve({ busy: false, copies: false, tree }));
    const { d } = device({ warm: vi.fn(), read, front: () => Promise.resolve(APP) });
    const ensure = vi.fn(() => new Promise(() => undefined));
    Object.assign(d, { ensure, helloInfo: { screen: { w: 402, h: 874 } } });
    d.warm();
    expect(ensure).not.toHaveBeenCalled();
    await d.tree();
    await d.tree();
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('does not start behind a command that ends with its answer, which would wait for it', async () => {
    const read = vi.fn(() => Promise.resolve({ busy: false, copies: false, tree }));
    const d = new IosSimulatorDevice(
      UDID,
      quiet(),
      { close: vi.fn(), read, front: () => Promise.resolve(APP) } as never,
      { behind: false },
    );
    const ensure = vi.fn(() => new Promise(() => undefined));
    Object.assign(d, {
      ensure,
      keepDump: () => Promise.resolve(undefined),
      helloInfo: { screen: { w: 402, h: 874 } },
    });
    await d.tree();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('is not waited for by a read of a control found twice while it starts: that read is the helper’s', async () => {
    const read = vi.fn(() => Promise.resolve({ busy: false, copies: true, tree }));
    const { d, callNow } = device({ read, front: () => Promise.resolve(APP) });
    Object.defineProperty(d, 'agentStarting', { value: true });
    await expect(d.tree()).resolves.toMatchObject({ hash: 'h' });
    expect(callNow).not.toHaveBeenCalled();
  });

  it('is asked of such a read where none is starting, as only it tells which copy a tap reaches', async () => {
    const read = vi.fn(() => Promise.resolve({ busy: false, copies: true, tree }));
    const { d, callNow } = device({ read, front: () => Promise.resolve(APP) });
    await expect(d.tree()).rejects.toThrow('a runner was asked for');
    expect(callNow).toHaveBeenCalled();
  });

  it("counts toward a settle's clock only what a call waited for it, not a start no call waited on", async () => {
    const d = new IosSimulatorDevice(UDID, quiet(), { close: vi.fn() } as never);
    Object.assign(d, { targetApp: APP });
    const base = Object.getPrototypeOf(Object.getPrototypeOf(IosSimulatorDevice.prototype)) as {
      callNow: () => Promise<unknown>;
    };
    const answer = vi
      .spyOn(base, 'callNow')
      .mockImplementation(() => new Promise((r) => setTimeout(() => r({ result: {} }), 30)));
    const waited = () => (d as unknown as { startingMs: number }).startingMs;
    Object.defineProperty(d, 'runnerUp', { value: true, configurable: true });
    await (d as unknown as { callNow: (m: string) => Promise<unknown> }).callNow('tree.get');
    expect(waited()).toBe(0);
    Object.defineProperty(d, 'runnerUp', { value: false, configurable: true });
    await (d as unknown as { callNow: (m: string) => Promise<unknown> }).callNow('tree.get');
    expect(waited()).toBeGreaterThanOrEqual(25);
    answer.mockRestore();
  });
});

describe('a simulator whose helper does not answer', () => {
  it('says so where the runner taken in its place does not start either', async () => {
    const hello = () => Promise.reject(new Error('the helper did not answer within 30000 ms'));
    const d = new IosSimulatorDevice(UDID, quiet(), { close: vi.fn(), hello } as never);
    let owner: object = Object.getPrototypeOf(IosSimulatorDevice.prototype) as object;
    while (!Object.prototype.hasOwnProperty.call(owner, 'open'))
      owner = Object.getPrototypeOf(owner) as object;
    const runner = vi
      .spyOn(owner as { open: () => Promise<unknown> }, 'open')
      .mockRejectedValue(
        new DeviceError('AGENT_UNAVAILABLE', 'the iOS runner did not start within 181 s'),
      );
    await expect(d.open()).rejects.toMatchObject({
      code: 'AGENT_UNAVAILABLE',
      message:
        "the iOS runner did not start within 181 s, after the simulator's helper did not answer: the helper did not answer within 30000 ms",
    });
    runner.mockRestore();
  });
});
