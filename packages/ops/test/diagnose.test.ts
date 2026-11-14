import type { CrashesQuery, Device } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boundLines } from '../src/diagnose.js';
import { DEFAULT_POLICY, redactLog } from '../src/policy.js';
import { CrashesOut, LogsOut } from '../src/schemas.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './truth-client.js';

// a crash report's wait and a deadline are the code's: the clock is faked, and runs on under a call
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('logs', () => {
  it('reads since the last action, at the level asked, bounded and redacted', async () => {
    const device = new FakeDevice();
    device.logLines = [
      'I app: started',
      'I app: Authorization: Bearer abcdef123456',
      'I app: password=hunter2 ok',
      'I app: gizli-kod-9911 typed',
    ];
    const { call } = await connect(device, { secrets: ['gizli-kod-9911'] });
    await call('screen');
    const before = Date.now();
    await call('tap', { x: 5, y: 2390 });
    const r = await call('logs', { level: 'warn' });
    expect(r.isError).toBeUndefined();
    expect(device.logAsked).toMatchObject({ app: 'dev.app', level: 'warn' });
    expect(device.logAsked?.since).toBeGreaterThanOrEqual(before);
    expect(r.text).toContain('I app: started');
    for (const secret of ['abcdef123456', 'hunter2', 'gizli-kod-9911'])
      expect(r.text).not.toContain(secret);
    expect(LogsOut.parse(r.structuredContent)).toMatchObject({ lines: 4, dropped: 0 });
  });

  it('reads from when the last action began: what a push or a tap set off is logged while it runs', async () => {
    const device = new FakeDevice();
    let reached = 0;
    const slowly = async <T>(work: () => Promise<T>) => {
      reached = Date.now();
      await new Promise((r) => setTimeout(r, 40));
      return work();
    };
    const act = device.act.bind(device);
    device.act = (action, opts) => slowly(() => act(action, opts));
    device.events = {
      pushRoutes: () =>
        Promise.resolve([
          { type: 'background', route: 'by hand', fields: ['data'], template: '{}' },
        ]),
      push: () => slowly(() => Promise.resolve('pushed')),
    } as unknown as Device['events'];
    const { call } = await connect(device);
    await call('push', { type: 'background', data: { orderId: '43' }, read: 'none' });
    await call('logs');
    expect(device.logAsked?.since).toBeLessThanOrEqual(reached);
    await call('screen');
    await call('tap', { x: 5, y: 2390 });
    await call('logs');
    expect(device.logAsked?.since).toBeLessThanOrEqual(reached);
  });

  it('takes a given time, refuses a bad one, and says what the platform cannot', async () => {
    const device = new FakeDevice();
    device.logNote = 'devicectl cannot read this';
    const { call } = await connect(device);
    await call('logs', { since: '2026-11-02T10:00:00Z' });
    expect(device.logAsked?.since).toBe(Date.parse('2026-11-02T10:00:00Z'));
    expect((await call('logs', { since: 'yesterday' })).structuredContent).toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect((await call('logs')).text).toContain('devicectl cannot read this');
  });

  it('takes a time as long ago, 30s, 5m or 2h, for logs and crashes alike', async () => {
    const device = new FakeDevice();
    const { call } = await connect(device);
    for (const [since, ago] of [
      ['30s', 30_000],
      ['5m', 300_000],
      ['2h', 7_200_000],
    ] as const) {
      const before = Date.now();
      const r = await call('logs', { since });
      expect(r.isError).toBeUndefined();
      expect(device.logAsked?.since).toBeGreaterThanOrEqual(before - ago);
      expect(device.logAsked?.since).toBeLessThanOrEqual(Date.now() - ago);
    }
    expect((await call('crashes', { since: '5m' })).isError).toBeUndefined();
    expect((await call('logs', { since: '5 minutes' })).structuredContent).toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('keeps the newest lines that fit', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    expect(boundLines(lines, 3).kept).toEqual(['line 47', 'line 48', 'line 49']);
    expect(boundLines(lines, 3).dropped).toBe(47);
    expect(boundLines(['x'.repeat(100), 'y'.repeat(100)], 10, 150).kept).toEqual(['y'.repeat(100)]);
  });

  it('hides credentials a log wrote by itself', () => {
    const clean = (s: string) => redactLog(DEFAULT_POLICY, s);
    expect(clean('token=abc123&x=1')).toBe('token=•••&x=1');
    expect(clean('"api_key": "k-1"')).toBe('"api_key": "•••"');
    expect(clean('eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.abcdEFGH')).toBe('•••');
    expect(clean('cookie: a=b; c=d')).not.toContain('a=b');
    expect(clean('count=3 tokens left')).toBe('count=3 tokens left');
  });

  it('hides a credential whose key ends in a word of one, and a header to its end', () => {
    const clean = (s: string) => redactLog(DEFAULT_POLICY, s);
    const hidden = {
      'GET https://api.example/cb?access_token=ya29.a0AfB_byC1x2&state=ok 200':
        'GET https://api.example/cb?access_token=•••&state=ok 200',
      '{"access_token":"ya29.a0AfB_byC1x2","expires_in":3599}':
        '{"access_token":"•••","expires_in":3599}',
      '{"accessToken":"abcSECRET123"}': '{"accessToken":"•••"}',
      'refresh_token: 1//0gSECRETVALUE': 'refresh_token: •••',
      'client_secret=GOCSPX-SECRET99&grant_type=authorization_code':
        'client_secret=•••&grant_type=authorization_code',
      'X-Api-Key: SECRETVALUE99': 'X-Api-Key: •••',
      'jsessionid=SECRETVALUE99': 'jsessionid=•••',
      'db_pass=hunter2 host=db': 'db_pass=••• host=db',
      'password="hunter2 with space" user=bob': 'password="•••" user=bob',
      '{"Authorization": "Basic dXNlcjpwYXNz", "Accept": "*/*"}':
        '{"Authorization": "•••", "Accept": "*/*"}',
      'Authorization: Token SECRETVALUE99': 'Authorization: •••',
      'Cookie: a=1; sid=SECRETSESSION; csrftoken=SECRETCSRF\nnext line': 'Cookie: •••\nnext line',
      'Set-Cookie: sessionid=SECRETSESSION; Path=/; HttpOnly': 'Set-Cookie: •••',
    };
    for (const [line, shown] of Object.entries(hidden)) expect(clean(line)).toBe(shown);
    const ordinary = [
      'bypass=true compass: 270',
      'Cookie consent shown, 3 cookies kept',
      'authorization failed for user bob',
      'tokenizer ready: 512 tokens',
      'password field focused',
      'GET https://api.example/items?page=2&sort=asc 200 31 ms',
    ];
    for (const line of ordinary) expect(clean(line)).toBe(line);
  });

  it("hides a password's other names, a signature, a code or signature in a link, and a link's password", () => {
    const clean = (s: string) => redactLog(DEFAULT_POLICY, s);
    const hidden = {
      'GET https://app.example/cb?code=4/0AeanS0SECRET&state=ok 200':
        'GET https://app.example/cb?code=•••&state=ok 200',
      'GET https://cdn.example/f.png?Expires=1&sig=SECRETSIG&x=1':
        'GET https://cdn.example/f.png?Expires=1&sig=•••&x=1',
      'signature=SECRETSIG99 ok': 'signature=••• ok',
      'connecting to https://bob:hunter2@db.example/x':
        'connecting to https://bob:•••@db.example/x',
      'pwd=hunter2 next': 'pwd=••• next',
      'passphrase: "correct horse"': 'passphrase: "•••"',
      'credential=SECRETVALUE99&x=1': 'credential=•••&x=1',
      'aws_credentials: SECRETVALUE99': 'aws_credentials: •••',
      'api key: SECRETVALUE99': 'api key: •••',
      '{"token": {"value": "ya29.SECRET", "expiry": 3600}, "ok": true}':
        '{"token": •••, "ok": true}',
      'secret_key_base: 9f8e7d6c5b4a32109f8e7d6c5b4a3210': 'secret_key_base: •••',
      'SECRET_KEY_BASE=9f8e7d6c5b4a3210 rails': 'SECRET_KEY_BASE=••• rails',
      '{"code": "4/0AeanS0SECRETVALUE99", "state": "ok"}': '{"code": "•••", "state": "ok"}',
      'sig: Zm9vYmFyYmF6cXV4MTIzNDU2 end': 'sig: ••• end',
    };
    for (const [line, shown] of Object.entries(hidden)) expect(clean(line)).toBe(shown);
    const ordinary = [
      '{"statusCode": 200, "errorCode": 5} encode=utf8',
      'GET https://example.com:8080/a@b 200',
      'mailto:bob@example.com from host:8080',
      'GET https://api.example/items?zipcode=12345 200',
      '{"code": 404, "message": "not found"} code: "ERR_CONNECTION_REFUSED" exit code 1',
      'error_code: E1234567890123456789 secretary: Jane, 3 tokens: {"used": 2}',
      'code: com.example.app2.Main sig: v2',
    ];
    for (const line of ordinary) expect(clean(line)).toBe(line);
  });

  it("hides a one-time code, a PIN, a private key, a JWT and a Google key, and shows an error's name and what is none", () => {
    const clean = (s: string) => redactLog(DEFAULT_POLICY, s);
    const hidden = {
      'otp=123456 sent': 'otp=••• sent',
      'pin: 4821': 'pin: •••',
      '{"private_key": "-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBg", "id": 1}':
        '{"private_key": "•••", "id": 1}',
      '{"pin": 4821}': '{"pin": •••}',
      'jwt: abc': 'jwt: •••',
      'maps key=AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q ok': 'maps key=••• ok',
    };
    for (const [line, shown] of Object.entries(hidden)) expect(clean(line)).toBe(shown);
    const ordinary = [
      'pwd: /Users/me/project PWD=/home/u',
      'pass: 3 of 4, spin: 2',
      'fetch credentials: include, secret: false, apiKey: null, sessionId=12',
      '{"secret": false, "apiKey": null}',
      'code=ERR_NETWORK_CHANGED_1234567',
      '{"code": "ERR_HTTP2_PROTOCOL_ERROR"}',
    ];
    for (const line of ordinary) expect(clean(line)).toBe(line);
  });
});

describe('crashes', () => {
  it('gives a bounded summary and the file', async () => {
    const device = new FakeDevice();
    device.crashReports = [
      {
        at: '2026-11-02 23:59:33',
        reason: 'APP CRASH(EXCEPTION)',
        detail: `java.lang.Boom\n${'at x\n'.repeat(1_000)}`,
        file: '/tmp/report.txt',
      },
    ];
    const { call } = await connect(device);
    const r = await call('crashes');
    expect(r.text).toContain('APP CRASH(EXCEPTION)');
    expect(r.text).toContain('file: /tmp/report.txt');
    expect(r.text.length).toBeLessThan(1_600);
    expect(CrashesOut.parse(r.structuredContent).reports).toHaveLength(1);
  });

  it('says so when an action killed the app, with the reason', async () => {
    const device = new FakeDevice();
    const { call } = await connect(device);
    await call('screen');
    const read = device.current.bind(device);
    let gone = true;
    device.current = () => {
      const t = read();
      if (gone) t.windows = t.windows.filter((w) => w.pkg !== 'dev.app');
      return t;
    };
    device.running = false;
    device.permissionUp = true; // another window in front, the app's process gone
    device.crashReports = [{ at: 'now', reason: 'APP CRASH(EXCEPTION)', file: '/tmp/report.txt' }];
    const r = await call('tap', { x: 5, y: 2390 });
    expect(r.text).toContain('the app died: APP CRASH(EXCEPTION) (/tmp/report.txt)');
    // refused: the touch went out, and the app it was for is gone
    expect(r).toMatchObject({
      isError: true,
      structuredContent: { code: 'APP_NOT_RUNNING', dispatched: true },
    });
    // it died once: an action after that, with it still gone, says nothing more of it
    device.crashReports = [];
    expect((await call('tap', { x: 5, y: 2390 })).text).not.toContain('the app died');
    // back in front, then gone with no report
    gone = false;
    device.running = true;
    device.permissionUp = false;
    await call('screen');
    gone = true;
    device.running = false;
    device.permissionUp = true;
    const again = await call('tap', { x: 5, y: 2390 });
    expect(again.text).toContain(
      'the app died: its process is gone, and no crash report says why yet',
    );
    // a report may come later, and crashes reads it then
    expect(again.text).toContain(
      'crashes says why it died once the system has written its report, which can take a minute',
    );
  });

  it("says the app died where the device's own read after the touch failed as it died", async () => {
    const device = new FakeDevice();
    const { call } = await connect(device);
    await call('screen');
    const act = device.act.bind(device);
    device.act = async (...a: Parameters<FakeDevice['act']>) => {
      await act(...a);
      device.running = false;
      // a simulator writes its report some seconds after the end: none at the first look
      let looked = 0;
      device.crashes = (q) =>
        Promise.resolve({
          reports: (looked++ < 1
            ? []
            : [{ at: 'now', reason: 'EXC_BREAKPOINT SIGTRAP', file: '/tmp/Shop.ips' }]
          ).slice(0, q.limit),
          source: 'fake reports',
        });
      // the runner's read of an app that ended under it
      throw new DeviceError(
        'APP_NOT_RUNNING',
        'the screen could not be read: Lost connection to the application',
      );
    };
    device.logLines = ['Shop: Fatal error: Index out of range'];
    const r = await call('tap', { x: 5, y: 2390 });
    expect(r.text).toContain(
      'the app died: EXC_BREAKPOINT SIGTRAP (/tmp/Shop.ips)\nits last log lines:\nShop: Fatal error: Index out of range',
    );
    expect(r).toMatchObject({ isError: true, structuredContent: { code: 'APP_NOT_RUNNING' } });
  });

  it('says no app died of one a link opened another app over, where it never ran', async () => {
    const device = new FakeDevice();
    device.running = false;
    device.current = ((orig) => () => {
      const t = orig();
      t.windows = t.windows.filter((w) => w.pkg !== 'dev.app');
      return t;
    })(device.current.bind(device));
    device.permissionUp = true; // another app in front, and the selected one never started
    const { call } = await connect(device);
    const r = await call('open_link', { url: 'https://example.com' });
    expect(r.text).not.toContain('the app died');
    expect(r.isError).toBeFalsy();
    // a launch of it that leaves it gone, with no report, is a death at its start
    const launched = await call('launch_app');
    expect(launched.text).toContain(
      'the app died: its process is gone, and no crash report says why yet',
    );
  });

  /** The system's launch came back, and the app ended before it was in front: the home screen stays. */
  const diesAsItStarts = (device: FakeDevice, died: () => void = () => undefined) => {
    const launch = device.launch.bind(device);
    device.launch = async (pkg) => {
      await launch(pkg);
      device.permissionUp = true;
      device.running = false;
      device.current = ((orig) => () => {
        const t = orig();
        t.windows = t.windows.filter((w) => w.pkg !== 'dev.app');
        return t;
      })(device.current.bind(device));
      died();
      // the launch waits for the app to come in front, which it never does
      await new Promise((r) => setTimeout(r, 15_000));
    };
  };

  it('says an app that died as it started died, with read none and with another app selected', async () => {
    const device = new FakeDevice();
    const { call } = await connect(device);
    await call('screen');
    // its report is written at once
    diesAsItStarts(device, () => (reported = Date.now()));
    let reported = Infinity;
    device.crashes = (q) =>
      Promise.resolve({
        reports:
          (q.since ?? 0) <= reported
            ? [{ at: 'now', reason: 'EXC_CRASH SIGABRT', file: '/tmp/Shop.ips' }]
            : [],
        source: 'fake reports',
      });
    // the line that says why, whole: its reason came cut at 200 characters
    const why =
      "2026-11-14 09:23:31.337 Df Wikipedia[21835:1ea4688] (CoreFoundation) *** Terminating app due to uncaught exception 'NSInvalidArgumentException', reason: '*** -[NSURL initFileURLWithPath:isDirectory:]: nil string parameter'";
    device.logLines = [why];
    const r = await call('launch_app', { read: 'none' });
    expect(r).toMatchObject({ isError: true, structuredContent: { code: 'APP_NOT_RUNNING' } });
    expect(r.text).toContain(
      `the app died: EXC_CRASH SIGABRT (/tmp/Shop.ips)\nits last log lines:\n${why}\n`,
    );
    // the app launched is the one looked at, not the one selected
    await call('use_device', { device: device.serial, app: 'dev.other' });
    expect((await call('launch_app', { app: 'dev.app' })).text).toContain(
      'the app died: EXC_CRASH',
    );
  });

  it("asks for the app's own report, and says none will come where the system keeps no more", async () => {
    const device = new FakeDevice();
    const { call } = await connect(device);
    await call('screen');
    diesAsItStarts(device);
    const unkept =
      'this Mac holds 25 crash reports of Shop, and macOS saves none past 25: a crash now leaves no report. Move Shop-*.ips out of ~/Library/Logs/DiagnosticReports, and the next one is kept';
    const asked: CrashesQuery[] = [];
    device.crashes = (q) => {
      asked.push(q);
      return Promise.resolve({ reports: [], source: 'fake reports', note: unkept, unkept });
    };
    const r = await call('launch_app', { read: 'none' });
    expect(r).toMatchObject({ isError: true, structuredContent: { code: 'APP_NOT_RUNNING' } });
    expect(r.text).toContain(
      `the app died: its process is gone, and no crash report says why: ${unkept}`,
    );
    // none is waited for, nor promised
    expect(r.text).not.toContain('can take a minute');
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((q) => q.own)).toBe(true);
  });

  it('says so when the system restarted the app at once, only with a report to go by', async () => {
    const device = new FakeDevice();
    device.pid = '100';
    device.appPid = device.fakePid;
    const { call } = await connect(device);
    await call('screen');
    expect((await call('tap', { x: 5, y: 2390 })).text).not.toContain('the app died');
    device.pid = '200';
    device.crashReports = [{ at: 'now', reason: 'APP CRASH(NATIVE)' }];
    const r = await call('tap', { x: 5, y: 2390 });
    expect(r).toMatchObject({
      isError: true,
      structuredContent: { code: 'APP_NOT_RUNNING', dispatched: true },
    });
    // a launch starts a new process on purpose, and no report means no death
    device.crashReports = [];
    await call('launch_app');
    device.pid = '300';
    expect((await call('tap', { x: 5, y: 2390 })).text).not.toContain('the app died');
  });

  it('tells a crash the first action after a launch that read nothing set off, where a read of the process beside it saw the restart', async () => {
    const device = new FakeDevice();
    device.pid = '100';
    // as adb's: the read of the process answers once the tap it ran beside has crashed the app and the system restarted it
    device.appPid = () => new Promise((r) => setTimeout(() => r(device.pid), 50));
    const act = device.act.bind(device);
    device.act = (a, o) => {
      device.pid = '200';
      return act(a, o);
    };
    device.crashReports = [{ at: 'now', reason: 'APP CRASH(EXCEPTION)' }];
    const { call } = await connect(device);
    await call('launch_app', { read: 'none' });
    const r = await call('tap', { x: 5, y: 2390 });
    expect(r).toMatchObject({
      isError: true,
      structuredContent: { code: 'APP_NOT_RUNNING', dispatched: true },
    });
  });

  it("takes the app's process after an action from the action's own answer, and asks for it only where an agent has none", async () => {
    const device = new FakeDevice();
    device.pid = '100';
    let asked = 0;
    device.appPid = () => {
      asked++;
      return Promise.resolve(device.pid);
    };
    // as the agent's: the process of the app named, once the action is over
    const act = device.act.bind(device);
    const naming: typeof act = async (a, o) => ({
      ...(await act(a, o)),
      ...(o?.pidOf && { pid: Number(device.pid ?? 0) }),
    });
    device.act = naming;
    const { call } = await connect(device);
    await call('screen');
    // the first action asks once, before it, as nothing knew the process then
    await call('tap', { x: 5, y: 2390 });
    expect(asked).toBe(1);
    await call('tap', { x: 5, y: 2390 });
    expect(asked).toBe(1);
    // the system restarted it at once: the answer names another process, and the report says why
    device.pid = '200';
    device.crashReports = [{ at: 'now', reason: 'APP CRASH(NATIVE)' }];
    const died = await call('tap', { x: 5, y: 2390 });
    expect(died).toMatchObject({
      isError: true,
      structuredContent: { code: 'APP_NOT_RUNNING', dispatched: true },
    });
    expect(asked).toBe(1);
    device.crashReports = [];
    // a batch's steps that read nothing take it from their answers too
    const tap = { action: 'tap', x: 5, y: 2390 };
    device.calls = [];
    expect((await call('steps', { steps: [tap, tap, tap] })).isError).toBeFalsy();
    const named = device.calls
      .filter((c) => c.name === 'act')
      .map((c) => (c.args[1] as { pidOf?: string }).pidOf);
    expect(named).toEqual(['dev.app', 'dev.app', 'dev.app']);
    expect(asked).toBe(1);
    // an older agent, which names none: asked after the action, as before
    device.act = act;
    await call('tap', { x: 5, y: 2390 });
    expect(asked).toBe(2);
  });

  it('says so when the app has no process left after an action, though its screen is still the one in front', async () => {
    const device = new FakeDevice();
    device.pid = '100';
    device.appPid = device.fakePid;
    const { call } = await connect(device);
    await call('screen');
    // the tap crashes it: the system's "keeps stopping" stands over the app's last screen, its process gone
    const act = device.act.bind(device);
    device.act = (a, o) => {
      device.pid = undefined;
      return act(a, o);
    };
    device.crashReports = [{ at: 'now', reason: 'APP CRASH(EXCEPTION)' }];
    const r = await call('tap', { x: 5, y: 2390 });
    expect(r).toMatchObject({
      isError: true,
      structuredContent: { code: 'APP_NOT_RUNNING', dispatched: true },
    });
  });

  it('says nothing of the sort when the app only went to the background', async () => {
    const device = new FakeDevice();
    const { call } = await connect(device);
    await call('screen');
    device.permissionUp = true;
    const r = await call('tap', { x: 5, y: 2390 });
    expect(r.text).not.toContain('the app died');
  });
});

