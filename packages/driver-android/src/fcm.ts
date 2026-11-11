import { createPrivateKey, sign } from 'node:crypto';
import { jwtCache, jwtOf } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import type { FcmKey } from './fcm-key.js';

/** Google's FCM HTTP v1 host, and no other: no token exchange either, as a service account signs its own. */
export const FCM_HOST = 'fcm.googleapis.com';

/** FCM's limit for a message's payload, its notification and data alike. */
const FCM_BYTES = 4_096;

/** An access token is good for an hour: made again ten minutes before. */
const tokens = jwtCache(50 * 60_000);

/**
 * The service account's own token, by Google's "service account authorization without OAuth": an RS256 JWT for
 * FCM's audience, which goes as the bearer with no exchange at Google's token endpoint. Whether FCM's HTTP v1 API takes
 * one is unverified until a live send: if it does not, the token comes from that endpoint instead, a second host.
 */
export function fcmToken(k: FcmKey, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  return tokens(k.keyId, now, () =>
    jwtOf(
      { alg: 'RS256', typ: 'JWT', kid: k.keyId },
      {
        iss: k.clientEmail,
        sub: k.clientEmail,
        aud: `https://${FCM_HOST}/`,
        iat,
        exp: iat + 3_600,
      },
      (signed) => sign('sha256', signed, createPrivateKey(k.key)),
    ),
  );
}

/** A request to FCM as it goes on the wire. */
export type FcmRequest = { url: string; headers: Record<string, string>; body: string };

/**
 * A message as FCM takes it from here: no target of its own, as a topic or a condition reaches every device that took it
 * and a token another device; its data strings alone; 4 KB at most.
 */
export function checkMessage(message: Record<string, unknown>) {
  for (const target of ['token', 'topic', 'condition'])
    if (target in message)
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `an FCM payload names no ${target}: it goes to the app on this device alone`,
      );
  const { data } = message;
  const strings =
    data === undefined ||
    (typeof data === 'object' &&
      data !== null &&
      Object.values(data).every((v) => typeof v === 'string'));
  if (!strings) throw new DeviceError('INVALID_ARGUMENT', "an FCM message's data is strings alone");
  if (Buffer.byteLength(JSON.stringify(message)) > FCM_BYTES)
    throw new DeviceError('INVALID_ARGUMENT', `an FCM message is ${FCM_BYTES} bytes at most`);
  return message;
}

/** The request for one message to one registration token. */
export function fcmRequest(
  projectId: string,
  token: string,
  message: Record<string, unknown>,
  jwt: string,
): FcmRequest {
  checkMessage(message);
  return {
    url: `https://${FCM_HOST}/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { ...message, token } }),
  };
}

/** FCM's error codes, in words for a person: none names a key or a token. */
export const FCM_HINTS: Record<string, string> = {
  UNREGISTERED:
    'the registration token is no longer valid: the app gets a new one when it starts again',
  INVALID_ARGUMENT: "FCM refused the message's shape or the token: see its message",
  SENDER_ID_MISMATCH: "the token is another Firebase project's",
  QUOTA_EXCEEDED: 'too many messages: wait a little',
  UNAVAILABLE: 'FCM is unavailable: try again later',
  INTERNAL: 'FCM failed: try again later',
  THIRD_PARTY_AUTH_ERROR: 'FCM was refused by APNs or the web push service',
  UNAUTHENTICATED:
    'Google did not take the service account: a person sets it up again with `appdyno push setup fcm`',
  PERMISSION_DENIED: 'the service account may not send for this project',
  NOT_FOUND: 'FCM knows no such project, or the token',
};

export type FcmAnswer = { status: number; name?: string; code?: string };

type FcmError = { error?: { status?: string; details?: { errorCode?: string }[] } };

/** One message to FCM, the only host there is. */
export async function sendFcm(
  request: FcmRequest,
  post: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<FcmAnswer> {
  if (new URL(request.url).host !== FCM_HOST)
    throw new DeviceError('INTERNAL', `FCM is ${FCM_HOST} alone`);
  const r = await post(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e: unknown) => {
    throw new DeviceError(
      'INTERNAL',
      `FCM was not reached: ${e instanceof Error ? e.name : String(e)}`,
      'check that this Mac reaches Google',
    );
  });
  const j = (await r.json().catch(() => ({}))) as { name?: unknown } & FcmError;
  const code = j.error?.details?.find((d) => d.errorCode)?.errorCode ?? j.error?.status;
  return {
    status: r.status,
    ...(typeof j.name === 'string' && { name: j.name }),
    ...(typeof code === 'string' && /^\w{1,64}$/.test(code) && { code }),
  };
}
