import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert } from 'vitest';
import { iphoneProvider, Devicectl } from './workspace.js';
import type { DeviceProvider } from '@appdyno/core';
import { DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { checkedOps, opCaller } from '@appdyno/testing/calls.js';
import type { Client } from '@modelcontextprotocol/client';

export { opCaller, type Answer, type Call } from '@appdyno/testing/calls.js';

/** A person named the device to the suite: what it loses there is the fixture's, asked of nobody. Its files go to temporary folders. */
export const SUITE_POLICY = {
  ...DEFAULT_POLICY,
  allowDataLoss: 'all' as const,
  writeDirs: [tmpdir()],
};

/** The operations on one device with stores of their own, as a client calls them. */
export function opsOn(provider: DeviceProvider, device: string, app: string) {
  const measurements = mkdtempSync(join(tmpdir(), 'appdyno-measures-'));
  const perf = mkdtempSync(join(tmpdir(), 'appdyno-perf-'));
  const ctx = new ServerContext(SUITE_POLICY, [provider], {
    device,
    app,
    storage: { measurements, perf },
  });
  return { ctx, measurements, call: opCaller(checkedOps(ctx)) };
}

/** A fixture signed for the iPhone APPDYNO_IPHONE_UDID names. */
export const IPHONE_FIXTURE = process.env.APPDYNO_IPHONE_FIXTURE_APP ?? '';
export const IPHONE = IPHONE_FIXTURE && (process.env.APPDYNO_IPHONE_UDID ?? '');

/**
 * Why this run has no simulator helpers, where it has none: APPDYNO_SIM_NO_DIRECT says what scripts/sim-smoke.mjs found
 * of its host, and APPDYNO_SIM_DIRECT=off is a reason by itself. A test that proves the helpers' path skips there, as
 * what the runner does in their place proves nothing of them.
 */
export const NO_DIRECT =
  process.env.APPDYNO_SIM_NO_DIRECT ??
  (process.env.APPDYNO_SIM_DIRECT === 'off' ? 'APPDYNO_SIM_DIRECT=off' : '');
// said in the run's output too: a reporter lists no reason for a skip in a file that passed
if (NO_DIRECT) console.log(`what proves the simulator's helpers skips: ${NO_DIRECT}`);

/** The fixture CONTRIBUTING's simulator build makes, for a suite to install on its simulator. */
export const SIM_FIXTURE = join(
  import.meta.dirname,
  '../ios/.derived/Build/Products/Debug-iphonesimulator/Fixture.app',
);

/** The operations on that iPhone, with the fixture on it. */
export async function onIphone(app: string, provider: DeviceProvider = iphoneProvider()) {
  await new Devicectl(IPHONE).install(IPHONE_FIXTURE);
  return opsOn(provider, IPHONE, app);
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

/** The ref of the element with this label, which the screen must show: one it does not fails here, by its label. */
export const shownRef = (text: string, label: string) => {
  const ref = refIn(text, label);
  assert(ref, `no element "${label}" on the screen:\n${text}`);
  return ref;
};

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
