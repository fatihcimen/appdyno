import { reportProgress, type Device, type DeviceProvider } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { busyReasons } from '../src/answers.js';
import { ServerContext } from '../src/context.js';
import { boundLines } from '../src/diagnose.js';
import { DEFAULT_POLICY, redactLog, type Policy } from '../src/policy.js';
import { ActionOut, CrashesOut, LogsOut } from '../src/schemas.js';
import { FakeDevice } from './fake-device.js';
import { linkedClient } from './helpers.js';

type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
};

async function connect(device: Device = new FakeDevice(), policy: Partial<Policy> = {}) {
  const provider: DeviceProvider = {
    list: async () => [{ serial: device.serial, state: 'device' }],
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext({ ...DEFAULT_POLICY, ...policy }, [provider], { app: 'dev.app' });
  const client = await linkedClient(ctx);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as Result;
    return { ...r, text: r.content.map((c) => c.text ?? '').join('\n') };
  };
  return { client, call, ctx };
}

const refOf = (screen: string, label: string) =>
  new RegExp(`(@[a-z0-9-]+) \\w+ "${label}"`).exec(screen)![1]!;

describe('changed', () => {
  it('is true when the screen differs from before the action, on either read', async () => {
    for (const read of ['diff', 'full']) {
      const { call } = await connect();
      const home = await call('screen');
      const r = await call('tap', { ref: refOf(home.text, 'Form'), read });
      expect(r.structuredContent).toMatchObject({ changed: true, settled: true });
      expect(r.text).not.toContain('no change seen');
      ActionOut.parse(r.structuredContent);
    }
  });

  it('is false with its plain sentence when nothing changed', async () => {
    const { call } = await connect();
    await call('screen');
    const r = await call('tap', { x: 5, y: 2390 });
    expect(r.structuredContent).toMatchObject({ changed: false });
    expect(r.text).toMatch(
      /no change seen in \d+ ms; if a slow reaction is expected, use wait_for/,
    );
    expect((r.structuredContent!.warnings as string[]).join()).toContain('no change seen');
  });

  it('is unknown when the action asked for no read', async () => {
    const { call } = await connect();
    await call('screen');
    const r = await call('tap', { x: 5, y: 2390, read: 'none' });
    expect(r.structuredContent).not.toHaveProperty('changed');
  });

  it('holds for an action settled on the host, too', async () => {
    const { call } = await connect();
    await call('screen');
    const r = await call('open_link', { url: 'https://example.test/' });
    expect(r.structuredContent).toMatchObject({ changed: false, settled: true });
    expect(r.text).toContain('no change seen');
    // a launch often finds what the last read showed: it says the screen is unchanged, and no more
    const launch = await call('launch_app');
    expect(launch.structuredContent).toMatchObject({ changed: false, settled: true });
    expect(launch.text).not.toContain('no change seen');
  });

  it('names what kept the screen busy, where known', () => {
    const screen = {
      list: [{ ref: '@a', role: 'progressbar', label: 'Loading', x: 1, y: 1, flags: [] }],
    } as unknown as Parameters<typeof busyReasons>[1];
    const reasons = busyReasons(
      { settle: { settled: false, ms: 3000, reads: 9, quietMs: 800 }, animationWaitMs: 240 },
      screen,
    );
    expect(reasons).toEqual([
      'the device is loaded (quiet window stretched to 800 ms)',
      "the app's animations ran 240 ms",
      'a progress indicator is showing (Loading)',
    ]);
    expect(busyReasons(undefined, { ...screen, list: [] })).toEqual([]);
  });
});

