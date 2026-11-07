import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DATA_LOSS,
  DEFAULT_POLICY,
  ServerContext,
  type DataLoss,
  type Policy,
} from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { linkedClient } from './helpers.js';

const folder = mkdtempSync(join(tmpdir(), 'appdyno-approval-'));

type Kind = { grantResets?: boolean };

/** Each action that loses data, its call, what the driver is asked to do by it, and the device it loses data on. */
const GATED: [DataLoss, string, Record<string, unknown>, string, Kind?][] = [
  ['app uninstall', 'app', { action: 'uninstall' }, 'uninstall'],
  ['app clear', 'app', { action: 'clear' }, 'clear'],
  ['app replace_data', 'app', { action: 'replace_data', path: folder }, 'replace'],
  ['app revoke', 'app', { action: 'revoke', service: 'camera' }, 'revoke'],
  ['app grant', 'app', { action: 'grant', service: 'camera' }, 'grant', { grantResets: true }],
  ['device_setting keychain', 'device_setting', { name: 'keychain', value: 'reset' }, 'keychain'],
];

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-approval-state-')));
});

/** A device whose drivers only write down what they were asked; a client that answers each question as `answer` says. */
async function on(
  o: Kind & { virtual?: boolean; policy?: Partial<Policy>; answer?: ElicitResult['action'] } = {},
) {
  const done: string[] = [];
  const asked: string[] = [];
  const record = (what: string) => async () => void done.push(what);
  const device = Object.assign(new FakeDevice(), {
    virtual: o.virtual ?? true,
    apps: {
      grantResets: o.grantResets,
      uninstall: record('uninstall'),
      clearData: record('clear'),
      replaceData: record('replace'),
      permission: async (_app: string, grant: boolean) =>
        void done.push(grant ? 'grant' : 'revoke'),
    },
    events: { resetKeychain: async () => (done.push('keychain'), 3) },
  });
  const ctx = new ServerContext(
    { ...DEFAULT_POLICY, ...o.policy },
    [
      {
        list: async () => [{ serial: device.serial, state: 'device', ready: true }],
        handles: () => true,
        open: () => device,
      },
    ],
    { app: 'dev.app' },
  );
  const answer = o.answer;
  const client = await linkedClient(ctx, undefined, answer && ((q) => (asked.push(q), answer)));
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text?: string }[];
      structuredContent?: { code?: string; hint?: string };
    };
    return {
      error: r.isError === true,
      text: r.content.map((c) => c.text).join('\n'),
      ...r.structuredContent,
    };
  };
  return { call, done, asked, serial: device.serial };
}

describe('what loses data', () => {
  it('is each action of the table, and each is tested here', () => {
    expect(GATED.map(([action]) => action).sort()).toEqual(Object.keys(DATA_LOSS).sort());
  });

  describe.each(GATED)('%s', (action, tool, args, driver, kind = {}) => {
    it("goes ahead on the person's yes, asked with the device, the app and what is lost", async () => {
      const { call, done, asked, serial } = await on({ ...kind, answer: 'accept' });
      const r = await call(tool, args);
      expect(r.error ? r.text : '').toBe('');
      expect(done).toEqual([driver]);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain(serial);
      expect(asked[0]).toMatch(/\? .* lost\b/);
      if (tool === 'app') expect(asked[0]).toContain('dev.app');
    });

    it('does nothing on a no or a closed prompt, and says the person declined', async () => {
      for (const answer of ['decline', 'cancel'] as const) {
        const { call, done, asked } = await on({ ...kind, answer });
        const r = await call(tool, args);
        expect(r.error).toBe(true);
        expect(r.code).toBe('PERMISSION_REQUIRED');
        expect(r.text).toMatch(
          new RegExp(`^the person declined ${action} on .*: nothing was done$`),
        );
        expect(asked).toHaveLength(1);
        expect(done).toEqual([]);
      }
    });

    it('is refused where the client cannot ask and no flag allows it, saying how a person allows it', async () => {
      for (const o of [{}, { virtual: false, policy: { allowDataLoss: 'virtual' as const } }]) {
        const { call, done } = await on({ ...kind, ...o });
        const r = await call(tool, args);
        expect(r.error).toBe(true);
        expect(r.code).toBe('PERMISSION_REQUIRED');
        expect(r.text).toBe(
          `${action} asks the person first, and this client cannot ask: nothing was done`,
        );
        expect(r.hint).toContain('--allow-data-loss virtual');
        expect(done).toEqual([]);
      }
    });

    it('goes ahead with nothing asked where the flag allows it: virtual on a simulator or emulator, all anywhere', async () => {
      for (const o of [
        { virtual: true, policy: { allowDataLoss: 'virtual' as const } },
        { virtual: false, policy: { allowDataLoss: 'all' as const } },
      ]) {
        const { call, done, asked } = await on({ ...kind, ...o, answer: 'decline' });
        const r = await call(tool, args);
        expect(r.error ? r.text : '').toBe('');
        expect(done).toEqual([driver]);
        expect(asked).toEqual([]);
      }
    });
  });

  it('takes no argument, and no step, for an answer', async () => {
    const { call, done } = await on();
    for (const word of ['yes', 'approved', 'confirm', 'allowDataLoss'])
      expect((await call('app', { action: 'clear', [word]: true })).code).toBe('INVALID_ARGUMENT');
    const r = await call('steps', {
      steps: [{ action: 'device_setting', name: 'keychain', value: 'reset' }],
    });
    expect(r.error).toBe(true);
    expect(r.text).toContain('device_setting keychain asks the person first');
    expect(done).toEqual([]);
  });

  it("asks nothing of a grant that loses nothing, as a simulator's and Android's", async () => {
    const { call, done, asked } = await on({ answer: 'decline' });
    expect((await call('app', { action: 'grant', service: 'camera' })).error).toBe(false);
    expect(done).toEqual(['grant']);
    expect(asked).toEqual([]);
  });
});
