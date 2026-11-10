import { expect, it } from 'vitest';
import { policyOf, tokenFromEnv } from '../src/serve.js';

it('takes a token that is long enough and fits in a URL, and refuses any other by its fix', () => {
  expect(tokenFromEnv(undefined)).toBeUndefined();
  const good = 'a1b2c3d4'.repeat(4);
  expect(tokenFromEnv(good)).toBe(good);
  for (const bad of ['', 'short', `${good}/`, `${good} `, `${good}?a=b`])
    expect(() => tokenFromEnv(bad)).toThrow('openssl rand -hex 32');
});

it('refuses an allow list given empty, by flag or variable, as it would let in every one', () => {
  for (const values of [{ 'allow-devices': '' }, { 'allow-apps': ' , ' }, { 'allow-urls': ' ' }])
    expect(() => policyOf(values, {})).toThrow('is empty, which would let in every one');
  for (const name of ['APPDYNO_ALLOW_DEVICES', 'APPDYNO_ALLOW_APPS', 'APPDYNO_ALLOW_URLS'])
    expect(() => policyOf({}, { [name]: '' })).toThrow(`(${name}) is empty`);
  // none given is no list, as before
  expect(policyOf({}, {})).toMatchObject({ apps: [] });
  expect(policyOf({}, {}).devices).toBeUndefined();
  expect(policyOf({ 'allow-devices': '^emulator-' }, {}).devices?.test('emulator-5554')).toBe(true);
});
