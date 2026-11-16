import type { NetworkDetail, NetworkEntry } from '@appdyno/core';
import { bodyHas, bodyMatch, pathKeys } from '@appdyno/flows';
import { describe, expect, it } from 'vitest';
import { probeSetup } from './fake-probe.js';
import { callerOf, flowsFor } from './harness.js';

const PUT: NetworkEntry = {
  at: '2026-01-01T00:00:01.000Z',
  method: 'PUT',
  url: 'https://api.test/v1/profile?token=abc123',
  status: 409,
  ms: 40,
  bytes: 20,
};
const SENT: NetworkDetail = {
  requestHeaders: {},
  responseHeaders: {},
  requestBody: '{"name":"Ada","password":"hunter2","tags":["a",{"k":1}]}',
  responseBody: '{"ok":false,"error":{"code":7}}',
};

describe('what a body is asked for', () => {
  it('reads a path with its value, and any other words as text', () => {
    expect(pathKeys('data.items[0].price')).toEqual(['data', 'items', 0, 'price']);
    expect(pathKeys('[2].id')).toEqual([2, 'id']);
    expect(pathKeys('"name":"Ada"')).toBeUndefined();
    expect(bodyMatch('tags[1].k=1')).toEqual({
      text: 'tags[1].k=1',
      path: ['tags', 1, 'k'],
      equals: '1',
    });
    expect(bodyMatch('"operationName":"Cart"')).toEqual({ text: '"operationName":"Cart"' });
    const body = String(SENT.requestBody);
    for (const yes of ['name=Ada', 'tags[1].k=1', 'tags[0]=a', '"name":"Ada"', 'hunter'])
      expect(bodyHas(body, bodyMatch(yes)), yes).toBe(true);
    for (const no of ['name=Grace', 'tags[2]=a', 'name.first=Ada', 'ada'])
      expect(bodyHas(body, bodyMatch(no)), no).toBe(false);
    expect(bodyHas('{"ok":false,"n":null}', bodyMatch('ok=false'))).toBe(true);
    expect(bodyHas('{"ok":false,"n":null}', bodyMatch('n=null'))).toBe(true);
    // a form has no paths: the same words are looked for as they are written
    expect(bodyHas('name=Grace&city=Van', bodyMatch('name=Grace'))).toBe(true);
    expect(bodyHas('name=Ada&city=Van', bodyMatch('name=Grace'))).toBe(false);
    expect(bodyHas(undefined, bodyMatch('a'))).toBe(false);
  });
});

