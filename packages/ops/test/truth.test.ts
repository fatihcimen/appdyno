import { must, noteInAnswer, reportProgress } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { busyReasons } from '../src/answers.js';
import { ActionOut } from '../src/schemas.js';
import { defineOp, READ, reply, ToolError } from '../src/tool.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { callerOf } from '@appdyno/testing/calls.js';
import { onFakeTime } from '@appdyno/testing/fake-time.js';
import { connect } from './truth-client.js';

// a settle's wait and a deadline are the code's: the clock is faked, and runs on under a call
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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
      // what was done is the text's first line, and said there only
      ActionOut.omit({ done: true }).parse(r.structuredContent);
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

  it("waits up to 5 s for a link's screen to hold still, as an app it starts goes on drawing, and says so past that", async () => {
    /** A screen that changes every read for `ms` after the link, then holds. */
    const drawing = (ms: number) => {
      const device = new FakeDevice();
      let linkedAt = 0;
      const shown = device.current.bind(device);
      device.openUrl = () => Promise.resolve(void (linkedAt = Date.now()));
      device.current = () => {
        const t = shown();
        const since = Date.now() - linkedAt;
        if (!linkedAt || since > ms) return t;
        t.nodes.push({
          p: 0,
          w: 0,
          c: 'android.widget.TextView',
          t: `${since}`,
          b: [0, 0, 9, 9],
          f: 17,
        });
        return { ...t, hash: `${t.hash}+${since}` };
      };
      return device;
    };
    const late = await (
      await connect(drawing(3_600))
    ).call('open_link', { url: 'https://example.test/' });
    expect(late.structuredContent).toMatchObject({ settled: true });
    expect(late.text).not.toContain('the screen may still be changing');
    const never = await (
      await connect(drawing(60_000))
    ).call('open_link', { url: 'https://example.test/' });
    expect(never.structuredContent).toMatchObject({ settled: false });
  }, 20_000);

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
    const call = callerOf(ctx, onFakeTime);
    const { data } = await call('find', { selector: { text: 'Form' } });
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
      { name: 'wait_for', arguments: { selector: { text: 'never' }, timeoutMs: 15_000 } },
      { signal: abort.signal },
    );
    setTimeout(() => abort.abort(), 50);
    const t = Date.now();
    await expect(onFakeTime(waiting)).rejects.toThrow();
    expect(Date.now() - t).toBeLessThan(5_000);
    await vi.advanceTimersByTimeAsync(400);
    const reads = device.calls.length;
    await vi.advanceTimersByTimeAsync(700);
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
    await onFakeTime(
      client.callTool(
        { name: 'launch_app', arguments: {} },
        {
          onprogress: (p) => seen.push(p.message),
        },
      ),
    );
    expect(seen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('connecting to'),
        expect.stringContaining('launching dev.app'),
        'deep in the driver',
      ]),
    );
    await expect(
      onFakeTime(client.callTool({ name: 'launch_app', arguments: {} })),
    ).resolves.toBeDefined();
  });
});
