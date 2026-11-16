import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
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
import { callerOf, flowHelpers } from './harness.js';

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

describe('the network probe through its tool', () => {
  let dir: string;
  let device: FakeDevice;
  let probe: FakeProbe;
  const { context, refusal } = flowHelpers(
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
    probe.entries = [POST, { ...POST, how: 'mocked' }];
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
});
