import {
  must,
  noteInAnswer,
  reportProgress,
  type Device,
  type DeviceProvider,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { busyReasons } from '../src/answers.js';
import { ServerContext } from '../src/context.js';
import { boundLines } from '../src/diagnose.js';
import { DEFAULT_POLICY, redactLog, type Policy } from '../src/policy.js';
import { ActionOut, CrashesOut, LogsOut } from '../src/schemas.js';
import { defineOp, READ, reply, ToolError } from '../src/tool.js';
import { FakeDevice } from './fake-device.js';
import { callerOf, linkedClient } from './helpers.js';

type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
};

async function connect(device: Device = new FakeDevice(), policy: Partial<Policy> = {}) {
  const provider: DeviceProvider = {
    list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
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
  must(new RegExp(`(@[a-z0-9-]+) \\w+ "${label}"`).exec(screen)?.[1], `the ref of ${label}`);

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

  it('says a device watched for a system alert and none came, where one did', async () => {
    const device = new FakeDevice();
    device.idleMs = 912;
    const { call } = await connect(device);
    await call('screen');
    const r = await call('tap', { x: 5, y: 2390 });
    expect(r.text).toMatch(/no change seen in \d+ ms, and no system alert in 0\.9 s; if a slow/);
  });

  it('is false with its plain sentence when nothing changed', async () => {
    const { call } = await connect();
    await call('screen');
    const r = await call('tap', { x: 5, y: 2390 });
    expect(r.structuredContent).toMatchObject({ changed: false });
    expect(r.text).toMatch(
      /no change seen in \d+ ms; if a slow reaction is expected, use wait_for/,
    );
    expect((r.structuredContent?.warnings as string[]).join()).toContain('no change seen');
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
      text: 'TIMEOUT: tree.get did not answer\nhint: the device did not answer; read the screen and try again',
      code: 'TIMEOUT',
      hint: 'the device did not answer; read the screen and try again',
    });
    expect(r.text).toBe(r.structuredContent?.text);
  });

  it.each(['TIMEOUT', 'DEVICE_GONE', 'AGENT_UNAVAILABLE'] as const)(
    "of %s keep the driver's hint over the general one",
    async (code) => {
      const device = new FakeDevice();
      device.openError = new DeviceError(code, 'xcodebuild ended', 'the last lines of its log');
      const { call } = await connect(device);
      const r = await call('screen');
      expect(r.structuredContent).toEqual({
        text: `${code}: xcodebuild ended\nhint: the last lines of its log`,
        code,
        hint: 'the last lines of its log',
      });
      expect(r.text).toBe(r.structuredContent?.text);
    },
  );

  it('are refusals from anywhere in an op, with nothing written for it there', async () => {
    const op = defineOp({
      name: 'x',
      title: 'x',
      description: 'x',
      input: z.object({}),
      output: z.object({}),
      annotations: READ,
      run: () => Promise.reject(new DeviceError('DEVICE_GONE', 'it left')),
    });
    const e = await op.handler({}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ToolError);
    expect(e).toMatchObject({
      code: 'DEVICE_GONE',
      message: expect.stringContaining('it left') as unknown,
    });
    // what is no device's failure stays what it is: the server logs it as an internal error
    const bug = defineOp({ ...op, run: () => Promise.reject(new TypeError('a bug')) });
    await expect(bug.handler({})).rejects.toBeInstanceOf(TypeError);
  });

  it('an answer says what its call fetched on the way, once', async () => {
    const op = defineOp({
      name: 'x',
      title: 'x',
      description: 'x',
      input: z.object({}),
      output: z.object({}),
      annotations: READ,
      run: () => {
        noteInAnswer('fetched a tool');
        noteInAnswer('fetched a tool');
        return Promise.resolve(reply('measured', {}));
      },
    });
    expect((await op.handler({})).blocks).toEqual([
      { type: 'text', text: 'measured' },
      { type: 'text', text: 'fetched a tool' },
    ]);
    expect(
      (await defineOp({ ...op, run: () => Promise.resolve(reply('a', {})) }).handler({})).blocks,
    ).toHaveLength(1);
  });

  it('what a step fetched on the way is said once, at the end of the answer of the steps', async () => {
    const device = new FakeDevice();
    const { call } = await connect(device);
    const real = device.screenshot.bind(device);
    device.screenshot = () => {
      noteInAnswer('fetched a tool');
      return real();
    };
    const r = await call('steps', {
      steps: [{ action: 'screenshot' }, { action: 'screenshot' }],
    });
    expect(r.isError).toBeUndefined();
    expect(r.text.match(/fetched a tool/g)).toHaveLength(1);
    expect(r.text.endsWith('fetched a tool')).toBe(true);
  });

  it('of the last of several steps still say which step it was and show the screen', async () => {
    const device = new FakeDevice();
    const { call } = await connect(device);
    await call('screen');
    const real = device.act.bind(device);
    let acts = 0;
    device.act = async (action, opts) => {
      if (++acts === 2) throw new DeviceError('TIMEOUT', 'act did not answer');
      return real(action, opts);
    };
    const r = await call('steps', {
      steps: [
        { action: 'tap', x: 5, y: 2390 },
        { action: 'tap', x: 6, y: 2390 },
      ],
    });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(
      /^TIMEOUT: 1\. tapped 5,2390\n2\. tap failed, the rest were not run: act did not answer \(the touch may/,
    );
    expect(r.text).toMatch(/\nhint: the device did not answer; read the screen and try again$/);
    expect(r.text).toContain('Form');
    expect(r.structuredContent).toMatchObject({ code: 'TIMEOUT' });
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
    expect(r.structuredContent?.hint).toContain('uiautomator (pid 7)');
  });

  it('carry a code for refusals of the server itself', async () => {
    const { call } = await connect(new FakeDevice(), { apps: ['dev.only'] });
    const denied = await call('launch_app', { app: 'dev.else' });
    expect(denied.structuredContent).toMatchObject({ code: 'POLICY_DENIED' });
    const words = await call('tap', {});
    expect(words.structuredContent).toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('say a policy as one, and what a device lacks as that, not as a wrong argument', async () => {
    const lacks = (): Promise<never> =>
      Promise.reject(new DeviceError('UNSUPPORTED', 'no such thing here'));
    const device = Object.assign(new FakeDevice(), { logs: lacks, crashes: lacks });
    const { call } = await connect(device, { allowHome: false, secrets: ['s3cr3t'] });
    const code = async (name: string, args: Record<string, unknown> = {}) =>
      (await call(name, args)).structuredContent?.code;
    expect(await code('press_key', { key: 'home' })).toBe('POLICY_DENIED');
    expect(await code('clipboard', { text: 'a s3cr3t b' })).toBe('POLICY_DENIED');
    expect(await code('logs')).toBe('UNSUPPORTED');
    expect(await code('crashes')).toBe('UNSUPPORTED');
    expect(await code('flow', { action: 'stop' })).toBe('NOT_FOUND');
  });
});

describe('an answer', () => {
  it('is known by its op’s name to what calls it', async () => {
    const { ctx } = await connect();
    const call = callerOf(ctx);
    const { data } = await call('find', { text: 'Form' });
    expect(data.matches[0]?.label).toBe('Form');
    // @ts-expect-error: no such key in the schema of find
    expect(data.settled).toBeUndefined();
    // @ts-expect-error: no such op
    await expect(call('nothing')).rejects.toThrow();
  });

  it('that leaves out what its schema asks for does not compile', () => {
    const op = defineOp({
      name: 'x',
      title: 'x',
      description: 'x',
      input: z.object({}),
      output: z.object({ done: z.string() }),
      annotations: READ,
      // @ts-expect-error: `done` is what the schema asks for
      run: () => Promise.resolve(reply('x', { other: 1 })),
    });
    expect(op.name).toBe('x');
  });
});

describe('a launch', () => {
  const launching = (until?: string) => {
    const device = new FakeDevice();
    const launch = vi.fn(() =>
      Promise.resolve({
        value: {
          mode: 'cold' as const,
          samples: [{ totalMs: 6_000 }],
          medianMs: 6_000,
          ...(until && { until }),
        },
        raw: '6000',
        at: '2026-11-03T00:00:00.000Z',
      }),
    );
    Object.defineProperty(device, 'measure', { value: { ...device.measure, launch } });
    return { device, launch };
  };

  it("past the system's limit is excessive, in its text and its data alike", async () => {
    const { call } = await connect(launching().device);
    const r = await call('perf_launch');
    expect(r.text).toContain('this session would count as a slow cold start');
    expect(r.text).toContain("the day's longest cold start 6000 ms, the limit 5000 ms");
    expect(r.structuredContent).toMatchObject({ excessive: true });
  });

  it("counted to a tool's own mark is judged by no such limit, in its text or its data", async () => {
    const { call } = await connect(launching('the first screen is read').device);
    const r = await call('perf_launch');
    expect(r.text).toContain('median: 6000 ms');
    expect(r.text).not.toContain('excessive');
    expect(r.structuredContent).toMatchObject({ excessive: false });
  });

  it('is asked for as many times as it is done', async () => {
    const { device, launch } = launching();
    const { call } = await connect(device);
    await call('perf_launch', { repeats: 10 });
    expect(launch.mock.calls.at(-1)).toMatchObject([expect.any(String), { repeats: 10 }]);
    // Android and a simulator do at most 10, so more is refused rather than quietly not done
    expect((await call('perf_launch', { repeats: 11 })).isError).toBe(true);
    expect(launch).toHaveBeenCalledTimes(1);
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
    await client.callTool(
      { name: 'launch_app', arguments: {} },
      {
        onprogress: (p) => seen.push(p.message),
      },
    );
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
    expect(r.structuredContent).toMatchObject({
      appDied: { reason: 'APP CRASH(EXCEPTION)', file: '/tmp/report.txt' },
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
    expect(again.text).toContain('the app died: its process is gone and no crash report says why');
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
    expect(r.structuredContent).not.toHaveProperty('appDied');
    // a launch of it that leaves it gone, with no report, is a death at its start
    const launched = await call('launch_app');
    expect(launched.text).toContain(
      'the app died: its process is gone and no crash report says why',
    );
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
});
