import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { secretsOf } from '../../src/index.js';
import { connect, withScreen } from './shared.js';

const SECRET = 'hunter2-is-the-password';

describe('a listed secret', () => {
  it('is hidden whole where the cut of a long label falls on it, in a screen, a find, a wait and a refusal', async () => {
    // the label is cut at 60: the secret begins before that and ends after it
    const long = `${'Signed in with the account whose password is '.padEnd(50, 'x')}${SECRET} and more`;
    withScreen('long', [
      { c: 'android.widget.Button', t: long, b: [0, 100, 1080, 200], f: 19 },
      { c: 'android.widget.Button', t: 'Next', b: [0, 300, 1080, 400], f: 19 },
    ]);
    const d = new FakeDevice();
    d.screen = 'long';
    const { call } = await connect(d, { policy: { secrets: [SECRET] } });
    const answers = [
      await call('screen'),
      await call('find', { selector: { text: 'Signed in' } }),
      await call('wait_for', { selector: { text: 'Signed in' }, timeoutMs: 1_000 }),
      await call('tap', { selector: { text: 'No such thing' } }),
      await call('tap', { selector: { text: 'Next' }, read: 'full' }),
    ];
    for (const { text, data } of answers) {
      expect(text).toContain('•••');
      expect(`${text}${JSON.stringify(data)}`).not.toContain(SECRET.slice(0, 6));
    }
  });

  it('is said of a picture and a video, which hide none, only where one is listed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-secrets-'));
    const said = 'listed secrets are hidden in text only: this';
    // no window's own picture: the device's is the one taken
    const device = () => Object.assign(new FakeDevice(), { mirror: {} });
    const some = await connect(device(), { policy: { secrets: [SECRET] } });
    expect((await some.call('screenshot')).text).toContain(`${said} picture shows the screen`);
    expect(
      (await some.call('screenshot', { file: join(dir, 'a.png'), inline: false })).text,
    ).toContain(`${said} picture shows the screen`);
    const none = await connect(device());
    expect((await none.call('screenshot')).text).not.toContain(said);
  });

  it('is read from the variable, from a file with one to a line where it holds a comma, and from a program', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'appdyno-secrets-')), 'secrets');
    writeFileSync(file, 'one, with a comma\r\n\n  spaced  \n');
    expect(secretsOf({ APPDYNO_SECRETS: 'a1, b22 ,', APPDYNO_SECRETS_FILE: file }, ['c'])).toEqual([
      'one, with a comma',
      '  spaced  ',
      'b22',
      'a1',
      'c',
    ]);
    expect(secretsOf({})).toEqual([]);
    // plain JavaScript may give one text where the type asks for a list
    expect(secretsOf({}, 'whole')).toEqual(['whole']);
    expect(() => secretsOf({ APPDYNO_SECRETS_FILE: join(file, 'none') })).toThrow(
      /^APPDYNO_SECRETS_FILE: cannot read /,
    );
  });
});
