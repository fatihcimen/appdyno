import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appleProvider, Devicectl } from './workspace.js';
import type { DeviceProvider } from '@appdyno/core';
import {
  DEFAULT_POLICY,
  ServerContext,
  ToolError,
  type Op,
  type OpData,
  type OpName,
} from '@appdyno/ops';
import { checkedOps } from '../packages/ops/test/helpers.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

/** What a client sees: the op's data, or with `error` its refusal's code. */
export type Answer<D = unknown> = { error: boolean; text: string; data: D & { code?: string } };

export type Call = <N extends OpName>(
  name: N,
  args?: Record<string, unknown>,
) => Promise<Answer<OpData<N>>>;

/** Calls an operation as a client sees it: through its input schema, a refusal as an answer. */
export const opCaller =
  (ops: Record<string, Op>): Call =>
  async <N extends OpName>(
    name: N,
    args: Record<string, unknown> = {},
  ): Promise<Answer<OpData<N>>> => {
    const op = ops[name] as Op;
    try {
      const r = await op.handler(op.input.parse(args) as Record<string, unknown>);
      return {
        error: false,
        text: r.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'),
        data: r.data as OpData<N> & { code?: string },
      };
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      return {
        error: true,
        text: e.message,
        data: { code: e.code } as OpData<N> & { code?: string },
      };
    }
  };

/** A person named the device to the suite: what it loses there is the fixture's, asked of nobody. */
export const SUITE_POLICY = { ...DEFAULT_POLICY, allowDataLoss: 'all' } as const;

/** The operations on one device with stores of their own, as a client calls them. */
export function opsOn(provider: DeviceProvider, device: string, app: string) {
  const measurements = mkdtempSync(join(tmpdir(), 'appdyno-measures-'));
  const perf = mkdtempSync(join(tmpdir(), 'appdyno-perf-'));
  const ctx = new ServerContext(SUITE_POLICY, [provider], { device, app, measurements, perf });
  return { ctx, measurements, call: opCaller(checkedOps(ctx)) };
}

/** A fixture signed for the iPhone APPDYNO_IPHONE_UDID names. */
export const IPHONE_FIXTURE = process.env.APPDYNO_IPHONE_FIXTURE_APP;
export const IPHONE = IPHONE_FIXTURE && process.env.APPDYNO_IPHONE_UDID;

/** The fixture CONTRIBUTING's simulator build makes, for a suite to install on its simulator. */
export const SIM_FIXTURE = join(
  import.meta.dirname,
  '../ios/.derived/Build/Products/Debug-iphonesimulator/Fixture.app',
);

/** The operations on that iPhone, with the fixture on it. */
export async function onIphone(app: string, provider: DeviceProvider = appleProvider()) {
  await new Devicectl(IPHONE!).install(IPHONE_FIXTURE!);
  return opsOn(provider, IPHONE!, app);
}

/** Calls a tool over the client `get` gives, which connects after this is made. */
export const toolCaller =
  (get: () => Client) =>
  async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await get().callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text?: string }[];
      structuredContent?: Record<string, unknown>;
    };
    return {
      error: r.isError === true,
      text: r.content.map((c) => c.text ?? '').join('\n'),
      content: r.content,
      data: r.structuredContent ?? {},
    };
  };

/** The ref a screen's text gives the element with this label. */
export const refIn = (text: string, label: string) =>
  new RegExp(`(@[a-z0-9-]+) (?:\\w+ )?"${label}"`).exec(text)?.[1];

/**
 * A push service's credentials made up here, in a state folder of the suite's own, so that this Mac's own is never read:
 * no team or project owns them, and the fixtures print no token, so each push is refused before anything leaves, but one
 * by a token a person typed, which a suite sends to itself.
 */
export function madeUp(service: 'apns' | 'fcm') {
  const state = mkdtempSync(join(tmpdir(), 'appdyno-push-suite-'));
  mkdirSync(join(state, 'push'), { mode: 0o700 });
  const pem = (type: 'ec' | 'rsa') =>
    (type === 'ec'
      ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      : generateKeyPairSync('rsa', { modulusLength: 2048 })
    ).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const made =
    service === 'apns'
      ? { key: pem('ec'), keyId: 'AAAAAAAAAA', teamId: 'BBBBBBBBBB', production: false }
      : {
          projectId: 'made-up-project',
          clientEmail: 'push@made-up-project.iam.gserviceaccount.com',
          keyId: 'k1',
          key: pem('rsa'),
        };
  writeFileSync(join(state, 'push', `${service}.json`), JSON.stringify(made), { mode: 0o600 });
  return { APPDYNO_STATE_DIR: state };
}
