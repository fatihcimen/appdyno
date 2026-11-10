import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogsQuery, NetworkHandle, NetworkSource } from '@appdyno/core';
import { DEFAULT_POLICY, ServerContext, type Policy } from '@appdyno/ops';
import { NO_PHONE_LOG, OPEN_AN_APP, windowLogs } from '../src/window-logs.js';
import { ANDROID_NEEDS, IPHONE_NEEDS, PROBE_WHILE, windowNetwork } from '../src/window-network.js';
import { windowSends } from '../src/window-sends.js';
import { FakeDevice } from '../../ops/test/fake-device.js';

let state: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'appdyno-panes-'));
  process.env.APPDYNO_STATE_DIR = state;
});
afterEach(() => {
  vi.useRealTimers();
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
    return windowNetwork(t.device, t.session, sends.call, {
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
});
