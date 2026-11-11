import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { connect, type ClientHttp2Session } from 'node:http2';
import { jwtCache, jwtOf } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import type { ApnsKey } from './apns-key.js';

/** Apple's two hosts, and no other: a push goes to one of these or nowhere. */
export const APNS_HOSTS = {
  sandbox: 'api.sandbox.push.apple.com',
  production: 'api.push.apple.com',
} as const;
export type ApnsEnvironment = keyof typeof APNS_HOSTS;

/**
 * Each of APNs' push types: its topic's suffix, its priority and its payload's limit, as Apple's "Sending notification
 * requests to APNs" sets them. A background push goes only at 5; WidgetKit's guide names no priority, so APNs' own.
 */
export const APNS_KINDS = {
  alert: { suffix: '', priority: '10', bytes: 4_096 },
  background: { suffix: '', priority: '5', bytes: 4_096 },
  liveactivity: { suffix: '.push-type.liveactivity', priority: '10', bytes: 4_096 },
  voip: { suffix: '.voip', priority: '10', bytes: 5_120 },
  widgets: { suffix: '.push-type.widgets', priority: undefined, bytes: 4_096 },
} as const;
export type ApnsKind = keyof typeof APNS_KINDS;

/** Apple takes a provider token for an hour, and one made more often than every 20 minutes is refused: 40 it is. */
const tokens = jwtCache(40 * 60_000);

/** The provider token: an ES256 JWT of the key's id and the team's, made again only once Apple would want it. */
export function providerToken(k: ApnsKey, now = Date.now()) {
  return tokens(`${k.teamId}.${k.keyId}`, now, () =>
    jwtOf(
      { alg: 'ES256', kid: k.keyId },
      { iss: k.teamId, iat: Math.floor(now / 1000) },
      (signed) =>
        sign('sha256', signed, { key: createPrivateKey(k.key), dsaEncoding: 'ieee-p1363' }),
    ),
  );
}

/** A request to APNs as it goes on the wire. */
export type ApnsRequest = { headers: Record<string, string>; body: string };

/** The request for one push of `kind` to the app `bundle`, by the device's or the activity's token. */
export function apnsRequest(
  kind: ApnsKind,
  bundle: string,
  token: string,
  payload: Record<string, unknown>,
  jwt: string,
): ApnsRequest {
  const k = APNS_KINDS[kind];
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > k.bytes)
    throw new DeviceError('INVALID_ARGUMENT', `a ${kind} payload is ${k.bytes} bytes at most`);
  return {
    headers: {
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-push-type': kind,
      'apns-topic': `${bundle}${k.suffix}`,
      ...(k.priority && { 'apns-priority': k.priority }),
      // now or never: a push kept for later reaches the device when no one looks
      'apns-expiration': '0',
      'apns-id': randomUUID(),
    },
    body,
  };
}

/** Apple's reasons, in words for a person: none names a key, a token or a device. */
export const APNS_HINTS: Record<string, string> = {
  BadDeviceToken:
    "the token is not one this host knows: it may be for the other environment (a development build's goes to the sandbox, a distribution build's to production), or not a device token: a person sets production at `appdyno push setup apns`",
  DeviceTokenNotForTopic: "the token is another app's",
  TopicDisallowed: "the key's team may not push to this app",
  BadTopic: 'APNs knows no such topic',
  BadCollapseId: 'the collapse id is too long',
  BadExpirationDate: 'the expiration is not a time',
  BadMessageId: 'the push id is not a UUID',
  BadPriority: 'the priority is not one this push type takes',
  MissingDeviceToken: 'no token went',
  MissingTopic: 'no topic went',
  DuplicateHeaders: 'a header went twice',
  IdleTimeout: 'the connection was idle too long: send again',
  InvalidPushType: 'APNs takes no such push type',
  PayloadEmpty: 'the payload is empty',
  PayloadTooLarge: 'the payload is too large',
  BadCertificate: 'APNs refused the connection',
  BadCertificateEnvironment: 'APNs refused the connection for this environment',
  ExpiredProviderToken: 'the provider token was too old: send again',
  InvalidProviderToken:
    'the key, its id and the team id do not go together: a person sets them again with `appdyno push setup apns`',
  MissingProviderToken: 'no provider token went',
  UnrelatedKeyIdInToken: 'the key changed on this connection: send again',
  BadEnvironmentKeyIdInToken:
    "this key is not for this environment: a team's key is for the sandbox, production or both",
  Forbidden: 'APNs does not allow this push',
  BadPath: 'the path is not a device token',
  MethodNotAllowed: 'APNs takes only POST',
  ExpiredToken: 'the token has expired: the app gets a new one at its next launch',
  Unregistered:
    'the token is no longer active for this app: the app gets a new one at its next launch',
  TooManyProviderTokenUpdates: 'the provider token changed too often: wait 20 minutes',
  TooManyRequests: 'too many pushes to this device: wait a little',
  InternalServerError: 'APNs failed: Apple asks for 15 minutes before trying again',
  ServiceUnavailable: 'APNs is unavailable: Apple asks for 15 minutes before trying again',
  Shutdown: 'APNs is shutting down: send again',
};

export type ApnsAnswer = { status: number; apnsId?: string; reason?: string };

/** A connection to one of Apple's hosts: the only kind there is. */
export type ApnsConnect = (host: (typeof APNS_HOSTS)[ApnsEnvironment]) => ClientHttp2Session;
const toApple: ApnsConnect = (host) => connect(`https://${host}`);

/** A failure to reach APNs, in words with nothing of the request in them. */
const unreached = (why: string) =>
  new DeviceError('INTERNAL', `APNs was not reached: ${why}`, 'check that this Mac reaches Apple');

/** One push, on a connection of its own closed after it: one push a call, a few a minute. */
export async function sendApns(
  environment: ApnsEnvironment,
  request: ApnsRequest,
  open: ApnsConnect = toApple,
  timeoutMs = 15_000,
): Promise<ApnsAnswer> {
  const session = open(APNS_HOSTS[environment]);
  try {
    return await new Promise<ApnsAnswer>((resolve, reject) => {
      session.on('error', (e: Error) => reject(unreached(e.message)));
      const stream = session.request(request.headers);
      stream.setTimeout(timeoutMs, () => stream.close());
      let status = 0;
      let apnsId: string | undefined;
      const chunks: Buffer[] = [];
      stream.on('response', (h) => {
        status = Number(h[':status']);
        apnsId = h['apns-id'] as string | undefined;
      });
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('error', (e: Error) => reject(unreached(e.message)));
      stream.on('close', () => {
        if (!status) {
          reject(unreached(`no answer in ${timeoutMs / 1000} s`));
          return;
        }
        resolve({ status, ...(apnsId && { apnsId }), ...reasonOf(chunks) });
      });
      stream.end(request.body);
    });
  } finally {
    session.close();
  }
}

/** APNs' reason, from a body that should be its JSON: anything else is no reason. */
function reasonOf(chunks: Buffer[]) {
  try {
    const { reason } = JSON.parse(Buffer.concat(chunks).toString()) as { reason?: unknown };
    return typeof reason === 'string' && /^\w{1,64}$/.test(reason) ? { reason } : {};
  } catch {
    return {};
  }
}
