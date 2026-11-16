import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NetworkDetail, NetworkEntry } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { captures } from '../../src/network-capture.js';
import { probeSetup } from './fake-probe.js';
import { callerOf, flowsFor } from './harness.js';

const GET: NetworkEntry = {
  at: '2026-01-01T00:00:01.000Z',
  method: 'GET',
  url: 'https://api.test/v1/items?token=abc123',
  status: 200,
  ms: 40,
  bytes: 31,
};
const BODY = '{"items":[1],"api_key":"key-0042"}';
const ANSWER: NetworkDetail = {
  requestHeaders: {},
  responseHeaders: { 'content-type': 'application/json; charset=utf-8' },
  responseBody: BODY,
  responseBodySize: BODY.length,
};
const entry = (method: string, url: string, status: number, content: object = {}) => ({
  request: { method, url },
  response: { status, content: { mimeType: 'application/json', ...content } },
});

describe('a rule made of an answer', () => {
  const at = probeSetup();
  const { context, refusal, recorded } = at.helpers;
  const har = (entries: unknown[], name = 'checkout.har') => {
    writeFileSync(join(at.dir, name), JSON.stringify({ log: { version: '1.2', entries } }));
    return name;
  };

  it('answers a captured request as it was answered, its body in a file with its credentials hidden', async () => {
    const call = callerOf(context());
    await call('network', { action: 'start', via: 'probe', bodies: true });
    await call('network', { action: 'mock', rules: ['api.test/mine status=500'] });
    at.probe.entries = [GET, { ...GET, status: 0, error: 'offline' }, { ...GET, method: 'POST' }];
    at.probe.details = { 0: ANSWER, 2: { ...ANSWER, responseBodySize: 90_000 } };
    const file = join(at.dir, 'appdyno-network', 'mock-api.test-v1-items-0.json');
    const made = await call('network', { action: 'mock', from: '0' });
    const line = `"api.test/v1/items" status=200 type="application/json; charset=utf-8" body=@${file}`;
    expect(made.data.added).toEqual([line]);
    expect(made.text).toContain('what names a credential in the body is hidden in the file (•••)');
    expect(readFileSync(file, 'utf8')).toBe('{"items":[1],"api_key":"•••"}');
    // added to the rules that were there, and told to the probe with its file
    expect(captures.read(at.device.serial)?.rules).toEqual(['"api.test/mine" status=500', line]);
    expect(at.probe.told?.rules[1]).toMatchObject({ status: 200, bodyFile: file });
    // a file that is there stays unless asked
    expect((await refusal(call('network', { action: 'mock', from: '0' }))).message).toMatch(
      /exists: overwrite true replaces it/,
    );
    await call('network', { action: 'mock', from: '0', overwrite: true });
    expect((await refusal(call('network', { action: 'mock', from: '1' }))).message).toBe(
      'request 1 got no answer to make a rule of',
    );
    const half = await refusal(call('network', { action: 'mock', from: '2' }));
    expect(half.message).toMatch(/answered 90000 B and its first 34 were kept: half an answer/);
    expect((await refusal(call('network', { action: 'mock', from: '9' }))).code).toBe('NOT_FOUND');
    // with no body kept, the rule answers by the status alone, and says so
    at.probe.details = {};
    const bare = await call('network', { action: 'mock', from: '2' });
    expect(bare.data.added).toEqual(['"api.test/v1/items" method=POST status=200']);
    expect(bare.text).toContain('its body was not kept (start with bodies: true)');
    expect((await refusal(call('network', { action: 'read', from: '0' }))).message).toBe(
      'from and unmatched go with mock',
    );
  });

  it('makes a rule of each answer of a HAR, the last of a request asked twice, a query told apart', async () => {
    const call = callerOf(context());
    const name = har([
      entry('GET', 'https://api.test/a', 200, { text: '{"old":1}' }),
      entry('GET', 'https://api.test/a', 200, { text: '{"all":1}' }),
      entry('GET', 'https://api.test/a?page=2&token=abc123', 200, { text: '{"page":2}' }),
      entry('POST', 'https://api.test/b', 201, { text: '{"token":"•••"}' }),
      entry('GET', 'https://cdn.test/logo.png', 200, { text: 'iVBOR', encoding: 'base64' }),
      entry('GET', 'https://api.test/never', 0),
      entry('GET', 'data:text/plain,hey', 200),
    ]);
    const made = await call('network', { action: 'mock', from: name, unmatched: 'fail' });
    const dir = join(at.dir, 'appdyno-network', 'checkout');
    expect(made.data.added).toEqual([
      `"api.test/a" query="page=2" status=200 type=application/json body=@${join(dir, '1-a.json')}`,
      `"api.test/a" status=200 type=application/json body=@${join(dir, '2-a.json')}`,
      `"api.test/b" method=POST status=201 type=application/json body=@${join(dir, '3-b.json')}`,
      '"cdn.test/logo.png" status=200 type=application/json',
    ]);
    expect(readFileSync(join(dir, '2-a.json'), 'utf8')).toBe('{"all":1}');
    expect(made.text).toContain(`4 rules from ${join(at.dir, name)}, their bodies in `);
    expect(made.text).toContain('1 bodies are no text: those rules answer with none');
    expect(made.text).toContain(
      'what was hidden when it was saved (•••) is answered as it is written',
    );
    expect(made.text).toContain('unmatched fail: a request of the app that no rule takes fails');
    expect(made.text).toMatch(/\nunmatched: fail$/);
    expect(at.probe.told?.unmatched).toBe('fail');
    expect(at.probe.told?.rules).toHaveLength(4);
    // again as it is, as a flow that replays it runs more than once; and narrowed
    await call('network', { action: 'mock', rules: [] });
    const some = await call('network', { action: 'mock', from: name, method: 'POST' });
    expect(some.data.added).toHaveLength(1);
    // by a bare name it is found where save writes one
    mkdirSync(join(at.dir, 'appdyno-network'), { recursive: true });
    har([entry('GET', 'https://api.test/kept', 204)], 'appdyno-network/kept.har');
    const kept = await call('network', { action: 'mock', from: 'kept.har' });
    expect(kept.data.added).toEqual(['"api.test/kept" status=204 type=application/json']);
    await call('network', { action: 'mock', unmatched: 'pass' });
    expect(at.probe.told?.unmatched).toBeUndefined();
  });

  it('refuses a file outside the folder, one that is no HAR, one with nothing in it and one with too much', async () => {
    const call = callerOf(context());
    const from = (name: string, more = {}) =>
      refusal(call('network', { action: 'mock', from: name, ...more }));
    expect((await from('/etc/hosts')).code).toBe('POLICY_DENIED');
    expect((await from('none.har')).code).toBe('NOT_FOUND');
    writeFileSync(join(at.dir, 'bad.har'), 'not json');
    expect((await from('bad.har')).message).toMatch(/is no HAR/);
    expect((await from(har([]), { contains: '/x' })).message).toMatch(
      /has no answered request that fits$/,
    );
    const many = Array.from({ length: 51 }, (_, i) => entry('GET', `https://api.test/${i}`, 200));
    expect((await from(har(many, 'many.har'))).message).toMatch(
      /has 51 different requests, and a capture holds 50 rules: contains, method or status narrows them/,
    );
    expect(at.probe.controls).toEqual([]);
    expect(existsSync(join(at.dir, 'appdyno-network'))).toBe(false);
  });

  it('holds in a flow until its file ends, and is recorded as the step that makes it again', async () => {
    const ctx = context();
    const call = callerOf(ctx);
    await call('network', { action: 'mock', rules: ['api.test/mine status=500'] });
    mkdirSync(join(at.dir, 'flows'));
    har([entry('GET', 'https://api.test/a', 200, { text: '{}' })], 'flows/replay.har');
    const during: [number, string | undefined][] = [];
    at.probe.control = (_, c) => {
      at.probe.controls.push(c);
      during.push([c.rules.length, c.unmatched]);
    };
    const file = at.flowFile('mock from=replay.har unmatched=fail\nassert text="Ana sayfa"');
    expect((await flowsFor(ctx).replay(file)).passed).toBe(true);
    // the file's rule with the one that was there, then what no rule takes failing, then as it was
    expect(during).toEqual([
      [2, undefined],
      [2, 'fail'],
      [1, undefined],
    ]);
    expect(captures.read(at.device.serial)?.unmatched).toBeUndefined();
    at.probe.entries = [GET];
    const { text } = await recorded(call, async () => {
      await call('network', { action: 'mock', from: 'flows/replay.har', unmatched: 'fail' });
      await call('network', { action: 'mock', from: '0' });
    });
    expect(text).toContain(`mock from=${join(at.dir, 'flows/replay.har')} unmatched=fail\n`);
    expect(text).toContain('mock "api.test/v1/items" status=200\n');
    for (const [line, why] of [
      ['mock status=200', 'mock needs request'],
      ['mock from=a.har status=200', 'with no request, only from= and unmatched='],
      ['mock unmatched=maybe', 'unmatched is pass or fail: maybe'],
      ['mock a.test from=a.har', 'a rule is a request, host, host/path or \\*, then what it does'],
    ])
      expect((await refusal(flowsFor(ctx).replay(at.flowFile(String(line))))).message).toMatch(
        new RegExp(String(why)),
      );
  });
});
