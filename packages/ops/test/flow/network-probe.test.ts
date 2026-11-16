import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  NetworkControl,
  NetworkDetail,
  NetworkEntry,
  NetworkHandle,
  NetworkSource,
} from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { captures } from '../../src/network-capture.js';
import { throttleOf } from '../../src/network-rules.js';
import { callerOf, flowsFor, flowHelpers } from './harness.js';

/** A probe that keeps what it is told and gives what the test put in it. */
class FakeProbe implements NetworkSource {
  entries: NetworkEntry[] = [];
  details: Record<number, NetworkDetail> = {};
  controls: NetworkControl[] = [];
  started: { app: string | undefined; bodies: boolean | undefined }[] = [];
  stopped = 0;
  paths = () => Promise.resolve([{ via: 'probe' as const, sees: 'requests' }]);
  start = (_: string, app: string | undefined, bodies?: boolean): Promise<NetworkHandle> => {
    this.started.push({ app, bodies });
    return Promise.resolve({ via: 'probe', app: app ?? '' });
  };
  read = () => Promise.resolve({ entries: this.entries.map((e, id) => ({ ...e, id })) });
  stop = async () => {
    this.stopped++;
    return { ...(await this.read()), note: 'ended' };
  };
  control = (_: NetworkHandle, control: NetworkControl) => void this.controls.push(control);
  detail = (_: NetworkHandle, id: number) => Promise.resolve(this.details[id]);
  get told() {
    return this.controls.at(-1);
  }
}

const POST: NetworkEntry = {
  at: '2026-01-01T00:00:01.000Z',
  method: 'POST',
  url: 'https://api.test/login?token=abc123',
  status: 200,
  ms: 85,
  bytes: 31,
};
const DETAIL: NetworkDetail = {
  requestHeaders: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer abcdefgh12345678',
    'X-Api-Key': 'key-0042',
    Accept: '*/*',
  },
  requestBody: '{"user":"a","password":"hunter2"}',
  requestBodySize: 33,
  responseHeaders: { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=xyz; Path=/' },
  responseBody: '{"ok":true,"note":"s3cr3t-pass"}',
  responseBodySize: 31,
};

