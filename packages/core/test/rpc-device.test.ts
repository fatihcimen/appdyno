import { describe, expect, it } from 'vitest';
import {
  DeviceError,
  PROTOCOL,
  type ActParams,
  type Hello,
  type Method,
  type Tree,
} from '@appdyno/protocol';
import { readStateFile, writeStateFile } from '../src/state.js';
import { assertLatLon, RpcDevice } from '../src/rpc-device.js';
import { greet } from '../src/rpc.js';
import type { ActOptions } from '../src/device.js';
import {
  fakeAgent,
  fakeAgentStream,
  HELLO,
  TOKEN,
  wireTree,
  type FakeHandler,
} from './fake-agent.js';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { plainScreen } from './plain-screen.js';

class TestDevice extends RpcDevice {
  readonly platform = 'android' as const;
  readonly platformScreen = plainScreen;
  protected readonly retrySafe = new Set<Method>(['tree.get']);
  connects = 0;

  constructor(private readonly agents: Record<string, FakeHandler>[]) {
    super();
  }

  protected async startAgent() {
    const { rpc } = fakeAgent(this.agents[this.connects++]!);
    return { rpc, hello: HELLO as Hello, started: true };
  }

  protected async restartStuck() {}

  async tree(): Promise<Tree> {
    return (await this.call('tree.get', {}, 1_000)).result;
  }

  act(action: ActParams, opts: ActOptions = {}) {
    return this.queue.run(() => this.actNow(action, opts, 0));
  }
}

const gone: FakeHandler = () => ({ error: 'AGENT_UNAVAILABLE' });
const tree: FakeHandler = () => ({ result: wireTree([{ t: 'Merhaba' }]) });

describe('a device through its agent', () => {
  it('reads its clock past whatever the device is busy with', async () => {
    let let_go = () => undefined as void;
    const d = new TestDevice([
      {
        'tree.get': () =>
          new Promise((resolve) => {
            let_go = () => resolve({ result: wireTree([{ t: 'Merhaba' }]) });
          }),
        ping: () => ({ result: { uptimeMs: 1, atMs: 1234.5 } }),
      },
    ]);
    await d.open();
    const busy = d.tree();
    // held up by the queue this would never answer, and the test would time out
    await expect(d.wallClock()).resolves.toBe(1234.5);
    let_go();
    await busy;
  });

  it('connects once, and reads a screen with stable refs', async () => {
    const d = new TestDevice([{ 'tree.get': tree }]);
    expect((await d.open()).model).toBe('Fake');
    expect(d.hello?.model).toBe('Fake');
    const s = await d.read();
    expect(s.list.map((e) => e.label)).toEqual(['Merhaba']);
    expect(d.connects).toBe(1);
  });

  it('asks again on a fresh connection when a read finds the agent gone, once', async () => {
    const d = new TestDevice([{ 'tree.get': gone }, { 'tree.get': tree }]);
    expect((await d.tree()).nodes.length).toBeGreaterThan(0);
    expect(d.connects).toBe(2);
  });

  it('does not ask again for an action: it may have happened', async () => {
    const d = new TestDevice([{ act: gone }, { act: () => ({ result: {} }) }]);
    await expect(d.tap({ x: 1, y: 2 })).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' });
    expect(d.connects).toBe(1);
  });

  it.each([
    ['NOT_FOUND', true],
    ['INTERNAL', true],
    ['STALE', false],
    ['SCREEN_OFF', false],
    ['INVALID_ARGUMENT', false],
    ['NO_FOCUS', false],
  ] as const)(
    'says whether an action that failed with %s may have gone out',
    async (code, sent) => {
      const refused: FakeHandler = () => ({ error: code });
      const touch = new TestDevice([{ act: refused }]);
      const e = await touch.tap({ x: 1, y: 1 }, {}).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(DeviceError);
      expect((e as DeviceError).sent).toBe(sent);
      const text = new TestDevice([{ 'text.set': refused }]);
      const t = await text.typeText('hi').catch((x: unknown) => x);
      expect((t as DeviceError).sent).toBe(sent);
    },
  );

  it('words a touch as an act, and answers what the agent answers', async () => {
    const asked: Record<string, unknown>[] = [];
    const d = new TestDevice([
      {
        act: (p) => {
          asked.push(p);
          return { result: { hash: 'h' } };
        },
      },
    ]);
    await expect(d.tap({ x: 1, y: 2 }, { settle: false, read: 'hash' })).resolves.toEqual({
      hash: 'h',
    });
    await d.swipe({ x: 0, y: 0 }, { x: 1, y: 1 });
    expect(asked[0]).toMatchObject({ action: { kind: 'tap', x: 1, y: 2 }, read: 'hash' });
    expect(asked[0]).not.toHaveProperty('settle');
    expect(asked[1]).toMatchObject({
      action: { kind: 'swipe', durationMs: 300 },
      settle: {},
      read: 'none',
    });
  });

  it('refuses a screenshot that came without its image', async () => {
    const d = new TestDevice([
      { screenshot: () => ({ result: { w: 1, h: 1, format: 'jpeg', bytes: 0 } }) },
    ]);
    await expect(d.screenshot()).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('starts again after close', async () => {
    const d = new TestDevice([{}, {}]);
    await d.open();
    d.close();
    await d.open();
    expect(d.connects).toBe(2);
  });

  it('takes a position on the planet only', () => {
    expect(() => assertLatLon(41, 29)).not.toThrow();
    for (const [lat, lon] of [
      [91, 0],
      [0, 181],
      [Number.NaN, 0],
    ])
      expect(() => assertLatLon(lat!, lon!)).toThrow(DeviceError);
  });
});

describe('the hello on a new connection', () => {
  it('gives the client and what the agent said', async () => {
    const { host } = fakeAgentStream();
    const { rpc, hello } = await greet(host, undefined, 'agent', TOKEN, 1_000);
    expect(hello.model).toBe('Fake');
    expect(rpc.closed).toBe(false);
    rpc.close();
  });

  it('closes it when the other side speaks another protocol, and says who', async () => {
    const major = PROTOCOL.major + 1;
    const { host } = fakeAgentStream({
      hello: () => ({ result: { ...HELLO, protocol: { major } } }),
    });
    await expect(greet(host, undefined, 'runner', TOKEN, 1_000)).rejects.toMatchObject({
      code: 'AGENT_VERSION_MISMATCH',
      message: `runner protocol ${major}, host ${PROTOCOL.major}`,
    });
    expect(host.destroyed).toBe(true);
  });

  it('closes it when the token is refused', async () => {
    const { host } = fakeAgentStream();
    await expect(greet(host, undefined, 'agent', 'wrong', 1_000)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    expect(host.destroyed).toBe(true);
  });
});

describe('an agent state file', () => {
  const State = z.object({ token: z.string() });
  const file = () => join(mkdtempSync(join(tmpdir(), 'appdyno-state-')), 'state.json');

  it('is read back, readable by this user alone', async () => {
    const f = file();
    await writeStateFile(f, { token: 't' });
    await expect(readStateFile(f, State)).resolves.toEqual({ token: 't' });
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  it('is nothing when missing or not what it should be', async () => {
    const f = file();
    await expect(readStateFile(f, State)).resolves.toBeUndefined();
    await writeStateFile(f, { other: 1 });
    await expect(readStateFile(f, State)).resolves.toBeUndefined();
  });
});
