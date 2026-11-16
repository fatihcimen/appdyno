import { ruleLine } from '@appdyno/ops';
import { describe, expect, it } from 'vitest';
import { fieldsLine, ruleFields } from '../src/window-network-rules.js';

describe("a rule as a window's fields", () => {
  it('reads a line into its parts, what has no field of its own kept as words', () => {
    expect(
      ruleFields(
        'api.test/v1/items* method=post query="page=2" has=name=Ada when="X-Api: 2*" status=503 body="{\\"e\\":1}" delayMs=300 times=2 off',
      ),
    ).toEqual({
      method: 'post',
      host: 'api.test',
      path: '/v1/items*',
      match: 'query="page=2" has="name=Ada" when="X-Api: 2*" times=2 off',
      status: '503',
      body: '{"e":1}',
      delayMs: '300',
    });
    expect(ruleFields('* fail=offline')).toEqual({ host: '*', fail: 'offline' });
    expect(ruleFields('cdn.test to=http://127.0.0.1:8080')).toEqual({
      host: 'cdn.test',
      to: 'http://127.0.0.1:8080',
    });
  });

  it('writes the fields as the line the op takes, and back the same', () => {
    const lines = [
      '"api.test/v1/items*" method=POST query="page=2" has="name=Ada" status=503 body="{\\"e\\":1}" delayMs=300',
      '"*" fail=offline',
      '"cdn.test" to=http://127.0.0.1:8080',
      '"api.test/graphql" has="operationName=Cart" body=@cart.json',
    ];
    for (const line of lines) expect(fieldsLine(ruleFields(line))).toBe(ruleLine(line));
    expect(
      fieldsLine({ host: ' api.test ', path: '/pay', status: '500', body: 'not "json"' }),
    ).toBe('"api.test/pay" status=500 body="not \\"json\\""');
    // what makes no rule is refused as the op refuses a line
    expect(() => fieldsLine({ path: '/x', status: '200' })).toThrow(/not a rule/);
    expect(() => fieldsLine({ host: 'a.test' })).toThrow(/say what it does/);
    expect(() => fieldsLine({ host: 'a.test', status: 'two hundred' })).toThrow(/not a rule/);
  });
});
