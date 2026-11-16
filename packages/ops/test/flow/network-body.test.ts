import type { NetworkDetail, NetworkEntry } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { shapeOf } from '../../src/network-body.js';
import { probeSetup } from './fake-probe.js';
import { callerOf } from './harness.js';

const GET: NetworkEntry = {
  at: '2026-01-01T00:00:01.000Z',
  method: 'GET',
  url: 'https://api.test/search?q=shoe&token=abc123',
  status: 200,
  ms: 40,
  bytes: 90,
};
const body = (over: object = {}) =>
  JSON.stringify({
    data: {
      items: [
        { id: 1, name: 'Boot', price: 10.5, tags: ['a', 'b'] },
        { id: 2, name: 'Shoe', price: 21, sale: true },
      ],
      next: null,
    },
    session: { api_key: 'key-0042', user: 'ada' },
    ...over,
  });
const answered = (text: string, sent?: string): NetworkDetail => ({
  requestHeaders: {},
  responseHeaders: {},
  ...(sent !== undefined && { requestBody: sent }),
  responseBody: text,
  responseBodySize: text.length,
});

describe('the shape of a JSON value', () => {
  it('has each key with its type and a list with how many it holds, and no value', () => {
    expect(shapeOf(JSON.parse(body()))).toBe(
      '{data: {items: [2 × {id: number, name: string, price: number, tags?: [2 × string], sale?: boolean}], next: null}, session: {api_key: string, user: string}}',
    );
    expect(shapeOf([1, 'a', null, []])).toBe('[4 × number | string | null | []]');
    expect(shapeOf([1, 'a', null, [], true])).toBe('[5 × number | string | null | [] | …]');
    expect(shapeOf('x')).toBe('string');
  });
});

describe('a body of a request, read in part', () => {
  const at = probeSetup();
  const { context, refusal } = at.helpers;
  const start = async (bodies = true) => {
    const call = callerOf(context(['s3cr3t-pass']));
    await call('network', { action: 'start', via: 'probe', bodies });
    at.probe.entries = [
      GET,
      { ...GET, url: 'https://api.test/search?q=shoe%20&page=2', status: 404 },
    ];
    at.probe.details = {
      0: answered(body(), '{"q":"shoe","password":"hunter2"}'),
      1: answered(
        body({ data: { items: [{ id: 1, name: 'Boot', price: 12 }], next: 's3cr3t-pass' } }),
      ),
    };
    return call;
  };
  /** A read of the capture just started, as its lines. */
  const reader = async () => {
    const call = await start();
    return async (args: Record<string, unknown>) =>
      (await call('network', { action: 'read', ...args })).text.split('\n');
  };

  it('gives one value by its path, hidden where its key names a credential', async () => {
    const read = await reader();
    const head = '0 GET https://api.test/search?q=shoe&token=••• 200 40 ms 90 B';
    expect(await read({ id: 0, path: 'data.items[1].name' })).toEqual([
      head,
      'response data.items[1].name: "Shoe"',
    ]);
    expect(await read({ id: 0, path: 'data.items[0].tags' })).toEqual([
      head,
      'response data.items[0].tags: ["a","b"]',
    ]);
    expect((await read({ id: 0, path: 'session.api_key' }))[1]).toBe(
      'response session.api_key: •••',
    );
    expect((await read({ id: 0, path: 'session' }))[1]).toBe(
      'response session: {"api_key":"•••","user":"ada"}',
    );
    expect((await read({ id: 0, path: 'request: q' }))[1]).toBe('request q: "shoe"');
    expect((await read({ id: 0, path: 'request: password' }))[1]).toBe('request password: •••');
    // a path that leads nowhere says what is there
    expect((await read({ id: 0, path: 'data.total' }))[1]).toMatch(
      /^the response body has no data\.total: its shape is \{data: \{items: \[2 × /,
    );
    expect((await read({ id: 1, path: 'request: q' }))[1]).toBe(
      'the request body was not kept, or is no text',
    );
  });

  it('gives the shape of each body, and says of one cut short or of no JSON why it has none', async () => {
    const call = await start();
    expect(
      (await call('network', { action: 'read', id: 0, shape: true })).text.split('\n'),
    ).toEqual([
      '0 GET https://api.test/search?q=shoe&token=••• 200 40 ms 90 B',
      'request body shape: {q: string, password: string}',
      'response body shape: {data: {items: [2 × {id: number, name: string, price: number, tags?: [2 × string], sale?: boolean}], next: null}, session: {api_key: string, user: string}}',
    ]);
    at.probe.details = {
      0: { ...answered('{"a":[1,2'), responseBodySize: 90_000 },
      1: answered('<html></html>'),
    };
    expect((await call('network', { action: 'read', id: 0, shape: true })).text).toContain(
      'the response body is 90000 B and its first 9 were kept: no whole JSON',
    );
    expect((await call('network', { action: 'read', id: 1, shape: true })).text).toContain(
      'the response body is no JSON',
    );
  });

  it('says in a few lines what differs between two requests, with what is hidden kept so', async () => {
    const read = await reader();
    const lines = await read({ id: 1, diff: 0 });
    expect(lines).toEqual([
      '1 GET https://api.test/search?q=shoe%20&page=2 404 40 ms 90 B',
      '0 → 1: 9 differ',
      'status: 200 → 404',
      'request.query.q: "shoe" → "shoe "',
      'request.query.token: ••• → none',
      'request.query.page: none → "2"',
      'response.data.items[0].price: 10.5 → 12',
      'response.data.items[0].tags: ["a","b"] → none',
      'response.data.items[1]: {"id":2,"name":"Shoe","price":21,"sale":true} → none',
      'response.data.next: null → •••',
      'request body: differs, 33 characters → none, not both JSON',
    ]);
    expect((await read({ id: 0, diff: 0 }))[1]).toBe(
      '0 → 0: no difference in address, status, query or bodies',
    );
  });

  it('refuses where it has no meaning: with no id, with no bodies kept, a path that is none', async () => {
    const call = await start(false);
    const e = (args: Record<string, unknown>) =>
      refusal(call('network', { action: 'read', ...args }));
    expect((await e({ shape: true })).message).toBe('path, shape and diff go with read and id');
    expect((await e({ id: 0, shape: true })).message).toMatch(/this capture keeps none/);
    await call('network', { action: 'stop' });
    const kept = await start();
    const bad = await refusal(kept('network', { action: 'read', id: 0, path: 'a b' }));
    expect(bad.message).toBe('path is keys and indexes, as data.items[0].price: a b');
    expect((await refusal(kept('network', { action: 'read', id: 0, diff: 7 }))).code).toBe(
      'NOT_FOUND',
    );
  });
});
