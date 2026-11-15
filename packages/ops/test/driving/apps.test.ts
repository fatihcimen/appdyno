import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AppManager } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { tree } from '@appdyno/testing/fake-screens.js';
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
    // where app's launch went
    expect((await call('app', { action: 'launch' })).text).toMatch(
      /^INVALID_ARGUMENT: action: app has no launch: launch_app starts an app, and with restart: true starts it fresh\n/,
    );
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

  it('answers a restart with the app in front, past the picture the system shows as it starts', async () => {
    class Starting extends FakeDevice {
      /** Until when the home screen app shows its picture of the app starting, longer than a settle's quiet window. */
      starting = 0;
      override current() {
        const t = super.current();
        if (Date.now() > this.starting) return t;
        return {
          ...t,
          hash: `${t.hash}-starting`,
          windows: t.windows.map((w) => ({ ...w, pkg: 'com.apple.springboard' })),
        };
      }
    }
    const d = new Starting();
    d.apps = manager({
      launchWith: () => {
        d.starting = Date.now() + 600;
        return Promise.resolve();
      },
    });
    const { call } = await connect(d);
    const r = await call('launch_app', { restart: true });
    expect(r.text).toMatch(/^restarted dev\.app, which was running\n/);
    expect(r.text).not.toContain('not in the foreground');
    expect(r.data.foreground).toBe('dev.app');
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

  it('names the app it installed, by the id the file holds', async () => {
    const apps = manager({
      install: (_path: string, named?: (app: string) => void) => {
        named?.('dev.app');
        return Promise.resolve([]);
      },
    });
    const { call } = await connect(Object.assign(new FakeDevice(), { apps }));
    const r = await call('app', { action: 'install', path: '/tmp/a.apk' });
    expect([r.done, r.data.app]).toEqual(['installed dev.app from /tmp/a.apk', 'dev.app']);
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
      'installed dev.app from /tmp/a.apk',
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
    // a press by name asks the person, as power-named.test.ts has it: allowed ahead here
    const { call } = await connect(Object.assign(new FakeDevice(), { inspector }), {
      policy: { allowPower: 'all' },
    });
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

  it('refuses a launch with the view probe where the device puts none in, before anything is launched', async () => {
    const apps = manager();
    const d = Object.assign(new FakeDevice(), { apps });
    const { call } = await connect(d);
    expect((await call('launch_app', { probe: true })).text).toBe(
      'UNSUPPORTED: this device puts no view probe in an app\nhint: screen views reads the views where a device gives them without one; screen reads the accessibility tree',
    );
    expect(apps.log).toEqual([]);
    expect(d.calls.filter((c) => c.name === 'launch')).toEqual([]);
  });

  it('launches as asked where the device reads its views without a probe, and says so', async () => {
    const apps = manager();
    const views = () => Promise.resolve({ views: [], truncated: false });
    const d = Object.assign(new FakeDevice(), { apps, views });
    const { call } = await connect(d);
    expect((await call('launch_app', { probe: true, read: 'none' })).done).toBe(
      'brought dev.app to the front, on the screen it was on; this device reads its views without a probe: screen views needs none',
    );
    expect(apps.log).toEqual([]);
    expect(d.calls.filter((c) => c.name === 'launch')).toHaveLength(1);
    expect((await call('launch_app', { probe: true, restart: true, read: 'none' })).done).toBe(
      'restarted dev.app, which was running; this device reads its views without a probe: screen views needs none',
    );
    expect(apps.log).toEqual([['launch', 'dev.app', {}]]);
  });

  it('starts the app afresh with the view probe where the device puts one in', async () => {
    const apps = manager({ viewProbe: true });
    const { call } = await connect(Object.assign(new FakeDevice(), { apps }));
    expect((await call('launch_app', { probe: true, read: 'none' })).done).toBe(
      'restarted dev.app, which was running; with the view probe in it, kept in its launches until the session ends',
    );
    expect(apps.log).toEqual([['launch', 'dev.app', { probe: true }]]);
  });

  it('ends an app in the background where the device can, and says what stops it where it cannot', async () => {
    const { call } = await connect(new FakeDevice());
    expect((await call('terminate_app', { background: true })).text).toBe(
      'UNSUPPORTED: this device cannot end an app in the background as the system does\nhint: terminate_app without background stops it, as a person does',
    );
    const ended: string[] = [];
    const d = Object.assign(new FakeDevice(), {
      endInBackground: (app: string) => {
        ended.push(app);
        return Promise.resolve('its saved state comes back at its next launch');
      },
    });
    const able = await connect(d);
    expect((await able.call('terminate_app', { background: true, app: 'dev.other' })).text).toBe(
      'ended dev.other in the background, as the system does for memory; its saved state comes back at its next launch',
    );
    expect(ended).toEqual(['dev.other']);
    expect(d.calls.filter((c) => c.name === 'terminate')).toEqual([]);
  });
});

describe('a web link the selected app does not open', () => {
  /** As Android, where `-p` holds a link to the app named: the app opens its own scheme, a browser the web. */
  class Held extends FakeDevice {
    sent: [string, string | undefined][] = [];
    override apps = { opener: (_url: string, app?: string) => Promise.resolve(app) } as never;
    override openUrl(url: string, pkg?: string) {
      this.sent.push([url, pkg]);
      if (pkg && !url.startsWith('app:'))
        return Promise.reject(new DeviceError('NOT_FOUND', `${pkg} does not open ${url}`));
      if (!pkg) this.fixture = tree([{ t: 'Example Domain', b: [0, 300, 1080, 400] }], 'browser');
      return Promise.resolve();
    }
  }

  it('opens in whatever does, as a browser, and says the app does not', async () => {
    const d = new Held();
    const { call } = await connect(d);
    const r = await call('open_link', { url: 'https://example.com/' });
    expect(r.done).toBe('opened https://example.com/ in another app: dev.app does not open it');
    expect(r.text).toContain('foreground: browser');
    expect(r.text).not.toContain('WARNING');
    expect(d.sent).toEqual([
      ['https://example.com/', 'dev.app'],
      ['https://example.com/', undefined],
    ]);
  });

  it('stays held to the app for a link of another kind, and under an allowlist', async () => {
    const cases: [string, string[]][] = [
      ['other://x', []],
      ['https://example.com/', ['dev.app']],
    ];
    for (const [url, apps] of cases) {
      const d = new Held();
      const { call } = await connect(d, { policy: { apps } });
      expect((await call('open_link', { url })).text).toBe(
        `NOT_FOUND: dev.app does not open ${url}\nhint: open_link with links: dev.app lists the links it opens`,
      );
      expect(d.sent).toEqual([[url, 'dev.app']]);
    }
  });
});