describe('the network probe through its tool and a flow', () => {
  let dir: string;
  let device: FakeDevice;
  let probe: FakeProbe;
  const { context, refusal, recorded } = flowHelpers(
    () => device,
    () => dir,
  );
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'appdyno-probe-')));
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    device = new FakeDevice();
    probe = new FakeProbe();
    Object.assign(device, { network: probe });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('keeps bodies only when asked, and gives one request whole with its credentials hidden', async () => {
    const call = callerOf(context(['s3cr3t-pass']));
    await call('network', { action: 'start', via: 'probe', bodies: true });
    expect(probe.started).toEqual([{ app: 'dev.app', bodies: true }]);
    probe.entries = [POST, { ...POST, method: 'GET', url: 'https://api.test/x', status: 404 }];
    probe.details = { 0: DETAIL };
    const list = await call('network', { action: 'read' });
    expect(list.text).toContain('0 POST https://api.test/login?token=••• 200 85 ms 31 B');
    expect(list.text).toContain('bodies: read with id gives one request whole');
    expect((await call('network', { action: 'read', status: '4xx' })).text).toMatch(/^1 of 1 /);
    expect((await call('network', { action: 'read', method: 'post' })).text).toMatch(/^1 of 1 /);
    const one = await call('network', { action: 'read', id: 0 });
    expect(one.text).toBe(
      [
        '0 POST https://api.test/login?token=••• 200 85 ms 31 B',
        'request headers:',
        '  Content-Type: application/json',
        '  Authorization: •••',
        '  X-Api-Key: •••',
        '  Accept: */*',
        'request body (33 B):',
        '{"user":"a","password":"•••"}',
        'response headers:',
        '  Content-Type: application/json',
        '  Set-Cookie: •••',
        'response body (31 B):',
        '{"ok":true,"note":"•••"}',
      ].join('\n'),
    );
    expect((await call('network', { action: 'read', id: 1 })).text).toContain(
      'its headers and bodies were not kept',
    );
    expect((await refusal(call('network', { action: 'read', id: 7 }))).code).toBe('NOT_FOUND');
  });

  it('writes a HAR that hides what an answer hides, and reads it back', async () => {
    const call = callerOf(context(['s3cr3t-pass']));
    await call('network', { action: 'start', via: 'probe', bodies: true });
    probe.entries = [POST, { ...POST, how: 'mocked', rule: 'abc' }];
    probe.details = { 0: DETAIL };
    const saved = await call('network', { action: 'stop', save: 'out/capture' });
    const file = join(dir, 'out/capture.har');
    expect(saved.text).toContain(`saved 2 requests as HAR 1.2 in ${file}`);
    const text = readFileSync(file, 'utf8');
    for (const hidden of ['abc123', 'abcdefgh12345678', 'key-0042', 'hunter2', 'sid=xyz', 's3cr3t'])
      expect(text).not.toContain(hidden);
    const har = JSON.parse(text) as { log: { version: string; entries: Record<string, never>[] } };
    expect(har.log.version).toBe('1.2');
    expect(har.log.entries[0]).toMatchObject({
      startedDateTime: '2026-01-01T00:00:00.915Z',
      time: 85,
      request: {
        method: 'POST',
        queryString: [{ name: 'token', value: '•••' }],
        postData: { mimeType: 'application/json', text: '{"user":"a","password":"•••"}' },
      },
      response: { status: 200, content: { size: 31, mimeType: 'application/json' } },
    });
    expect(har.log.entries[1]).toMatchObject({ _how: 'mocked' });
    const back = await call('network', { action: 'read', har: file });
    expect(back.text).toMatch(/^2 of 2 from/);
    expect(back.text).toContain('POST https://api.test/login?token=••• 200 85 ms 31 B');
    // outside the folders this server writes to
    await call('network', { action: 'start', via: 'probe' });
    const out = await refusal(call('network', { action: 'read', save: '/tmp/x.har' }));
    expect(out.code).toBe('POLICY_DENIED');
  });

  it('sets, adds to, lists and clears rules, starting a capture where none runs', async () => {
    const call = callerOf(context());
    writeFileSync(join(dir, 'items.json'), '[]');
    const set = await call('network', {
      action: 'mock',
      rules: ['api.test/items* body=@items.json', 'api.test/pay fail=timeout off'],
    });
    expect(set.text).toMatch(/^started a capture by the probe: dev\.app was restarted with it\n/);
    expect(probe.told?.rules).toMatchObject([
      { host: '^api\\.test$', path: '^/items.*$', status: 200, bodyFile: join(dir, 'items.json') },
      { fail: 'timeout', off: true },
    ]);
    const first = probe.told?.rules[0]?.id;
    probe.entries = [{ ...POST, how: 'mocked', rule: String(first) }];
    await call('network', { action: 'mock', rules: ['*.test/new status=204'], add: true });
    expect(probe.started).toHaveLength(1);
    const listed = await call('network', { action: 'mock' });
    expect(listed.text).toBe(
      [
        'rule 1: "api.test/items*" body=@items.json (1 taken)',
        'rule 2 (off): "api.test/pay" fail=timeout off (0 taken)',
        'rule 3: "*.test/new" status=204 (0 taken)',
      ].join('\n'),
    );
    expect((await call('network', { action: 'read' })).text).toMatch(
      /31 B \[mocked\]\nrule 1: .*\nrule 2 .*\nrule 3: /,
    );
    await call('network', { action: 'mock', rules: [] });
    expect(probe.told?.rules).toEqual([]);
    expect((await call('network', { action: 'mock' })).text).toBe('no rule is set');
    // a file outside the server's folder, one that is not there, and what is no rule: nothing is told
    const told = probe.controls.length;
    const rule = (line: string) => refusal(call('network', { action: 'mock', rules: [line] }));
    expect((await rule('a.test body=@/etc/hosts')).code).toBe('POLICY_DENIED');
    expect((await rule('a.test body=@none.json')).code).toBe('NOT_FOUND');
    expect((await rule('a.test')).message).toMatch(/^not a rule: a\.test: say what it does/);
    expect(probe.controls).toHaveLength(told);
  });

  it('slows by a name, a number or its parts, and stop ends it', async () => {
    const call = callerOf(context());
    const slow = await call('network', { action: 'throttle', throttle: 'slow' });
    expect(slow.text).toMatch(/throttle slow: for only the app's URLSession requests/);
    expect(probe.told?.throttle).toEqual({ delayMs: [40, 100], down: 29_600, up: 14_800, loss: 0 });
    await call('network', { action: 'throttle', throttle: 'delayMs=300 down=50000 loss=5' });
    expect(probe.told?.throttle).toEqual({ delayMs: [300, 300], down: 50_000, up: 0, loss: 5 });
    expect((await call('network', { action: 'throttle' })).data.throttle).toBe(
      'delayMs=300 down=50000 loss=5',
    );
    await call('network', { action: 'throttle', throttle: 'full' });
    expect(probe.told?.throttle).toBeUndefined();
    expect(throttleOf('30000')).toEqual({ delayMs: [0, 0], down: 30_000, up: 0, loss: 0 });
    expect(throttleOf('lte')?.down).toBe(21_625_000);
    for (const wrong of ['warp', 'loss=101', 'down=', 'delayMs=-1'])
      expect(() => throttleOf(wrong)).toThrow(/throttle is full, slow, gsm/);
    await call('network', { action: 'stop' });
    expect(probe.stopped).toBe(1);
    expect(captures.read(device.serial)).toBeUndefined();
  });

  it('refuses rules and a throttle on a device with no probe, saying what it has', async () => {
    Object.assign(device, { network: undefined });
    const call = callerOf(context());
    const e = await refusal(call('network', { action: 'throttle', throttle: 'slow' }));
    expect(e.code).toBe('UNSUPPORTED');
    expect(e.hint).toMatch(/an Android device is slowed by device_setting network/);
  });

  const flowFile = (body: string) => {
    mkdirSync(join(dir, 'flows'), { recursive: true });
    const file = join(dir, 'flows', 'a.flow');
    writeFileSync(file, `app dev.app\n${body}\n`);
    return file;
  };

  it('holds a mock step’s rule while its file runs, a file found from the flow’s folder, and takes it out after', async () => {
    const ctx = context();
    const call = callerOf(ctx);
    await call('network', { action: 'mock', rules: ['api.test/mine status=500'] });
    const file = flowFile('mock api.test/items body=@items.json\nmock api.test/pay fail=offline');
    writeFileSync(join(dir, 'flows', 'items.json'), '[]');
    const during: number[] = [];
    probe.control = (_, c) => {
      probe.controls.push(c);
      during.push(c.rules.length);
    };
    expect((await flowsFor(ctx).replay(file)).passed).toBe(true);
    // one more with each step, then back to the one that was there
    expect(during).toEqual([2, 3, 1]);
    expect(probe.controls.at(-2)?.rules[1]?.bodyFile).toBe(join(dir, 'flows', 'items.json'));
    expect(captures.read(device.serial)?.rules).toEqual(['"api.test/mine" status=500']);
  });

  it('takes a mock step’s rule out when the flow fails', async () => {
    const ctx = context();
    const file = flowFile(
      'mock api.test/pay fail=offline\nassert text="never there" timeoutMs=100',
    );
    const r = await flowsFor(ctx).replay(file);
    expect(r.passed).toBe(false);
    expect(probe.told?.rules).toEqual([]);
    expect(captures.read(device.serial)?.rules).toEqual([]);
  });

  it('records each rule set as a mock step, and what has no step as unrecorded', async () => {
    const call = callerOf(context());
    const { text } = await recorded(call, async () => {
      await call('network', { action: 'mock', rules: ['api.test/pay fail=offline'] });
      await call('network', { action: 'mock' });
      await call('network', { action: 'throttle', throttle: 'slow' });
    });
    expect(text).toContain('mock "api.test/pay" fail=offline\n');
    expect(text).toContain('unrecorded "network throttle"');
    expect(text.match(/^mock /gm)).toHaveLength(1);
  });
});
