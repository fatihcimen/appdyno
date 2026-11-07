import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect, createServer, type Http2Server } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APNS_HINTS,
  APNS_HOSTS,
  APNS_KINDS,
  apnsRequest,
  providerToken,
  sendApns,
  type ApnsKind,
} from '../src/apns.js';

/** A key made here: none of anyone's. */
const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const KEY = {
  key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  keyId: 'ABC123DEFG',
  teamId: 'DEF123GHIJ',
  production: false,
};
const TOKEN = '0123456789abcdef'.repeat(4);
/** The requests Apple's "Sending notification requests to APNs" sets for each push type, as recorded for this app. */
const RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/apns-requests.json', import.meta.url), 'utf8'),
) as Record<ApnsKind, { headers: Record<string, string>; body: string }>;

const part = (jwt: string, i: number) =>
  JSON.parse(Buffer.from(jwt.split('.')[i]!, 'base64url').toString()) as Record<string, unknown>;

describe("APNs' provider token", () => {
  it('is an ES256 JWT of the key id and the team, signed by the key', () => {
    const jwt = providerToken(KEY, 1_700_000_000_000);
    expect(part(jwt, 0)).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(part(jwt, 1)).toEqual({ iss: 'DEF123GHIJ', iat: 1_700_000_000 });
    const [head, claims, signature] = jwt.split('.') as [string, string, string];
    expect(
      verify(
        'sha256',
        Buffer.from(`${head}.${claims}`),
        { key: pair.publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('is kept 40 minutes, as Apple refuses one made every push and one over an hour old', () => {
    const at = 1_800_000_000_000;
    const first = providerToken(KEY, at);
    expect(providerToken(KEY, at + 39 * 60_000)).toBe(first);
    expect(part(providerToken(KEY, at + 41 * 60_000), 1).iat).toBe(at / 1000 + 41 * 60);
  });
});

describe('a request to APNs', () => {
  it("goes as Apple sets each push type: its push type, its topic's suffix, its priority", () => {
    for (const kind of Object.keys(APNS_KINDS) as ApnsKind[]) {
      const { headers, body } = apnsRequest(kind, 'dev.app', TOKEN, { aps: {} }, 'J');
      const { authorization, 'apns-id': id, ...shown } = headers;
      expect(authorization).toBe('bearer J');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect({ headers: shown, body }, kind).toEqual(RECORDED[kind]);
    }
  });

  it('is 4 KB at most, and a VoIP push 5', () => {
    const big = (n: number) => ({ aps: {}, x: 'x'.repeat(n) });
    expect(() => apnsRequest('alert', 'dev.app', TOKEN, big(4_096), 'J')).toThrow(
      'a alert payload is 4096 bytes at most',
    );
    expect(() => apnsRequest('voip', 'dev.app', TOKEN, big(4_096), 'J')).not.toThrow();
    expect(() => apnsRequest('voip', 'dev.app', TOKEN, big(5_120), 'J')).toThrow('5120');
  });
});

describe('a push to APNs', () => {
  let server: Http2Server;
  let answer = { status: 200, body: '' };
  const seen: { headers: Record<string, unknown>; body: string }[] = [];
  /** Apple's place taken by this Mac: the connection is all a test changes, and it says which host it was for. */
  const hosts: string[] = [];
  const open = (host: string) => {
    hosts.push(host);
    return connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen.push({ headers: req.headers, body });
        res.writeHead(answer.status, { 'apns-id': String(req.headers['apns-id']) });
        res.end(answer.body);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });
  afterAll(() => server.close());

  it('goes to the sandbox with its headers and payload, and answers its id', async () => {
    const request = apnsRequest('alert', 'dev.app', TOKEN, { aps: { alert: 'Hi' } }, 'J');
    const r = await sendApns('sandbox', request, open as never);
    expect(hosts).toEqual(['api.sandbox.push.apple.com']);
    expect(r).toEqual({ status: 200, apnsId: request.headers['apns-id'] });
    expect(seen[0]).toMatchObject({
      headers: {
        ':path': `/3/device/${TOKEN}`,
        'apns-topic': 'dev.app',
        authorization: 'bearer J',
      },
      body: '{"aps":{"alert":"Hi"}}',
    });
  });

  it("reads Apple's reason, and nothing from a body that is not its JSON", async () => {
    answer = { status: 400, body: '{"reason":"BadDeviceToken"}' };
    const request = apnsRequest('alert', 'dev.app', TOKEN, { aps: {} }, 'J');
    expect((await sendApns('production', request, open as never)).reason).toBe('BadDeviceToken');
    expect(hosts.at(-1)).toBe('api.push.apple.com');
    answer = { status: 500, body: '<html>secret</html>' };
    expect(await sendApns('sandbox', request, open as never)).not.toHaveProperty('reason');
  });

  it('says APNs was not reached, with nothing of the request in its words', async () => {
    const request = apnsRequest('alert', 'dev.app', TOKEN, { aps: {} }, 'SECRETJWT');
    const nowhere = () => connect('http://127.0.0.1:1');
    const e = await sendApns('sandbox', request, nowhere as never).catch((x: Error) => x);
    expect(String(e)).toContain('APNs was not reached');
    expect(String(e)).not.toMatch(/SECRETJWT|0123456789abcdef/);
  });

  it('knows only the two hosts Apple names', () => {
    expect(Object.values(APNS_HOSTS)).toEqual(['api.sandbox.push.apple.com', 'api.push.apple.com']);
  });
});

describe("APNs' reasons", () => {
  it('each in words for a person, from the table Apple gives', () => {
    // "Handling notification responses from APNs", its reasons in full
    const apple =
      'BadCollapseId BadDeviceToken BadExpirationDate BadMessageId BadPriority BadTopic DeviceTokenNotForTopic DuplicateHeaders IdleTimeout InvalidPushType MissingDeviceToken MissingTopic PayloadEmpty TopicDisallowed BadCertificate BadCertificateEnvironment ExpiredProviderToken Forbidden InvalidProviderToken MissingProviderToken UnrelatedKeyIdInToken BadEnvironmentKeyIdInToken BadPath MethodNotAllowed ExpiredToken Unregistered PayloadTooLarge TooManyProviderTokenUpdates TooManyRequests InternalServerError ServiceUnavailable Shutdown';
    expect(Object.keys(APNS_HINTS).sort()).toEqual(apple.split(' ').sort());
    expect(APNS_HINTS.BadDeviceToken).toContain('the other environment');
  });
});
