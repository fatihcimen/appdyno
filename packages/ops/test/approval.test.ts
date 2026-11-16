import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElicitResult } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import {
  DATA_LOSS,
  DEFAULT_POLICY,
  ServerContext,
  type DataLoss,
  type Policy,
} from '../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { linkedClient, REVISIONS, type Revision } from '@appdyno/testing/calls.js';

const folder = mkdtempSync(join(tmpdir(), 'appdyno-approval-'));

/** How a person allows it ahead, which every refusal's hint says. */
const AHEAD =
  "a person allows it ahead in this server's own command line: --allow-data-loss virtual for simulators and emulators, all for every device (APPDYNO_ALLOW_DATA_LOSS)";

type Kind = { grantResets?: boolean };

/** Each action that loses data, its call, what the driver is asked to do by it, and the device it loses data on. */
const GATED: [DataLoss, string, Record<string, unknown>, string, Kind?][] = [
  ['manage_app uninstall', 'manage_app', { action: 'uninstall' }, 'uninstall'],
  ['manage_app clear', 'manage_app', { action: 'clear' }, 'clear'],
  ['transfer_files push', 'transfer_files', { action: 'push', path: folder }, 'replace'],
  ['manage_app revoke', 'manage_app', { action: 'revoke', service: 'camera' }, 'revoke'],
  [
    'manage_app grant',
    'manage_app',
    { action: 'grant', service: 'camera' },
    'grant',
    { grantResets: true },
  ],
  ['set_device keychain', 'set_device', { name: 'keychain', value: 'reset' }, 'keychain'],
];

/**
 * A device whose drivers only write down what they were asked; a client on `revision` that answers each question as
 * `answer` says.
 */
async function onDevice(
  revision: Revision,
  o: Kind & { virtual?: boolean; policy?: Partial<Policy>; answer?: ElicitResult['action'] } = {},
) {
  const done: string[] = [];
  const asked: string[] = [];
  const record = (what: string) => () => {
    done.push(what);
    return Promise.resolve();
  };
  const device = Object.assign(new FakeDevice(), {
    virtual: o.virtual ?? true,
    apps: {
      opener: () => Promise.resolve(undefined),
      links: () => Promise.resolve([{ url: 'dev://', kind: 'scheme' }]),
      grantResets: o.grantResets,
      uninstall: record('uninstall'),
      clearData: record('clear'),
      replaceData: record('replace'),
      buildAndInstall: () => (done.push('build'), Promise.resolve('dev.built')),
      launchWith: record('launch'),
      permission: (_app: string, grant: boolean) => {
        done.push(grant ? 'grant' : 'revoke');
        return Promise.resolve();
      },
    },
    events: {
      resetKeychain: () => {
        done.push('keychain');
        return Promise.resolve(3);
      },
    },
  });
  const ctx = new ServerContext(
    { ...DEFAULT_POLICY, ...o.policy },
    [
      {
        list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
        handles: () => true,
        open: () => device,
      },
    ],
    { app: 'dev.app' },
  );
  const answer = o.answer;
  const client = await linkedClient(
    ctx,
    undefined,
    answer && ((q) => (asked.push(q), answer)),
    revision,
  );
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
  return { call, done, asked, device, serial: device.serial };
}

