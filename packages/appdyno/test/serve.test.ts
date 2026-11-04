import { expect, it } from 'vitest';
import { tokenFromEnv } from '../src/serve.js';

it('takes a token that is long enough and fits in a URL, and refuses any other by its fix', () => {
  expect(tokenFromEnv(undefined)).toBeUndefined();
  const good = 'a1b2c3d4'.repeat(4);
  expect(tokenFromEnv(good)).toBe(good);
  for (const bad of ['', 'short', `${good}/`, `${good} `, `${good}?a=b`])
    expect(() => tokenFromEnv(bad)).toThrow('openssl rand -hex 32');
});