describe('audit', () => {
  it('gives the issues in words and in structure', async () => {
    const device = new FakeDevice();
    device.audit = () =>
      Promise.resolve({
        engine: 'rules',
        truncated: false,
        elapsedMs: 3,
        issues: [
          {
            type: 'contrast',
            rule: 'android.textContrast',
            message: 'ratio 2.1',
            b: [0, 0, 100, 40],
            element: { c: 'android.widget.TextView', t: 'Low' },
          },
        ],
      });
    const { call } = await connect(device);
    const r = await call('audit');
    expect(r.text).toContain('1 accessibility issue');
    expect(r.text).toContain('android.textContrast: ratio 2.1 "Low" at 50,20');
    expect(r.structuredContent).toMatchObject({ engine: 'rules', truncated: false });
  });

  it('names a kind once where its rule says no more than it', async () => {
    const device = new FakeDevice();
    device.audit = () =>
      Promise.resolve({
        engine: 'platform',
        truncated: false,
        elapsedMs: 3,
        issues: [
          {
            type: 'textClipped',
            rule: 'XCUIAccessibilityAuditType.textClipped',
            message: 'Text clipped',
            b: [340, 290, 372, 310],
            element: { c: 'StaticText', t: '418' },
          },
        ],
      });
    const { call } = await connect(device);
    const r = await call('audit');
    expect(r.text).toContain('\ntextClipped: Text clipped "418" at 356,300');
    // the structure keeps the rule
    expect(r.structuredContent).toMatchObject({
      issues: [{ rule: 'XCUIAccessibilityAuditType.textClipped' }],
    });
  });
});