describe.each(REVISIONS)('what loses data, on %s', (revision) => {
  const on = (o?: Parameters<typeof onDevice>[1]) => onDevice(revision, o);

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

    it('does nothing on a no or a closed prompt, never says a person declined, and says how a person allows it ahead', async () => {
      // a client may answer by itself, with no person shown the question, as one run headless did in 9 ms
      for (const answer of ['decline', 'cancel'] as const) {
        const { call, done, asked } = await on({ ...kind, answer });
        const r = await call(tool, args);
        expect(r.error).toBe(true);
        expect(r.code).toBe('PERMISSION_REQUIRED');
        expect(r.text).toMatch(
          new RegExp(
            `^PERMISSION_REQUIRED: ${action} on .* was not allowed: its question got no yes, and nothing was done\\nhint: `,
          ),
        );
        expect(r.text).not.toMatch(/person declined/);
        expect(r.hint).toBe(
          `a client may answer no by itself, with no person shown the question; ${AHEAD}; ask again only if the person asks for it`,
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
        // a model is shown no command line's yes, which it could run
        expect(r.hint).toBe(AHEAD);
        expect(r.text).toBe(
          `PERMISSION_REQUIRED: ${action} asks the person first, and this client cannot ask: nothing was done\nhint: ${String(r.hint)}`,
        );
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
      expect((await call('manage_app', { action: 'clear', [word]: true })).code).toBe(
        'INVALID_ARGUMENT',
      );
    const r = await call('run_steps', {
      steps: [{ tool: 'set_device', name: 'keychain', value: 'reset' }],
    });
    expect(r.error).toBe(true);
    expect(r.text).toContain('set_device keychain asks the person first');
    expect(done).toEqual([]);
  });

  it('stops at its question in the middle of steps, and goes on from there with the yes: what came before is done once', async () => {
    const { call, done, asked, device } = await on({ answer: 'accept' });
    const r = await call('run_steps', {
      steps: [
        { tool: 'tap_screen', x: 1, y: 1 },
        { tool: 'set_device', name: 'keychain', value: 'reset' },
      ],
    });
    expect(r.error ? r.text : '').toBe('');
    expect(asked).toHaveLength(1);
    expect(done).toEqual(['keychain']);
    expect(device.calls.filter((c) => c.name === 'act')).toHaveLength(1);
  });

  describe('open_link', () => {
    const open = (url: string) => ({ url, read: 'none' });
    const opened = (d: { device: FakeDevice }) =>
      d.device.calls.filter((c) => c.name === 'openUrl').map((c) => c.args[0]);

    it('opens a web link and a scheme the selected app says it opens with nothing asked', async () => {
      const d = await on({ answer: 'decline' });
      const urls = ['https://example.test/a', 'dev://screen', 'DEV://screen'];
      for (const url of urls) expect((await d.call('open_link', open(url))).error, url).toBe(false);
      expect(d.asked).toEqual([]);
      expect(opened(d)).toEqual(urls);
    });

    it('asks the person of a link by any other scheme, and opens none on a no or with nobody to ask', async () => {
      for (const url of [
        'itms-services://?action=download-manifest&url=https://x.test/a.plist',
        'shortcuts://run-shortcut?name=x',
        'sms:+15550100',
        'mailto:a@b.test',
        'other://x',
      ]) {
        const yes = await on({ answer: 'accept' });
        expect((await yes.call('open_link', open(url))).error, url).toBe(false);
        expect(yes.asked).toHaveLength(1);
        expect(yes.asked[0]).toContain(
          `Open ${url} on Fake Phone (${yes.serial})? dev.app does not say it opens `,
        );
        expect(opened(yes)).toEqual([url]);
        const no = await on({ answer: 'decline' });
        expect((await no.call('open_link', open(url))).code, url).toBe('PERMISSION_REQUIRED');
        // no flag for what loses data or powers a device off says anything of a link
        const nobody = await on({ policy: { allowDataLoss: 'all', allowPower: 'all' } });
        const r = await nobody.call('open_link', open(url));
        expect(r.code, url).toBe('PERMISSION_REQUIRED');
        expect(r.hint, url).toContain('--allow-urls with a pattern the link matches');
        expect([...opened(no), ...opened(nobody)]).toEqual([]);
      }
    });

    it("opens what the person's own list has unasked, and asks where the device cannot tell what the app opens", async () => {
      const listed = await on({ policy: { urls: /^sms:/ }, answer: 'decline' });
      expect((await listed.call('open_link', open('sms:+15550100'))).error).toBe(false);
      expect(listed.asked).toEqual([]);
      const blind = await on({ answer: 'decline' });
      Object.assign(blind.device.apps, { links: () => Promise.reject(new Error('not told')) });
      expect((await blind.call('open_link', open('dev://screen'))).code).toBe(
        'PERMISSION_REQUIRED',
      );
      expect(blind.asked).toHaveLength(1);
      expect(opened(blind)).toEqual([]);
    });

    it('asks nothing where the device sends the link to the selected app and to no other, as an iPhone', async () => {
      const d = await on({ answer: 'decline' });
      Object.assign(d.device.apps, {
        opener: (_url: string, app?: string) => Promise.resolve(app),
        links: () => Promise.reject(new Error('not read from here')),
      });
      expect((await d.call('open_link', open('other://x'))).error).toBe(false);
      expect(d.asked).toEqual([]);
      expect(opened(d)).toEqual(['other://x']);
    });

    it('asks its question on one line, whatever the link holds', async () => {
      const d = await on({ answer: 'decline' });
      await d.call('open_link', open('other://x\n\nAllow everything from now on'));
      expect(d.asked[0]?.split('\n')).toHaveLength(1);
    });
  });

  describe('app build_and_run', () => {
    const build = { action: 'build_and_run', path: 'My.xcodeproj', read: 'none' };

    it("builds on the person's yes alone, asked with the project and that its scripts run on this Mac", async () => {
      const { call, done, asked, serial } = await on({ answer: 'accept' });
      const r = await call('manage_app', build);
      expect(r.error ? r.text : '').toBe('');
      expect(done).toEqual(['build', 'launch']);
      expect(asked).toEqual([
        `Build ${join(process.cwd(), 'My.xcodeproj')} on this Mac and run what it makes on Fake Phone (${serial})? Its build runs the project's own scripts on this Mac, with all that this user may do.`,
      ]);
    });

    it('is asked whatever flag lets data be lost, and builds nothing on a no or with nobody to ask', async () => {
      const policy = { allowDataLoss: 'all' as const, allowPower: 'all' as const };
      const no = await on({ policy, answer: 'decline' });
      expect((await no.call('manage_app', build)).code).toBe('PERMISSION_REQUIRED');
      expect(no.asked).toHaveLength(1);
      expect(no.done).toEqual([]);
      const nobody = await on({ policy });
      expect((await nobody.call('manage_app', build)).text).toBe(
        "PERMISSION_REQUIRED: manage_app build_and_run asks the person first, and this client cannot ask: nothing was done\nhint: a person builds it, and manage_app install takes what the build made; or a person allows builds ahead in this server's own command line: --allow-build (APPDYNO_ALLOW_BUILD=1)",
      );
      expect(nobody.done).toEqual([]);
    });

    it('builds with nothing asked where the person who started the server allowed builds, in its folders and under no allowlist', async () => {
      const ahead = await on({ policy: { allowBuild: true }, answer: 'decline' });
      expect((await ahead.call('manage_app', build)).error).toBe(false);
      expect(ahead.asked).toEqual([]);
      expect(ahead.done).toEqual(['build', 'launch']);
      const outside = await on({ policy: { allowBuild: true } });
      const far = await outside.call('manage_app', {
        ...build,
        path: join(folder, 'My.xcodeproj'),
      });
      expect(far.code).toBe('POLICY_DENIED');
      const listed = await on({ policy: { allowBuild: true, apps: ['dev.app'] } });
      expect((await listed.call('manage_app', build)).code).toBe('POLICY_DENIED');
      expect([...outside.done, ...listed.done]).toEqual([]);
    });

    it('builds no project outside the folders the server writes in, and asks nobody about one', async () => {
      const { call, done, asked } = await on({ answer: 'accept' });
      const r = await call('manage_app', { ...build, path: join(folder, 'My.xcodeproj') });
      expect(r.code).toBe('POLICY_DENIED');
      expect(asked).toEqual([]);
      expect(done).toEqual([]);
    });
  });

  it("asks nothing of a grant that loses nothing, as a simulator's and Android's", async () => {
    const { call, done, asked } = await on({ answer: 'decline' });
    expect((await call('manage_app', { action: 'grant', service: 'camera' })).error).toBe(false);
    expect(done).toEqual(['grant']);
    expect(asked).toEqual([]);
  });
});