describe('a check of a request', () => {
  const at = probeSetup();
  const { context, refusal, recorded } = at.helpers;
  const start = async (secrets: string[] = []) => {
    const call = callerOf(context(secrets));
    await call('network', { action: 'start', via: 'probe', bodies: true });
    return call;
  };

  it('finds the request by its address, method, status and what its body holds', async () => {
    const call = await start();
    at.probe.entries = [{ ...PUT, method: 'GET', status: 200 }, PUT];
    at.probe.details = { 1: SENT };
    const found = await call('network', {
      action: 'check',
      contains: '/v1/profile',
      method: 'put',
      status: '4xx',
      has: 'name=Ada',
    });
    expect(found.text).toBe('found: 1 PUT https://api.test/v1/profile?token=••• 409 40 ms 20 B');
    expect(found.data.entries?.[0]?.id).toBe(1);
    // the answer's body by its word, and only what came after the one named
    await call('network', { action: 'check', has: 'response: error.code=7' });
    const late = await refusal(call('network', { action: 'check', after: 1, timeoutMs: 0 }));
    expect(late.message).toBe('no request in 0 ms after id 1: the app made none');
  });

  it('waits for one that comes, and for one still in flight to end', async () => {
    const call = await start();
    at.probe.entries = [{ ...PUT, inFlight: true }];
    let reads = 0;
    at.probe.read = () => {
      const entries = at.probe.entries.map((e, id) => ({
        ...e,
        id,
        ...(++reads > 6 && { inFlight: undefined }),
      }));
      return Promise.resolve({
        entries: entries.map(({ inFlight, ...e }) => (inFlight ? { ...e, inFlight } : e)),
      });
    };
    const found = await call('network', { action: 'check', status: '409', timeoutMs: 5_000 });
    expect(found.text).toMatch(/^found: 0 PUT /);
    expect(reads).toBeGreaterThan(6);
  });

  it('refuses a miss with the nearest request and what of it differed', async () => {
    const call = await start(['hunter2']);
    at.probe.entries = [{ ...PUT, method: 'GET', url: 'https://api.test/other', status: 200 }, PUT];
    at.probe.details = { 1: SENT };
    const miss = (args: Record<string, unknown>) =>
      refusal(
        call('network', { action: 'check', contains: '/v1/profile', timeoutMs: 500, ...args }),
      );
    const status = await miss({ method: 'PUT', status: '2xx' });
    expect(status.code).toBe('CHECK_FAILED');
    expect(status.message).toBe(
      'no request PUT /v1/profile 2xx in 500 ms; nearest: PUT api.test/v1/profile 409 (id 1): 409, not 2xx',
    );
    expect((await miss({ method: 'POST' })).message).toMatch(/\(id 1\): PUT, not POST$/);
    expect((await miss({ contains: '/v2/' })).message).toMatch(/: its address has no \/v2\/$/);
    expect((await miss({ has: 'name=Grace' })).message).toMatch(
      /has name=Grace in 500 ms; nearest: .* \(id 1\): its request body has \{"name":"Ada"\}$/,
    );
    expect((await miss({ has: 'city=Van' })).message).toMatch(/its request body has no city=Van$/);
    // what it found goes out with its key, so a credential stays hidden by its name
    const hidden = await miss({ has: 'password=other' });
    expect(hidden.message).toMatch(/its request body has \{"password":"•••"\}$/);
    expect(hidden.message).not.toContain('hunter2');
    at.probe.details = {};
    expect((await miss({ has: 'response: ok=true' })).message).toMatch(
      /its response body was not kept, or is no text$/,
    );
    at.probe.entries = [{ ...PUT, inFlight: true }];
    expect((await miss({})).message).toMatch(
      /PUT api\.test\/v1\/profile in flight \(id 0\): it has not ended$/,
    );
  });

  it('refuses has where the capture keeps no bodies, and a check with no capture', async () => {
    const call = callerOf(context());
    expect((await refusal(call('network', { action: 'check' }))).code).toBe('NOT_FOUND');
    await call('network', { action: 'start', via: 'probe' });
    const e = await refusal(call('network', { action: 'check', has: 'a=1' }));
    expect(e.message).toBe(
      'has reads a body, and this capture keeps none: start with bodies: true',
    );
  });

  it('is a request step in a flow, which looks only at what came since the run began', async () => {
    const ctx = context();
    const call = callerOf(ctx);
    await call('network', { action: 'start', via: 'probe', bodies: true });
    at.probe.entries = [PUT];
    const flows = flowsFor(ctx);
    const old = await flows.replay(at.flowFile('request "/v1/profile" status=409 timeoutMs=300'));
    expect(old.failure?.message).toBe(
      'no request /v1/profile 409 in 300 ms after id 0: the app made none',
    );
    // one that comes while the flow runs
    at.probe.read = () => Promise.resolve({ entries: [PUT, PUT].map((e, id) => ({ ...e, id })) });
    at.probe.read = ((first) => () => {
      const entries = (first ? [PUT] : [PUT, PUT]).map((e, id) => ({ ...e, id }));
      first = false;
      return Promise.resolve({ entries });
    })(true);
    at.probe.details = { 1: SENT };
    const now = await flows.replay(
      at.flowFile('request "/v1/profile" method=PUT status=4xx has="name=Ada"'),
    );
    expect(now.passed).toBe(true);
    const bad = await refusal(flows.replay(at.flowFile('request /x status=ok')));
    expect(bad.message).toContain('request: status is 404, 4xx or failed: ok');
    const { text } = await recorded(call, () =>
      call('network', { action: 'check', contains: '/v1/profile', method: 'PUT', has: 'name=Ada' }),
    );
    expect(text).toContain('request "/v1/profile" method=PUT has="name=Ada"\n');
  });
});