describe('failed answers', () => {
  it('carry code and hint in structured output, through a validating client', async () => {
    const device = new FakeDevice();
    const { call } = await connect(device);
    await call('screen');
    device.fail = new DeviceError('TIMEOUT', 'tree.get did not answer');
    const r = await call('screen');
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toEqual({
      code: 'TIMEOUT',
      hint: 'the device did not answer; read the screen and try again',
    });
  });

  it('name a conflict at open, not "internal error"', async () => {
    const device = new FakeDevice();
    device.openError = new DeviceError(
      'AGENT_CONFLICT',
      'the Android agent could not start: UI automation is taken',
      'uiautomator (pid 7): stop it with `adb -s e shell kill 7`',
    );
    const { call } = await connect(device);
    const r = await call('screen');
    expect(r.isError).toBe(true);
    expect(r.text).toContain('adb -s e shell kill 7');
    expect(r.structuredContent).toMatchObject({ code: 'AGENT_CONFLICT' });
    expect(r.structuredContent!.hint).toContain('uiautomator (pid 7)');
  });

  it('carry a code for refusals of the server itself', async () => {
    const { call } = await connect(new FakeDevice(), { apps: ['dev.only'] });
    const denied = await call('launch_app', { app: 'dev.else' });
    expect(denied.structuredContent).toMatchObject({ code: 'POLICY_DENIED' });
    const words = await call('tap', {});
    expect(words.structuredContent).toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('cancellation and progress', () => {
  it('stops a long call when the client cancels, and the device hears no more of it', async () => {
    const device = new FakeDevice();
    const { client, call } = await connect(device);
    await call('screen');
    const abort = new AbortController();
    const waiting = client.callTool(
      { name: 'wait_for', arguments: { text: 'never', timeoutMs: 15_000 } },
      undefined,
      { signal: abort.signal },
    );
    setTimeout(() => abort.abort(), 50);
    const t = Date.now();
    await expect(waiting).rejects.toThrow();
    expect(Date.now() - t).toBeLessThan(5_000);
    await new Promise((r) => setTimeout(r, 400));
    const reads = device.calls.length;
    await new Promise((r) => setTimeout(r, 700));
    expect(device.calls.length).toBe(reads);
  });

  it('tells a client that asked, and only that one', async () => {
    const device = new FakeDevice();
    const real = device.launch.bind(device);
    device.launch = async (pkg: string) => {
      reportProgress('deep in the driver');
      return real(pkg);
    };
    const { client } = await connect(device);
    const seen: (string | undefined)[] = [];
    await client.callTool({ name: 'launch_app', arguments: {} }, undefined, {
      onprogress: (p) => seen.push(p.message),
    });
    expect(seen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('connecting to'),
        expect.stringContaining('launching dev.app'),
        'deep in the driver',
      ]),
    );
    await expect(client.callTool({ name: 'launch_app', arguments: {} })).resolves.toBeDefined();
  });
});

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
    expect(device.logAsked!.since).toBeGreaterThanOrEqual(before);
    expect(r.text).toContain('I app: started');
    for (const secret of ['abcdef123456', 'hunter2', 'gizli-kod-9911'])
      expect(r.text).not.toContain(secret);
    expect(LogsOut.parse(r.structuredContent)).toMatchObject({ lines: 4, dropped: 0 });
  });

  it('takes a given time, refuses a bad one, and says what the platform cannot', async () => {
    const device = new FakeDevice();
    device.logNote = 'devicectl cannot read this';
    const { call } = await connect(device);
    await call('logs', { since: '2026-11-02T10:00:00Z' });
    expect(device.logAsked!.since).toBe(Date.parse('2026-11-02T10:00:00Z'));
    expect((await call('logs', { since: 'yesterday' })).structuredContent).toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect((await call('logs')).text).toContain('devicectl cannot read this');
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
    device.running = false;
    device.permissionUp = true; // another window in front, the app's process gone
    device.current = ((orig) => () => {
      const t = orig();
      t.windows = t.windows.filter((w) => w.pkg !== 'dev.app');
      return t;
    })(device.current.bind(device));
    device.crashReports = [{ at: 'now', reason: 'APP CRASH(EXCEPTION)', file: '/tmp/report.txt' }];
    const r = await call('tap', { x: 5, y: 2390 });
    expect(r.text).toContain('the app died: APP CRASH(EXCEPTION) (/tmp/report.txt)');
    expect(r.structuredContent).toMatchObject({
      appDied: { reason: 'APP CRASH(EXCEPTION)', file: '/tmp/report.txt' },
    });
    device.crashReports = [];
    const again = await call('tap', { x: 5, y: 2390 });
    expect(again.text).toContain('the app died: its process is gone and no crash report says why');
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
    expect(r.structuredContent).toMatchObject({ appDied: { reason: 'APP CRASH(NATIVE)' } });
    // a launch starts a new process on purpose, and no report means no death
    device.crashReports = [];
    await call('launch_app');
    device.pid = '300';
    expect((await call('tap', { x: 5, y: 2390 })).text).not.toContain('the app died');
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
    device.audit = async () => ({
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
});
