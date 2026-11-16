import { parseArgs } from 'node:util';
import { expect, it } from 'vitest';
import { allowFlags, ownPaths, policyOf, tokenFromEnv } from '../src/serve.js';
import { COMMANDS } from '../src/usage.js';

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

it("writes where a command line's own path says, and holds a server's tool calls to its folders", () => {
  // a server's: the folders it was started with, and no more
  expect(policyOf({}, {}).writeDirs).toEqual([]);
  expect(policyOf({ 'allow-write': ['/a'] }, { APPDYNO_ALLOW_WRITE: '/b:/c' }).writeDirs).toEqual([
    '/a',
    '/b',
    '/c',
  ]);
  // a command's: the disk's root, which every path is inside
  expect(policyOf(ownPaths({}), {}).writeDirs).toEqual(['/']);
  expect(policyOf(ownPaths({ 'allow-write': ['/a'] }), {}).writeDirs).toEqual(['/a', '/']);
});

it('allows a build ahead by its own flag or variable, and by no other', () => {
  expect(policyOf({ 'allow-build': true }, {}).allowBuild).toBe(true);
  expect(policyOf({}, { APPDYNO_ALLOW_BUILD: '1' }).allowBuild).toBe(true);
  for (const env of [{}, { APPDYNO_ALLOW_BUILD: '0' }, { APPDYNO_ALLOW_DATA_LOSS: 'all' }])
    expect(policyOf({}, env).allowBuild).toBeUndefined();
});

it('reads the secrets of the variable and of the file, and stops at a file it cannot read', () => {
  expect(policyOf({}, { APPDYNO_SECRETS: 'a1,b22' }).secrets).toEqual(['b22', 'a1']);
  expect(() => policyOf({}, { APPDYNO_SECRETS_FILE: '/no/such/file' })).toThrow(
    'APPDYNO_SECRETS_FILE: cannot read /no/such/file',
  );
});

it("takes an install form's field as the person left it: empty is no list, and what is written is held to the same", () => {
  const fields = ['DEVICES', 'APPS', 'URLS'].map((f) => `APPDYNO_FORM_ALLOW_${f}`);
  // empty, and the manifest's own placeholder, which a client leaves where a field has no value
  for (const empty of ['', '  ', '${user_config.allow_devices}'])
    for (const name of fields) {
      const policy = policyOf({}, { [name]: empty });
      expect(policy.apps).toEqual([]);
      expect([policy.devices, policy.urls]).toEqual([undefined, undefined]);
    }
  const policy = policyOf(
    {},
    {
      APPDYNO_FORM_ALLOW_DEVICES: '^emulator-',
      APPDYNO_FORM_ALLOW_APPS: 'a.b, c.d',
      APPDYNO_FORM_ALLOW_URLS: '^https://a\\.test/',
    },
  );
  expect(policy.devices?.test('emulator-5554')).toBe(true);
  expect(policy.devices?.test('R68')).toBe(false);
  expect(policy.apps).toEqual(['a.b', 'c.d']);
  expect(policy.urls?.test('https://a.test/x')).toBe(true);
  expect(() => policyOf({}, { APPDYNO_FORM_ALLOW_DEVICES: 'emu|' })).toThrow(
    'matches the empty text',
  );
  expect(() => policyOf({}, { APPDYNO_FORM_ALLOW_APPS: ' , ' })).toThrow('is empty');
  // a flag or the server's own variable comes first, and its empty value is refused as before
  expect(policyOf({ 'allow-apps': 'x.y' }, { APPDYNO_FORM_ALLOW_APPS: 'a.b' }).apps).toEqual([
    'x.y',
  ]);
  expect(() => policyOf({}, { APPDYNO_ALLOW_APPS: '', APPDYNO_FORM_ALLOW_APPS: 'a.b' })).toThrow(
    '(APPDYNO_ALLOW_APPS) is empty',
  );
});

it('refuses a device or link pattern that matches the empty text, as one side of it unset leaves', () => {
  for (const values of [
    { 'allow-devices': 'emu|' },
    { 'allow-devices': '|' },
    { 'allow-urls': '.*' },
  ])
    expect(() => policyOf(values, {})).toThrow('matches the empty text');
  expect(() => policyOf({}, { APPDYNO_ALLOW_DEVICES: '^R68|' })).toThrow(
    '(APPDYNO_ALLOW_DEVICES) matches the empty text',
  );
  expect(policyOf({ 'allow-devices': '^emulator-5554$|^R68' }, {}).devices?.test('x')).toBe(false);
});

it('gives a server it starts the devices and apps it keeps to, by flag, which that server reads as its own', () => {
  const hub = policyOf({ 'allow-devices': '^emulator-5554$' }, { APPDYNO_ALLOW_APPS: 'a.b, c.d' });
  const { values } = parseArgs({ args: allowFlags(hub), options: COMMANDS.mcp.flags });
  const server = policyOf(values, {});
  expect(server.devices?.source).toBe('^emulator-5554$');
  expect(server.apps).toEqual(['a.b', 'c.d']);
  expect(allowFlags(policyOf({}, {}))).toEqual([]);
});
