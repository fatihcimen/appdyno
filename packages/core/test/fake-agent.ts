import { Duplex, PassThrough } from 'node:stream';
import {
  FRAME_JSON,
  FrameDecoder,
  encodeBinary,
  encodeJson,
  rpcCode,
  type ErrorCode,
  type Tree,
  type WireNode,
} from '@appdyno/protocol';
import { RpcClient } from '../src/rpc.js';

/** A connected pair of streams: what one side writes, the other reads. */
export function streamPair(): [Duplex, Duplex] {
  const ab = new PassThrough();
  const ba = new PassThrough();
  return [Duplex.from({ readable: ba, writable: ab }), Duplex.from({ readable: ab, writable: ba })];
}

type FakeReply = { result: unknown; binary?: Buffer } | { error: ErrorCode; message?: string };
export type FakeHandler = (params: Record<string, unknown>) => FakeReply | Promise<FakeReply>;

export const TOKEN = 'a'.repeat(32);

/**
 * An in-process agent speaking the wire protocol, for host tests: `handlers` answer methods (hello is
 * built in); a handler may return a promise to simulate a slow device.
 */
export function fakeAgent(handlers: Record<string, FakeHandler> = {}) {
  const { host, agent, seen } = fakeAgentStream(handlers);
  return { rpc: new RpcClient(host), agent, seen };
}

/** As fakeAgent, with the host's end of the connection yet to be used; `hello` may be answered otherwise. */
export function fakeAgentStream(handlers: Record<string, FakeHandler> = {}) {
  const [host, agent] = streamPair();
  const decoder = new FrameDecoder();
  const seen: { method: string; params: Record<string, unknown> }[] = [];
  agent.on('error', () => undefined);
  const answer = async (b: Buffer) => {
    for (const f of decoder.push(b)) {
      if (f.type !== FRAME_JSON) continue;
      const m = f.message as { id: number; method: string; params: Record<string, unknown> };
      seen.push({ method: m.method, params: m.params });
      if (m.method === 'cancel') continue;
      const hello: FakeHandler = () =>
        m.params.token === TOKEN
          ? { result: HELLO }
          : { error: 'POLICY_DENIED', message: 'bad token' };
      const h = handlers[m.method] ?? (m.method === 'hello' ? hello : undefined);
      const r: FakeReply = h
        ? await h(m.params)
        : { error: 'INVALID_ARGUMENT', message: `no ${m.method}` };
      if (agent.destroyed) return;
      if ('error' in r) {
        agent.write(
          encodeJson({
            jsonrpc: '2.0',
            id: m.id,
            error: {
              code: rpcCode(r.error),
              message: r.message ?? r.error,
              data: { code: r.error },
            },
          }),
        );
      } else {
        if (r.binary) agent.write(encodeBinary(m.id, r.binary));
        agent.write(encodeJson({ jsonrpc: '2.0', id: m.id, result: r.result }));
      }
    }
  };
  // a handler that fails is the test's own mistake: it stays unhandled, which fails the run
  agent.on('data', (b: Buffer) => void answer(b));
  return { host, agent, seen };
}

export const HELLO = {
  agentVersion: '0.1.0',
  protocol: { major: 2 },
  platform: 'android',
  osVersion: '15',
  sdk: 35,
  model: 'Fake',
  screen: { w: 1080, h: 2400, density: 420, rotation: 0 },
};

/** A wire tree: a full-screen root and the given nodes under it. */
export function wireTree(nodes: Partial<WireNode>[], extra: Partial<Tree> = {}): Tree {
  return {
    windows: [
      { type: 1, pkg: 'dev.app', layer: 1, b: [0, 0, 1080, 2400], active: true, focused: true },
    ],
    nodes: [
      { p: -1, w: 0, c: 'android.widget.FrameLayout', b: [0, 0, 1080, 2400], f: 1 | 16 },
      ...nodes.map((n) => ({
        p: 0,
        w: 0,
        c: 'android.widget.TextView',
        b: [0, 0, 100, 50] as [number, number, number, number],
        f: 1 | 16,
        ...n,
      })),
    ],
    truncated: false,
    elapsedMs: 1,
    hash: 'h',
    ...extra,
  };
}
