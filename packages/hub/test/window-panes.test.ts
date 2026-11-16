import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LogsQuery,
  NetworkControl,
  NetworkDetail,
  NetworkEntry,
  NetworkHandle,
  NetworkSource,
} from '@appdyno/core';
import { DEFAULT_POLICY, ServerContext, type Policy } from '@appdyno/ops';
import { NO_PHONE_LOG, OPEN_AN_APP, windowLogs } from '../src/window-logs.js';
import {
  ANDROID_NEEDS,
  IPHONE_NEEDS,
  NO_PROBE,
  PROBE_WHILE,
  windowNetwork,
} from '../src/window-network.js';
import { NO_REQUEST } from '../src/window-network-tools.js';
import { RULE_MOVED, ruleId } from '../src/window-network-rules.js';
import { windowSends } from '../src/window-sends.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';

let state: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'appdyno-panes-'));
  process.env.APPDYNO_STATE_DIR = state;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(state, { recursive: true, force: true });
});

/** A device with the app of a person's own in front, and what a window was told of it. */
function on(policy: Policy = DEFAULT_POLICY) {
  const device = new FakeDevice();
  device.apps = {
    listApps: () => Promise.resolve([{ id: 'dev.app', name: 'Dev App' }]),
  } as unknown as FakeDevice['apps'];
  const told: Record<string, unknown>[] = [];
  const session = () => ({ tell: (m: Record<string, unknown>) => void told.push(m) });
  const ctx = new ServerContext(policy, []);
  return { device, told, session, ctx, of: (op: string) => told.filter((m) => m.op === op) };
}

