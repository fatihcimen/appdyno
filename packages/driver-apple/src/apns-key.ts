import { createPrivateKey } from 'node:crypto';
import { pushCredentials, readState, writeState } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';

/** Apple's key ids and team ids: ten letters and digits. */
const APPLE_ID = /^[A-Z0-9]{10}$/;

const ApnsKeySchema = z.object({
  key: z.string(),
  keyId: z.string().regex(APPLE_ID),
  teamId: z.string().regex(APPLE_ID),
  production: z.boolean(),
});

/** A team's APNs signing key (a .p8's text), its id, the team's, and whether a person allowed production. */
export type ApnsKey = z.infer<typeof ApnsKeySchema>;

/** The key a person set up on this Mac, if any. Nothing an MCP client sends reaches here, or reads it. */
export const apnsKey = (): ApnsKey | undefined => readState(pushCredentials('apns'), ApnsKeySchema);

/**
 * Keeps what a person gave at `appdyno push setup apns`, once it holds: the .p8 an EC P-256 private key, the ids Apple's.
 * A refusal never repeats what was given.
 */
export function keepApnsKey(given: ApnsKey) {
  let ec = false;
  try {
    const k = createPrivateKey(given.key);
    ec = k.asymmetricKeyType === 'ec' && k.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    // not a key at all: said below
  }
  if (!ec)
    throw new DeviceError(
      'INVALID_ARGUMENT',
      "that file is not an APNs signing key: Apple's is a .p8 holding an EC P-256 private key",
    );
  for (const [name, id] of [
    ['key id', given.keyId],
    ['team id', given.teamId],
  ] as const)
    if (!APPLE_ID.test(id))
      throw new DeviceError('INVALID_ARGUMENT', `the ${name} is ten capital letters and digits`);
  writeState(pushCredentials('apns'), given);
}
