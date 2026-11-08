import { must } from '@appdyno/core';
import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FCM_HINTS, FCM_HOST, fcmRequest, fcmToken, sendFcm } from '../src/fcm.js';

/** A service account's key made here: none of anyone's. */
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = {
  projectId: 'appdyno-test',
  clientEmail: 'push@appdyno-test.iam.gserviceaccount.com',
  keyId: 'k1',
  key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
};
const TOKEN = `${'a'.repeat(22)}:APA91b${'B'.repeat(140)}`;
/** The request Firebase's "Build app server send requests" gives for a message to one device, as recorded. */
const RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/fcm-request.json', import.meta.url), 'utf8'),
) as { url: string; headers: Record<string, string>; body: unknown };

const part = (jwt: string, i: number) =>
  JSON.parse(Buffer.from(must(jwt.split('.')[i], 'a part'), 'base64url').toString()) as Record<
    string,
    unknown
  >;

describe("FCM's own token", () => {
  it("is the service account's RS256 JWT for FCM's audience, an hour long, with no exchange at another host", () => {
    const jwt = fcmToken(KEY, 1_700_000_000_000);
    expect(part(jwt, 0)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'k1' });
    expect(part(jwt, 1)).toEqual({
      iss: KEY.clientEmail,
      sub: KEY.clientEmail,
      aud: 'https://fcm.googleapis.com/',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const [head, claims, signature] = jwt.split('.') as [string, string, string];
    expect(
      verify(
        'sha256',
        Buffer.from(`${head}.${claims}`),
        pair.publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
    expect(fcmToken(KEY, 1_700_000_000_000 + 49 * 60_000)).toBe(jwt);
  });
});

describe('a message to FCM', () => {
  it("goes to FCM's v1 endpoint for the project, to this token alone, as Firebase records it", () => {
    const message = {
      notification: { title: 'Order 42', body: 'shipped' },
      data: { order: '42' },
      android: { priority: 'HIGH', ttl: '0s' },
    };
    const r = fcmRequest('appdyno-test', TOKEN, message, 'J');
    const { authorization, ...headers } = r.headers;
    expect(authorization).toBe('Bearer J');
    expect({ url: r.url, headers, body: JSON.parse(r.body) as unknown }).toEqual(RECORDED);
  });

  it('names no other target, and is 4 KB at most', () => {
    for (const target of ['token', 'topic', 'condition'])
      expect(() => fcmRequest('p', TOKEN, { [target]: 'x' }, 'J')).toThrow(`names no ${target}`);
    expect(() => fcmRequest('p', TOKEN, { data: { x: 'x'.repeat(4_096) } }, 'J')).toThrow(
      '4096 bytes',
    );
  });

  it("is answered with its name, or FCM's error code, and nothing from a body not FCM's", async () => {
    const post = vi.fn((_url: string, _init: unknown) =>
      Promise.resolve(Response.json({ name: 'projects/appdyno-test/messages/0:1' })),
    );
    const request = fcmRequest('appdyno-test', TOKEN, { data: {} }, 'J');
    expect(await sendFcm(request, post as never)).toEqual({
      status: 200,
      name: 'projects/appdyno-test/messages/0:1',
    });
    expect(post.mock.calls[0]?.[0]).toBe(
      `https://${FCM_HOST}/v1/projects/appdyno-test/messages:send`,
    );
    const error = {
      error: {
        code: 404,
        status: 'NOT_FOUND',
        details: [
          {
            '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
            errorCode: 'UNREGISTERED',
          },
        ],
      },
    };
    post.mockResolvedValueOnce(Response.json(error, { status: 404 }));
    expect(await sendFcm(request, post as never)).toEqual({ status: 404, code: 'UNREGISTERED' });
    post.mockResolvedValueOnce(new Response('<html>no</html>', { status: 502 }));
    expect(await sendFcm(request, post as never)).toEqual({ status: 502 });
    expect(FCM_HINTS.UNREGISTERED).toContain('no longer valid');
  });

  it('goes nowhere but FCM, and says FCM was not reached with nothing of the request in its words', async () => {
    const elsewhere = { ...fcmRequest('p', TOKEN, {}, 'SECRETJWT'), url: 'https://example.com/v1' };
    await expect(sendFcm(elsewhere, vi.fn() as never)).rejects.toThrow(
      'FCM is fcm.googleapis.com alone',
    );
    const down = vi.fn(() =>
      Promise.reject(Object.assign(new Error(`failed with ${TOKEN}`), { name: 'TypeError' })),
    );
    const e = await sendFcm(fcmRequest('p', TOKEN, {}, 'SECRETJWT'), down as never).catch(
      (x: unknown) => x,
    );
    expect(String(e)).toContain('FCM was not reached');
    expect(String(e)).not.toMatch(/SECRETJWT|APA91/);
  });
});
