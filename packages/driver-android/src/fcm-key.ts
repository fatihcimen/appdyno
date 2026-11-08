import { createPrivateKey } from 'node:crypto';
import { pushCredentials, readState, writeState } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';

/** A Firebase project's id, as Google names one. */
const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

const FcmKeySchema = z.object({
  projectId: z.string().regex(PROJECT),
  clientEmail: z.email(),
  keyId: z.string().min(1),
  key: z.string(),
});

/** What is kept of a Firebase service account: its project, its address, its key's id and the key. */
export type FcmKey = z.infer<typeof FcmKeySchema>;

/** The service account a person set up on this Mac, if any. Nothing an MCP client sends reaches here, or reads it. */
export const fcmKey = (): FcmKey | undefined => readState(pushCredentials('fcm'), FcmKeySchema);

/**
 * Keeps what a person gave at `appdyno push setup fcm`: a service account's JSON file, as Firebase's console gives it,
 * whose key is an RSA private key. A refusal never repeats what was given.
 */
export function keepFcmKey(serviceAccount: string) {
  let a: Record<string, unknown> = {};
  try {
    a = JSON.parse(serviceAccount) as Record<string, unknown>;
  } catch {
    // not JSON: said below
  }
  let rsa = false;
  try {
    rsa = createPrivateKey(String(a.private_key)).asymmetricKeyType === 'rsa';
  } catch {
    // no key in it: said below
  }
  const kept = FcmKeySchema.safeParse({
    projectId: a.project_id,
    clientEmail: a.client_email,
    keyId: a.private_key_id,
    key: a.private_key,
  });
  if (a.type !== 'service_account' || !rsa || !kept.success)
    throw new DeviceError(
      'INVALID_ARGUMENT',
      "that file is not a Firebase service account: the console's Service accounts tab gives one as JSON",
    );
  writeState(pushCredentials('fcm'), kept.data);
}
