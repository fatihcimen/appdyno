import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pushCredentials } from '@appdyno/core';
import { fcmKey } from '@appdyno/driver-android';
import { apnsKey } from '@appdyno/driver-apple';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pushCommand } from '../src/push-setup.js';

/** Keys made here, none of anyone's: an APNs .p8 is an EC P-256 key, a service account's an RSA one. */
const pem = (type: 'ec' | 'rsa') =>
  (type === 'ec'
    ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    : generateKeyPairSync('rsa', { modulusLength: 2048 })
  ).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const P8 = pem('ec');
const ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'appdyno-test',
  private_key_id: 'k1',
  private_key: pem('rsa'),
  client_email: 'push@appdyno-test.iam.gserviceaccount.com',
});

/** A person at a terminal giving these answers in turn, and the files they name. */
const person = (answers: string[], files: Record<string, string> = {}) => {
  const said: string[] = [];
  return {
    said,
    use: {
      ask: vi.fn(async () => answers.shift() ?? ''),
      read: (path: string) => files[path.trim()] ?? '',
      say: (line: string) => void said.push(line),
    },
  };
};

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-push-setup-')));
});

describe('appdyno push setup', () => {
  it('keeps an APNs key for this user alone, and says nothing of it back', async () => {
    const p = person(['/keys/AuthKey.p8', 'ABC123DEFG', 'DEF123GHIJ', 'y'], {
      '/keys/AuthKey.p8': P8,
    });
    expect(await pushCommand(['setup', 'apns'], p.use)).toBe(0);
    expect(apnsKey()).toEqual({
      key: P8,
      keyId: 'ABC123DEFG',
      teamId: 'DEF123GHIJ',
      production: true,
    });
    const file = pushCredentials('apns');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
    const words = p.said.join('\n');
    for (const secret of [P8.split('\n')[1]!, 'ABC123DEFG', 'DEF123GHIJ'])
      expect(words).not.toContain(secret);
    expect(words).toContain('an MCP client is told only that it is set');
  });

  it('takes production only on a yes', async () => {
    const p = person(['k.p8', 'ABC123DEFG', 'DEF123GHIJ', ''], { 'k.p8': P8 });
    await pushCommand(['setup', 'apns'], p.use);
    expect(apnsKey()?.production).toBe(false);
  });

  it("refuses what is not an APNs key, or an id that is not Apple's, keeping nothing and repeating nothing", async () => {
    const rsa = pem('rsa');
    for (const [answers, files, why] of [
      [['k.p8', 'ABC123DEFG', 'DEF123GHIJ', 'n'], { 'k.p8': rsa }, 'not an APNs signing key'],
      [['k.p8', 'ABC123DEFG', 'DEF123GHIJ', 'n'], { 'k.p8': 'nothing' }, 'not an APNs signing key'],
      [['k.p8', 'abc', 'DEF123GHIJ', 'n'], { 'k.p8': P8 }, 'the key id is ten capital letters'],
    ] as const) {
      const p = person([...answers], files);
      expect(await pushCommand(['setup', 'apns'], p.use)).toBe(1);
      expect(p.said.join('\n')).toContain(why);
      expect(p.said.join('\n')).not.toContain(rsa.split('\n')[1]);
    }
    expect(apnsKey()).toBeUndefined();
  });

  it("keeps a Firebase service account's project, address and key, and refuses another file", async () => {
    const p = person(['account.json'], { 'account.json': ACCOUNT });
    expect(await pushCommand(['setup', 'fcm'], p.use)).toBe(0);
    expect(fcmKey()).toMatchObject({
      projectId: 'appdyno-test',
      clientEmail: 'push@appdyno-test.iam.gserviceaccount.com',
      keyId: 'k1',
    });
    expect(statSync(pushCredentials('fcm')).mode & 0o777).toBe(0o600);
    const other = person(['x.json'], { 'x.json': JSON.stringify({ type: 'authorized_user' }) });
    expect(await pushCommand(['setup', 'fcm'], other.use)).toBe(1);
    expect(other.said[0]).toContain('not a Firebase service account');
  });

  it('asks nothing and keeps nothing where no person is at a terminal', async () => {
    const said: string[] = [];
    const noTerminal = { read: () => P8, say: (l: string) => void said.push(l) };
    expect(await pushCommand(['setup', 'apns'], noTerminal)).toBe(2);
    expect(said[0]).toContain('at a terminal');
    expect(apnsKey()).toBeUndefined();
  });

  it('forgets: the file is gone, and a second forget says there was none', async () => {
    await pushCommand(
      ['setup', 'apns'],
      person(['k.p8', 'ABC123DEFG', 'DEF123GHIJ', 'n'], { 'k.p8': P8 }).use,
    );
    const p = person([]);
    expect(await pushCommand(['setup', 'apns', '--forget'], p.use)).toBe(0);
    expect(() => readFileSync(pushCredentials('apns'))).toThrow();
    await pushCommand(['setup', 'apns', '--forget'], p.use);
    expect(p.said).toEqual([
      'APNs: its credentials are deleted from this Mac.',
      'APNs was not set up.',
    ]);
    expect(p.use.ask).not.toHaveBeenCalled();
  });

  it('says how it is called otherwise', async () => {
    const p = person([]);
    expect(await pushCommand(['setup', 'gcm'], p.use)).toBe(2);
    expect(p.said[0]).toContain('appdyno push setup apns|fcm [--forget]');
  });
});