describe("a window's Logs pane", () => {
  beforeEach(() => void vi.useFakeTimers());

  /** A log that grows by a line each read, each line a millisecond after the one before, as a device keeps time. */
  const growing = (t: ReturnType<typeof on>) => {
    const asked: LogsQuery[] = [];
    let lines = 0;
    t.device.logs = (q: LogsQuery) => {
      asked.push(q);
      lines++;
      const all = Array.from({ length: lines }, (_, i) => ({ at: 1_000 + i, text: `line ${i}` }));
      const since = q.since;
      const kept = since === undefined ? all : all.filter((l) => l.at >= since);
      return Promise.resolve({
        lines: kept.map((l) => (l.at === 1_000 ? 'token=abc123 first' : l.text)),
        marks: kept.map((l) => ({ at: l.at, ...(l.at === 1_001 && { level: 'error' as const }) })),
        source: 'fake log',
      });
    };
    return asked;
  };

  it('reads the log of the app in front only while it shows, each line once, redacted', async () => {
    const t = on();
    const asked = growing(t);
    const logs = windowLogs(t.ctx, t.device, t.session);
    expect(logs.onWindow({ op: 'paneWatch', pane: 'logs', on: true })).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    const shown = t.of('logs').flatMap((m) => (m.lines as { text: string }[] | undefined) ?? []);
    expect(shown.map((l) => l.text)).toEqual(['token=••• first', 'line 1', 'line 2']);
    expect(t.of('logs')[0]).toMatchObject({ reset: true, app: 'Dev App' });
    expect(t.of('logs').find((m) => JSON.stringify(m).includes('line 1'))).toEqual({
      op: 'logs',
      lines: [{ text: 'line 1', level: 'error' }],
    });
    expect(asked[0]).toMatchObject({ app: 'dev.app', level: 'info', timed: true });
    expect(asked[0]?.since).toBeUndefined();
    expect(asked[1]?.since).toBe(1_000);
    logs.onWindow({ op: 'paneWatch', pane: 'logs', on: false });
    await vi.advanceTimersByTimeAsync(2_500);
    const reads = asked.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(asked.length).toBe(reads);
    // nothing of the device's log is cleared, by any command
    expect(t.device.calls.filter((c) => /clear|logcat/.test(c.name))).toEqual([]);
  });

  it('takes up where a pause stopped, and starts over at another level', async () => {
    const t = on();
    const asked = growing(t);
    const logs = windowLogs(t.ctx, t.device, t.session);
    logs.onWindow({ op: 'paneWatch', pane: 'logs', on: true });
    await vi.advanceTimersByTimeAsync(100);
    logs.onWindow({ op: 'paneWatch', pane: 'logs', on: false });
    await vi.advanceTimersByTimeAsync(3_000);
    logs.onWindow({ op: 'paneWatch', pane: 'logs', on: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(asked.at(-1)?.since).toBe(1_000);
    expect(t.of('logs').filter((m) => m.reset)).toHaveLength(1);
    logs.onWindow({ op: 'paneWatch', pane: 'logs', on: true, level: 'error' });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(t.of('logs').filter((m) => m.reset)).toHaveLength(2);
    expect(asked.at(-1)).toMatchObject({ level: 'error' });
    expect(asked.at(-1)?.since).toBeUndefined();
    logs.end();
  });

  it('says why it reads nothing: no app of a person in front, one the server may not read, a device with no log', async () => {
    const away = on();
    away.device.apps = { listApps: () => Promise.resolve([]) } as unknown as FakeDevice['apps'];
    const one = windowLogs(away.ctx, away.device, away.session);
    one.onWindow({ op: 'paneWatch', pane: 'logs', on: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(away.of('logs')[0]).toMatchObject({ reset: true, note: OPEN_AN_APP });
    expect(away.device.logAsked).toBeUndefined();
    one.end();

    const barred = on({ ...DEFAULT_POLICY, apps: ['dev.other'] });
    const two = windowLogs(barred.ctx, barred.device, barred.session);
    two.onWindow({ op: 'paneWatch', pane: 'logs', on: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(barred.of('logs')[0]).toMatchObject({
      note: 'dev.app is not an allowed app (dev.other)',
    });
    expect(barred.device.logAsked).toBeUndefined();
    two.end();

    const phone = on();
    phone.device.logNote = "devicectl cannot read a running app's log on an iPhone.";
    const three = windowLogs(phone.ctx, phone.device, phone.session);
    three.onWindow({ op: 'paneWatch', pane: 'logs', on: true });
    await vi.advanceTimersByTimeAsync(5_000);
    // what the driver tells an agent, with its commands, is said to a person in a person's words, once
    expect(phone.of('logs').filter((m) => m.note === NO_PHONE_LOG)).toHaveLength(1);
    expect(phone.of('logs').some((m) => m.note === phone.device.logNote)).toBe(false);
    // and with it the pane hides the level, search, Pause, Copy, Clear and the empty log, which no log fills here
    expect(phone.of('logs').find((m) => m.note === NO_PHONE_LOG)).toMatchObject({ none: true });
    expect(barred.of('logs').some((m) => m.none)).toBe(false);
    three.end();
  });

  it('keeps a device that gives no log so as another app comes to the front, where its controls came back for a read', async () => {
    const phone = on();
    phone.device.apps = {
      listApps: () =>
        Promise.resolve([
          { id: 'dev.app', name: 'Dev App' },
          { id: 'dev.other', name: 'Other' },
        ]),
    } as unknown as FakeDevice['apps'];
    let front = 'dev.app';
    phone.device.foreground = () => Promise.resolve(front);
    phone.device.logNote = "devicectl cannot read a running app's log on an iPhone.";
    const logs = windowLogs(phone.ctx, phone.device, phone.session);
    logs.onWindow({ op: 'paneWatch', pane: 'logs', on: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(phone.of('logs').find((m) => m.note === NO_PHONE_LOG)).toMatchObject({ none: true });
    const before = phone.of('logs').length;
    front = 'dev.other';
    await vi.advanceTimersByTimeAsync(12_000);
    const after = phone.of('logs').slice(before);
    // the new app starts the view over, and says nothing that would show what works on a log again
    expect(after.find((m) => m.reset)).toMatchObject({ app: 'Other' });
    expect(after.filter((m) => 'note' in m)).toEqual([]);
    logs.end();
  });

  it("lists the app's crash reports as crashes gives them, with what may hold a secret hidden", async () => {
    const t = on();
    t.device.crashReports = [
      {
        at: '2026-11-09 12:00',
        reason: 'SIGABRT',
        detail: 'password=hunter2 at main',
        file: '/x.ips',
      },
    ];
    const logs = windowLogs(t.ctx, t.device, t.session);
    logs.onWindow({ op: 'paneWatch', pane: 'logs', on: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(t.of('crashes')).toEqual([
      {
        op: 'crashes',
        reports: [
          {
            at: '2026-11-09 12:00',
            reason: 'SIGABRT',
            detail: 'password=••• at main',
            file: '/x.ips',
          },
        ],
      },
    ]);
    logs.end();
  });

  it('leaves what is not its own to the others', () => {
    const t = on();
    const logs = windowLogs(t.ctx, t.device, t.session);
    expect(logs.onWindow({ op: 'paneWatch', pane: 'network', on: true })).toBe(false);
    expect(logs.onWindow({ op: 'perfWatch', on: true })).toBe(false);
  });
});

describe("a window's Network pane", () => {
  /** A probe as a simulator has one: what it saw, with a token in an address. */
  const probe = (): NetworkSource & { started: unknown[] } => {
    const started: unknown[] = [];
    const entries = [
      { method: 'GET', url: 'https://a.test/x?token=abc', status: 200, ms: 85, bytes: 1200 },
    ];
    return {
      started,
      paths: () =>
        Promise.resolve([
          { via: 'probe', sees: 'the requests' },
          { via: 'bytes', refused: 'no count per app' },
        ]),
      start: (via, app) => {
        started.push({ via, app });
        return Promise.resolve<NetworkHandle>({ via });
      },
      read: () => Promise.resolve({ entries }),
      stop: () =>
        Promise.resolve({ entries, note: 'the probe stays in the app until it next starts' }),
    };
  };

  const open = (t: ReturnType<typeof on>, recording = false) => {
    const sends = windowSends(t.ctx, t.device, t.session);
    return windowNetwork(t.device, t.ctx.policy, t.session, sends.call, {
      recording: () => recording,
      measuring: () => false,
    });
  };
  const said = (t: ReturnType<typeof on>) => t.of('network').at(-1);
  const answered = (t: ReturnType<typeof on>) =>
    t
      .of('answer')
      .filter((m) => 'ok' in m)
      .at(-1);

  it('says what a person needs where nothing lists requests, and offers a proxy only where one is set', async () => {
    const android = on();
    Object.assign(android.device, { network: { ...probe(), paths: () => Promise.resolve([]) } });
    const pane = open(android);
    pane.onWindow({ op: 'paneWatch', pane: 'network', on: true });
    await expect
      .poll(() => said(android))
      .toEqual({
        op: 'network',
        capturing: false,
        ways: [],
        needs: ANDROID_NEEDS,
      });
    const iphone = on();
    iphone.device.settings = {
      get: () => Promise.reject(new Error('an iPhone has no proxy switch this tool can reach')),
      set: () => Promise.reject(new Error('no')),
    };
    open(iphone).onWindow({ op: 'paneWatch', pane: 'network', on: true });
    await expect.poll(() => said(iphone)).toMatchObject({ ways: [], needs: IPHONE_NEEDS });
    const proxied = on();
    proxied.device.settings = {
      get: () => Promise.resolve('127.0.0.1:9090'),
      set: () => Promise.reject(new Error('a window sets no proxy')),
    };
    open(proxied).onWindow({ op: 'paneWatch', pane: 'network', on: true });
    await expect
      .poll(() => said(proxied))
      .toEqual({
        op: 'network',
        capturing: false,
        ways: ['proxy'],
        proxy: '127.0.0.1:9090',
      });
  });

  it('captures by the op an agent calls, for the app in front, redacted, and stops what it started as the window closes', async () => {
    const t = on();
    const source = probe();
    Object.assign(t.device, { network: source });
    const pane = open(t);
    pane.onWindow({ op: 'paneWatch', pane: 'network', on: true });
    await expect.poll(() => said(t)).toMatchObject({ capturing: false, ways: ['probe'] });
    pane.onWindow({ op: 'control', name: 'networkStart', via: 'probe' });
    await expect.poll(() => answered(t)).toMatchObject({ ok: true, text: 'Capture started' });
    expect(source.started).toEqual([{ via: 'probe', app: 'dev.app' }]);
    await expect
      .poll(() => said(t))
      .toMatchObject({
        capturing: 'probe',
        entries: [expect.objectContaining({ url: 'https://a.test/x?token=•••', status: 200 })],
      });
    await pane.end();
    pane.onWindow({ op: 'paneWatch', pane: 'network', on: true });
    await expect.poll(() => said(t)).toMatchObject({ capturing: false });
  });

  it('numbers each request by its place since the capture began, which a read past the most it shows keeps', async () => {
    const t = on();
    const many = Array.from({ length: 205 }, (_, i) => ({
      method: 'GET',
      url: `https://a.test/${i}`,
      status: 200,
      ms: 1,
    }));
    Object.assign(t.device, {
      network: { ...probe(), read: () => Promise.resolve({ entries: many }) },
    });
    const pane = open(t);
    pane.onWindow({ op: 'control', name: 'networkStart', via: 'probe' });
    await expect.poll(() => (said(t)?.entries as unknown[] | undefined)?.length).toBe(200);
    const entries = said(t)?.entries as { id: number; url: string }[];
    expect(entries[0]).toMatchObject({ id: 5, url: 'https://a.test/5' });
    expect(entries.at(-1)).toMatchObject({ id: 204, url: 'https://a.test/204' });
    await pane.end();
  });

  it('refuses the probe while a recording runs, as it restarts the app', async () => {
    const t = on();
    const source = probe();
    Object.assign(t.device, { network: source });
    const pane = open(t, true);
    pane.onWindow({ op: 'control', name: 'networkStart', via: 'probe' });
    await expect
      .poll(() => answered(t))
      .toEqual({
        op: 'answer',
        name: 'network',
        ok: false,
        text: PROBE_WHILE,
      });
    expect(source.started).toEqual([]);
  });

  it('keeps bodies, shows one request whole, and sets the rules and the speed by the op an agent calls', async () => {
    const t = on();
    const told: NetworkControl[] = [];
    const starts: unknown[] = [];
    const entries: NetworkEntry[] = [
      { id: 0, method: 'GET', url: 'https://a.test/x', status: 503, ms: 3, how: 'mocked' },
    ];
    const source: NetworkSource = {
      ...probe(),
      start: (via, app, bodies) => {
        starts.push({ via, app, bodies });
        return Promise.resolve<NetworkHandle>({ via });
      },
      read: () => Promise.resolve({ entries }),
      control: (_, c) => void told.push(c),
      detail: () =>
        Promise.resolve({
          requestHeaders: { Authorization: 'Bearer abcdefgh12345678' },
          responseHeaders: {},
          responseBody: '{"error":"down"}',
          responseBodySize: 16,
        }),
    };
    Object.assign(t.device, { network: source });
    const pane = open(t);
    // with no capture a rule would restart the app under a person: it is refused, and says what to do
    pane.onWindow({ op: 'control', name: 'networkRuleSave', rule: 'a.test/x status=503' });
    await expect.poll(() => answered(t)).toMatchObject({ ok: false, text: NO_PROBE });
    pane.onWindow({ op: 'control', name: 'networkStart', via: 'probe', bodies: true });
    await expect.poll(() => said(t)).toMatchObject({ capturing: 'probe', bodies: true, rules: [] });
    expect(starts).toEqual([{ via: 'probe', app: 'dev.app', bodies: true }]);
    // each rule is added by itself, after the rest
    pane.onWindow({ op: 'control', name: 'networkRuleSave', rule: 'a.test/x status=503' });
    await expect.poll(() => said(t)?.rules).toHaveLength(1);
    pane.onWindow({ op: 'control', name: 'networkRuleSave', rule: 'a.test/y fail=offline' });
    await expect.poll(() => answered(t)).toMatchObject({ ok: true, text: 'Rule added' });
    await expect
      .poll(() => said(t))
      .toMatchObject({
        rules: [
          { rule: '"a.test/x" status=503', hits: 0, id: ruleId('a.test/x status=503') },
          { rule: '"a.test/y" fail=offline', hits: 0, id: ruleId('a.test/y fail=offline') },
        ],
        throttle: 'full',
        entries: [expect.objectContaining({ id: 0, how: 'mocked' })],
      });
    // a rule is switched by its name, which is the same on and off
    const second = ruleId('a.test/y fail=offline');
    pane.onWindow({ op: 'control', name: 'networkRuleSwitch', id: second, on: false });
    await expect.poll(() => told.at(-1)?.rules[1]).toMatchObject({ fail: 'offline', off: true });
    expect(said(t)?.rules).toEqual([
      expect.anything(),
      expect.objectContaining({ id: second, off: true }),
    ]);
    pane.onWindow({ op: 'control', name: 'networkRuleSwitch', id: second, on: true });
    await expect.poll(() => told.at(-1)?.rules[1]?.off).toBeUndefined();
    pane.onWindow({ op: 'control', name: 'networkThrottle', value: 'slow' });
    await expect.poll(() => said(t)).toMatchObject({ throttle: 'slow' });
    expect(told.at(-1)?.throttle).toMatchObject({ down: 29_600 });
    // a rule from a window's fields goes in place of the one named, each rule told with its own parts
    pane.onWindow({
      op: 'control',
      name: 'networkRuleSave',
      id: second,
      fields: {
        method: 'POST',
        host: 'a.test',
        path: '/pay',
        status: '402',
        body: '{"paid":false}',
      },
    });
    await expect
      .poll(() => said(t)?.rules)
      .toEqual([
        expect.objectContaining({ fields: { host: 'a.test', path: '/x', status: '503' } }),
        expect.objectContaining({
          rule: '"a.test/pay" method=POST status=402 body="{\\"paid\\":false}"',
          fields: {
            method: 'POST',
            host: 'a.test',
            path: '/pay',
            status: '402',
            body: '{"paid":false}',
          },
        }),
      ]);
    pane.onWindow({ op: 'control', name: 'networkRuleSave', fields: { path: '/none' } });
    await expect
      .poll(() => answered(t))
      .toMatchObject({ ok: false, text: expect.stringMatching(/not a rule/) as unknown });
    // what the capture holds beside its rules, set as the op sets it; and a request still under way with the rest
    entries.push({ id: 1, method: 'GET', url: 'https://a.test/slow', ms: 41_000, inFlight: true });
    pane.onWindow({ op: 'control', name: 'networkKeep', strict: true, unmatched: 'fail' });
    await expect
      .poll(() => said(t))
      .toMatchObject({
        strict: true,
        unmatched: 'fail',
        entries: [
          expect.objectContaining({ id: 0 }),
          expect.objectContaining({ id: 1, inFlight: true, ms: 41_000 }),
        ],
      });
    expect(told.at(-1)?.unmatched).toBe('fail');
    pane.onWindow({ op: 'control', name: 'networkKeep', strict: false, unmatched: 'pass' });
    await expect.poll(() => said(t)).toMatchObject({ strict: false, unmatched: 'pass' });
    pane.onWindow({ op: 'control', name: 'networkDetail', id: 0 });
    await expect
      .poll(() => said(t))
      .toMatchObject({
        detail: {
          id: 0,
          lines: expect.arrayContaining(['  Authorization: •••', '{"error":"down"}']) as unknown,
        },
      });
    // a rule that is none is said as the op says it
    pane.onWindow({ op: 'control', name: 'networkRuleSave', rule: 'a.test/x' });
    await expect
      .poll(() => answered(t))
      .toMatchObject({ ok: false, text: expect.stringMatching(/not a rule/) as unknown });
    await pane.end();
  });

  it("changes one rule by its name in the list as it stands, so an agent's rule is kept, and says what changed elsewhere", async () => {
    const t = on();
    const told: NetworkControl[] = [];
    Object.assign(t.device, {
      network: { ...probe(), control: (_: unknown, c: NetworkControl) => void told.push(c) },
    });
    const pane = open(t);
    const sends = windowSends(t.ctx, t.device, t.session);
    const agent = (args: Record<string, unknown>) =>
      sends.call('capture_network', 'capture_network', { action: 'mock', ...args });
    const lines = () => (said(t)?.rules as { rule: string }[] | undefined)?.map((r) => r.rule);
    pane.onWindow({ op: 'control', name: 'networkStart', via: 'probe' });
    await expect.poll(() => said(t)).toMatchObject({ capturing: 'probe', rules: [] });
    pane.onWindow({ op: 'control', name: 'networkRuleSave', rule: 'a.test/mine status=500' });
    await expect.poll(lines).toEqual(['"a.test/mine" status=500']);
    // what the window changed itself is not said to have changed elsewhere
    expect(t.of('network').some((m) => m.elsewhere)).toBe(false);
    const mineId = ruleId('a.test/mine status=500');
    // an agent adds a rule the window has not read yet: the person's change of their own rule keeps it
    await agent({ rules: ['a.test/agents fail=offline'], add: true });
    pane.onWindow({
      op: 'control',
      name: 'networkRuleSave',
      id: mineId,
      rule: 'a.test/mine status=404',
    });
    await expect.poll(lines).toEqual(['"a.test/mine" status=404', '"a.test/agents" fail=offline']);
    pane.onWindow({
      op: 'control',
      name: 'networkRuleSwitch',
      id: ruleId('a.test/mine status=404'),
      on: false,
    });
    await expect
      .poll(lines)
      .toEqual(['"a.test/mine" status=404 off', '"a.test/agents" fail=offline']);
    // a rule saved over keeps being off
    pane.onWindow({
      op: 'control',
      name: 'networkRuleSave',
      id: ruleId('a.test/mine status=404'),
      rule: 'a.test/mine status=418',
    });
    await expect
      .poll(lines)
      .toEqual(['"a.test/mine" status=418 off', '"a.test/agents" fail=offline']);
    // a rule that is gone is not set again over what an agent left: the window is told, and reads the list anew
    await agent({ rules: ['a.test/other status=200'] });
    pane.onWindow({
      op: 'control',
      name: 'networkRuleSwitch',
      id: ruleId('a.test/mine status=418'),
      on: true,
    });
    await expect.poll(() => answered(t)).toMatchObject({ ok: false, text: RULE_MOVED });
    await expect.poll(lines).toEqual(['"a.test/other" status=200']);
    expect(told.at(-1)?.rules).toHaveLength(1);
    // and that read says the list changed elsewhere, once
    expect(t.of('network').filter((m) => m.elsewhere)).toHaveLength(1);
    pane.onWindow({
      op: 'control',
      name: 'networkRuleRemove',
      id: ruleId('a.test/other status=200'),
    });
    await expect.poll(lines).toEqual([]);
    expect(answered(t)).toMatchObject({ ok: true, text: 'Rule removed' });
    expect(t.of('network').filter((m) => m.elsewhere)).toHaveLength(1);
    await pane.end();
  });

  it('shows and copies real values only in the window that asked, and never in what an agent is answered', async () => {
    const t = on();
    vi.stubEnv('HOME', state);
    const entries = [
      {
        id: 0,
        at: '2026-01-01T00:00:00.000Z',
        method: 'POST',
        url: 'https://a.test/login?token=abc123',
        status: 200,
        ms: 3,
        bytes: 31,
      },
      { id: 1, method: 'GET', url: 'https://a.test/later', status: 200, ms: 1 },
    ];
    const LONG = 'x'.repeat(5_000);
    const source: NetworkSource = {
      ...probe(),
      read: () => Promise.resolve({ entries }),
      control: () => undefined,
      detail: (_, id) =>
        Promise.resolve<NetworkDetail | undefined>(
          id === 0
            ? {
                requestHeaders: { Authorization: 'Bearer abcdefgh12345678', Accept: '*/*' },
                requestBody: '{"password":"hunter2"}',
                responseHeaders: { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=xyz' },
                responseBody: '{"token":"tok-0042","ok":true}',
                responseBodySize: 31,
              }
            : { requestHeaders: {}, responseHeaders: {}, responseBody: LONG },
        ),
    };
    Object.assign(t.device, { network: source });
    const pane = open(t);
    const sends = windowSends(t.ctx, t.device, t.session);
    pane.onWindow({ op: 'control', name: 'networkStart', via: 'probe', bodies: true });
    await expect.poll(() => said(t)).toMatchObject({ capturing: 'probe' });
    const lines = () =>
      (said(t)?.detail as { lines: string[] } | undefined)?.lines.join('\n') ?? '';
    const SECRETS = ['abcdefgh12345678', 'hunter2', 'sid=xyz', 'tok-0042', 'abc123'];
    // as a window shows it with no choice made
    pane.onWindow({ op: 'control', name: 'networkDetail', id: 0 });
    await expect.poll(lines).toContain('  Authorization: •••');
    for (const secret of SECRETS) expect(lines()).not.toContain(secret);
    // the person chose real values: this window gets what was sent
    pane.onWindow({ op: 'control', name: 'networkDetail', id: 0, real: true });
    await expect.poll(lines).toContain('  Authorization: Bearer abcdefgh12345678');
    for (const secret of SECRETS) expect(lines()).toContain(secret);
    // and what an agent is answered is hidden all the same: the op knows of no such choice
    const { answer: answeredAgent, data } = await sends.call('capture_network', 'capture_network', {
      action: 'read',
      id: 0,
    });
    const agent = `${answeredAgent.text}\n${JSON.stringify(data)}`;
    expect(agent).toContain('Authorization: •••');
    for (const secret of SECRETS) expect(agent).not.toContain(secret);
    const listed = await sends.call('capture_network', 'capture_network', { action: 'read' });
    for (const secret of SECRETS) expect(JSON.stringify(listed)).not.toContain(secret);
    // a command that makes the request again, hidden unless asked otherwise
    pane.onWindow({ op: 'control', name: 'networkCurl', id: 0 });
    await expect
      .poll(() => said(t)?.curl)
      .toBe(
        "curl -X POST 'https://a.test/login?token=•••' -H 'Authorization: •••' -H 'Accept: */*' --data-raw '{\"password\":\"•••\"}'",
      );
    pane.onWindow({ op: 'control', name: 'networkCurl', id: 0, real: true });
    await expect
      .poll(() => said(t)?.curl)
      .toBe(
        "curl -X POST 'https://a.test/login?token=abc123' -H 'Authorization: Bearer abcdefgh12345678' -H 'Accept: */*' --data-raw '{\"password\":\"hunter2\"}'",
      );
    // a rule of its answer is one an agent lists: hidden whatever the window shows
    pane.onWindow({ op: 'control', name: 'networkMockFrom', id: 0 });
    await expect
      .poll(() => said(t)?.rule)
      .toBe(
        '"a.test/login" method=POST status=200 type=application/json body="{\\"token\\":\\"•••\\",\\"ok\\":true}"',
      );
    // an answer too long for a line is a file the rule reads, in the folder this window's server runs in
    vi.spyOn(process, 'cwd').mockReturnValue(realpathSync(mkdtempSync(join(state, 'project-'))));
    pane.onWindow({ op: 'control', name: 'networkMockFrom', id: 1 });
    await expect
      .poll(() => said(t)?.rule)
      .toMatch(
        /^"a\.test\/later" status=200 body=@.*\/appdyno-network\/mock-a\.test-later-1\.txt$/,
      );
    pane.onWindow({ op: 'control', name: 'networkCurl', id: 9 });
    await expect.poll(() => answered(t)).toMatchObject({ ok: false, text: NO_REQUEST });
    // the capture as a file on the Desktop, as clean as an agent's
    pane.onWindow({ op: 'control', name: 'networkSave' });
    await expect.poll(() => answered(t)).toMatchObject({ ok: true, text: 'Saved to the Desktop' });
    const har = readFileSync(String(answered(t)?.file), 'utf8');
    expect(String(answered(t)?.file)).toMatch(/\/Desktop\/appdyno network [\d-]+\.har$/);
    expect(har).toContain('"Authorization"');
    for (const secret of SECRETS) expect(har).not.toContain(secret);
    // the list emptied: what the capture holds stays, and the window is given what comes after
    pane.onWindow({ op: 'control', name: 'networkClear' });
    await expect.poll(() => said(t)?.entries).toEqual([]);
    entries.push({ id: 2, method: 'GET', url: 'https://a.test/new', status: 200, ms: 1 });
    pane.onWindow({ op: 'control', name: 'networkRead' });
    await expect
      .poll(() => (said(t)?.entries as { id: number }[] | undefined)?.map((e) => e.id))
      .toEqual([2]);
    await pane.end();
  });
});
