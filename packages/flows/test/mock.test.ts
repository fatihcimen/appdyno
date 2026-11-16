import { must } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { toMaestro, flowText, mockRule, parseFlow } from '../src/index.js';

const rule = (line: string) => mockRule(must(parseFlow(`mock ${line}`).steps[0], 'a step'));
const takes = (pattern: string | undefined, text: string) =>
  pattern === undefined || new RegExp(pattern, 'i').test(text);

describe('a mock step', () => {
  it('takes a request by its host and path, where a star is any run', () => {
    // [the rule's first word, a host, a path, taken]
    const vectors: [string, string, string, boolean][] = [
      ['api.example.com', 'api.example.com', '/any/path', true],
      ['api.example.com', 'www.api.example.com', '/', false],
      ['*.example.com', 'api.example.com', '/', true],
      ['*.example.com', 'example.com', '/', false],
      ['API.Example.com/v1/items', 'api.example.com', '/v1/items', true],
      ['api.example.com/v1/items', 'api.example.com', '/v1/items/7', false],
      ['api.example.com/v1/items*', 'api.example.com', '/v1/items/7', true],
      ['api.example.com/v1/*/photo', 'api.example.com', '/v1/7/photo', true],
      ['api.example.com/a.b', 'api.example.com', '/aXb', false],
      ['127.0.0.1:8080/x', '127.0.0.1:8080', '/x', true],
      ['*', 'anything.test', '/whatever', true],
      ['*/health', 'anything.test', '/health', true],
    ];
    for (const [word, host, path, taken] of vectors) {
      const r = rule(`${word} status=200`);
      expect(takes(r.host, host) && takes(r.path, path), `${word} on ${host}${path}`).toBe(taken);
    }
  });

  it('becomes what the probe reads: an answer, a failure, another host, a wait', () => {
    expect(rule('a.test/x body="{\\"ok\\":true}"')).toMatchObject({
      status: 200,
      body: '{"ok":true}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(
      rule('a.test/x method=post query="a=1&b=two" status=404 body=gone header="X-One: 1" times=2'),
    ).toMatchObject({
      method: 'POST',
      query: [
        ['a', '1'],
        ['b', 'two'],
      ],
      status: 404,
      headers: { 'Content-Type': 'text/plain', 'X-One': '1' },
      times: 2,
    });
    expect(rule('a.test body=@items.json type=text/csv')).toMatchObject({
      bodyFile: 'items.json',
      headers: { 'Content-Type': 'text/csv' },
    });
    expect(rule('a.test regex="/v\\\\d+/items" fail=timeout')).toMatchObject({
      path: '^(?:/v\\d+/items)$',
      fail: 'timeout',
    });
    expect(rule('a.test to=http://localhost:8080 delayMs=300')).toMatchObject({
      to: { scheme: 'http', host: 'localhost', port: 8080 },
      delayMs: 300,
    });
    expect(rule('a.test delayMs=300').status).toBeUndefined();
    // a bare localhost is this Mac by its address, in plain HTTP; one with a scheme stays as written
    expect(rule('a.test to=localhost:8080').to).toEqual({
      scheme: 'http',
      host: '127.0.0.1',
      port: 8080,
    });
    expect(rule('a.test to=https://localhost:8443').to).toEqual({
      scheme: 'https',
      host: 'localhost',
      port: 8443,
    });
    expect(rule('a.test to=staging.example.com').to).toEqual({ host: 'staging.example.com' });
  });

  it('keeps its id on and off, and has another for another rule', () => {
    const on = rule('a.test/x status=500');
    const off = rule('a.test/x status=500 off');
    expect(off).toMatchObject({ id: on.id, off: true });
    expect(rule('a.test/x status=501').id).not.toBe(on.id);
  });

  it('is refused at its line where it is no rule', () => {
    const refused = (line: string) => {
      try {
        parseFlow(`launch\nmock ${line}`);
      } catch (e) {
        return (e as Error).message;
      }
      return 'taken';
    };
    expect(refused('a.test')).toBe(
      'line 2: mock: say what it does: status, body, fail, to or delayMs',
    );
    expect(refused('a.test status=200 fail=offline')).toMatch(/one of an answer .* fail or to/);
    expect(refused('a.test fail=slow')).toMatch(/fail is offline, timeout, reset: slow/);
    expect(refused('a.test/x regex=x status=200')).toMatch(/a path or regex, not both/);
    expect(refused('a.test regex="(" status=200')).toMatch(/regex is not a pattern/);
    expect(refused('a.test status=99')).toMatch(/status is a whole number from 100 to 599/);
    expect(refused('a.test to=a/b')).toMatch(/to is a host/);
    expect(refused('a.test status=200 header=none')).toMatch(/a header is "Name: value"/);
    expect(refused('status=200')).toMatch(/mock needs request/);
  });

  it('is written as it was read, and has no form in the other format', () => {
    const text =
      'mock "api.example.com/v1/*" status=503 body="{}" header="A: b" header="C: d" off\n';
    const flow = parseFlow(text);
    expect(flowText(flow)).toBe(text);
    expect(() => toMaestro({ ...flow, app: 'dev.app' })).toThrow(/no rule for an app's requests/);
  });
});
