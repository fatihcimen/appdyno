import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AppManager } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './shared.js';

describe('app management', () => {
  const manager = (over: Partial<AppManager> = {}): AppManager & { log: unknown[][] } => {
    const log: unknown[][] = [];
    const rec =
      (name: string) =>
      (...a: unknown[]) => {
        log.push([name, ...a]);
        return Promise.resolve();
      };
    return {
      log,
      install: (path: string) => {
        log.push(['install', path]);
        return Promise.resolve([]);
      },
      uninstall: rec('uninstall'),
      clearData: rec('clear'),
      downloadData: rec('download'),
      replaceData: rec('replace'),
      buildAndInstall: (...a: unknown[]) => {
        log.push(['build', ...a]);
        return Promise.resolve('dev.built');
      },
      listApps: () => Promise.resolve([{ id: 'dev.app', name: 'App', version: '1' }]),
      appState: () => Promise.resolve('running'),
      permission: rec('permission'),
      launchWith: rec('launch'),
      ...over,
    } as AppManager & { log: unknown[][] };
  };

  /** A person's yes in advance, by the server's flag: what asks first is `approval.test.ts`'s. */
  const allowed = { policy: { allowDataLoss: 'virtual' as const } };

  it('says whether a restart started the app or restarted a running one, and starts it fresh with its arguments', async () => {
    const apps = manager();
    const d = Object.assign(new FakeDevice(), { apps });
    const { call } = await connect(d);
    expect((await call('launch_app', { restart: true })).text).toMatch(
      /^restarted dev\.app, which was running\n/,
    );
    d.running = false;
    expect((await call('launch_app', { restart: true })).done).toBe('started dev.app');
    await call('launch_app', { args: ['a=1'], env: { B: '2' } });
    expect(apps.log).toEqual([
      ['launch', 'dev.app', {}],
      ['launch', 'dev.app', {}],
      ['launch', 'dev.app', { args: ['a=1'], env: { B: '2' } }],
    ]);
  });

  it('does each action, with the selected app by default', async () => {
    const apps = manager();
    const d = Object.assign(new FakeDevice(), { apps });
    const { call } = await connect(d, allowed);
    expect((await call('app', { action: 'list' })).data.apps?.[0]?.id).toBe('dev.app');
    expect((await call('app', { action: 'state' })).data.state).toBe('foreground');
    expect((await call('app', { action: 'state', app: 'dev.other' })).data.state).toBe('running');
    await call('app', { action: 'install', path: '/tmp/a.apk' });
    await call('app', { action: 'clear' });
    await call('app', { action: 'uninstall', app: 'dev.other' });
    await call('app', { action: 'grant', service: 'camera' });
    await call('app', { action: 'revoke', service: 'camera' });
    expect(apps.log).toEqual([
      ['install', '/tmp/a.apk'],
      ['clear', 'dev.app'],
      ['uninstall', 'dev.other'],
      ['permission', 'dev.app', true, 'camera'],
      ['permission', 'dev.app', false, 'camera'],
    ]);
  });

  it('launches an allowed app by the name app list gives it', async () => {
    const d = Object.assign(new FakeDevice(), { apps: manager() });
    const { call } = await connect(d, { policy: { apps: ['dev.app'] } });
    const r = await call('launch_app', { app: 'app', read: 'none' });
    expect(r.error).toBe(false);
    expect(r.done).toMatch(/dev\.app/);
    expect(d.calls.filter((c) => c.name === 'launch').map((c) => c.args[0])).toEqual(['dev.app']);
  });

  it('keeps what an install answered on the phone in its answer, whatever the read mode', async () => {
    const apps = manager({
      install: () =>
        Promise.resolve(['passed a Play Protect warning for dev.app: "Unsafe app blocked"']),
    });
    const { call } = await connect(Object.assign(new FakeDevice(), { apps }));
    for (const read of ['none', 'diff', 'full', undefined]) {
      const r = await call('app', {
        action: 'install',
        path: '/tmp/a.apk',
        ...(read && { read }),
      });
      expect(r.text).toContain('passed a Play Protect warning for dev.app: "Unsafe app blocked"');
    }
  });

  it('installs under an allowlist only an app on it, by the id the file holds, and names the one refused', async () => {
    /** A device whose file holds `id`: it asks the check before it installs. */
    const holding = (id: string) =>
      manager({
        install: (_path: string, allowed?: (app: string) => void) => {
          allowed?.(id);
          return Promise.resolve([]);
        },
      });
    const policy = { apps: ['dev.app'] };
    const ok = await connect(Object.assign(new FakeDevice(), { apps: holding('dev.app') }), {
      policy,
    });
    expect((await ok.call('app', { action: 'install', path: '/tmp/a.apk' })).done).toBe(
      'installed /tmp/a.apk',
    );
    const other = await connect(Object.assign(new FakeDevice(), { apps: holding('dev.other') }), {
      policy,
    });
    const refused = await other.call('app', { action: 'install', path: '/tmp/b.apk' });
    expect(refused.text).toBe(
      'POLICY_DENIED: dev.other is not an allowed app (dev.app)\nhint: the person who runs this server allows it by --allow-apps, and no call can',
    );
  });

  it('builds, installs and launches what a project makes, and only with no allowlist', async () => {
    const apps = manager();
    const { call } = await connect(Object.assign(new FakeDevice(), { apps }));
    expect((await call('app', { action: 'build_and_run' })).error).toBe(true);
    const built = await call('app', {
      action: 'build_and_run',
      path: '/tmp/My.xcodeproj',
      scheme: 'My',
      configuration: 'Release',
      read: 'none',
    });
    expect(built.text).toContain('built and launched dev.built');
    expect(apps.log[0]).toEqual([
      'build',
      { project: '/tmp/My.xcodeproj', scheme: 'My', configuration: 'Release' },
    ]);
    expect(apps.log[1]?.slice(0, 2)).toEqual(['launch', 'dev.built']);

    const narrow = manager();
    const { call: narrowCall } = await connect(Object.assign(new FakeDevice(), { apps: narrow }), {
      policy: { apps: ['dev.app'] },
    });
    const refused = await narrowCall('app', { action: 'build_and_run', path: '/tmp/a' });
    expect(refused.error).toBe(true);
    expect(narrow.log).toEqual([]);
  });

  it('lists a screen and presses by name, with no runner', async () => {
    const pressed: string[] = [];
    const inspector = {
      elements: () =>
        Promise.resolve([
          { caption: 'Form, Button', identifier: 'open_form' },
          { caption: 'Title' },
        ]),
      press: (name: string) => {
        pressed.push(name);
        return Promise.resolve({ caption: 'Form, Button' });
      },
    };
    const { call } = await connect(Object.assign(new FakeDevice(), { inspector }));
    const list = await call('inspector', { action: 'list' });
    expect(list.text).toBe('Form, Button #open_form\nTitle');
    expect((await call('inspector', { action: 'press' })).error).toBe(true);
    expect(pressed).toEqual([]);
    expect((await call('inspector', { action: 'press', name: 'Form' })).text).toBe(
      'pressed Form, Button',
    );
    expect(pressed).toEqual(['Form']);
    const none = await connect(new FakeDevice());
    expect((await none.call('inspector', { action: 'list' })).error).toBe(true);
  });

  it('copies an app data only with a safe folder', async () => {
    const apps = manager();
    const { call } = await connect(Object.assign(new FakeDevice(), { apps }), allowed);
    const base = mkdtempSync(join(tmpdir(), 'app-data-op-'));
    try {
      const to = join(base, 'new', 'copy');
      const down = { action: 'download_data', app: 'dev.app', path: to };
      expect((await call('app', { action: 'download_data', app: 'dev.app' })).error).toBe(true);
      expect((await call('app', down)).text).toContain(to);
      expect(apps.log).toEqual([['download', 'dev.app', to]]);
      expect(statSync(to).mode & 0o777).toBe(0o700);
      // a copy never lands among what a folder already holds
      writeFileSync(join(to, 'mine.txt'), 'mine');
      const refused = await call('app', down);
      expect(refused.error).toBe(true);
      expect(refused.text).toContain('new or empty');
      expect(apps.log).toHaveLength(1);

      const up = { action: 'replace_data', app: 'dev.app', path: to };
      expect((await call('app', up)).text).toContain(to);
      expect(apps.log.at(-1)).toEqual(['replace', 'dev.app', to]);
      const missing = await call('app', { ...up, path: join(base, 'gone') });
      expect(missing.error).toBe(true);
      expect(apps.log).toHaveLength(2);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('takes no tool argument that could accept a warning', async () => {
    const apps = manager();
    const { call } = await connect(Object.assign(new FakeDevice(), { apps }));
    const r = await call('app', {
      action: 'install',
      path: '/tmp/a.apk',
      accept_install_warnings: true,
    });
    expect(r.error).toBe(true);
    expect(apps.log).toEqual([]);
  });

  it('refuses what the policy forbids and passes on a driver’s reason', async () => {
    const apps = manager({
      // the file holds an app the allowlist does not name
      install: (_path: string, allowed?: (app: string) => void) => {
        allowed?.('dev.other');
        return Promise.resolve([]);
      },
      clearData: () => Promise.reject(new DeviceError('UNSUPPORTED', 'an iPhone cannot')),
    });
    const d = Object.assign(new FakeDevice(), { apps });
    const { call } = await connect(d, { policy: { apps: ['dev.app'], allowDataLoss: 'virtual' } });
    const off = await call('app', { action: 'install', path: '/tmp/a.apk' });
    expect(off.data.code).toBe('POLICY_DENIED');
    expect((await call('app', { action: 'uninstall', app: 'dev.other' })).error).toBe(true);
    const r = await call('app', { action: 'clear' });
    expect(r.data.code).toBe('UNSUPPORTED');
    expect(r.text).toContain('an iPhone cannot');
    const none = await connect(new FakeDevice());
    expect((await none.call('app', { action: 'list' })).data.code).toBe('UNSUPPORTED');
  });
});
