import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUSH_PLACEHOLDERS, PUSH_TYPES, type Push, type PushRoute } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertBundle, type Simctl } from './simctl.js';

const ANDROID_ONLY = 'an Android style: an iOS push shows as an alert';
const SIMULATOR: Record<string, string> = {
  alert: "simctl push: the app's code gets it as a remote notification",
  rich: "simctl push with mutable-content: the app's Notification Service Extension changes it first",
};
const CANNOT: Record<string, string> = {
  // seen on iOS 27.2: "Notification has no user visible content" (UNErrorDomain 1401)
  background: 'simctl takes no push with nothing to see: it says it has no user visible content',
  live_activity: 'not built yet',
  tapped: 'simctl taps nothing: push an alert, then tap its banner',
  inbox: ANDROID_ONLY,
  messaging: ANDROID_ONLY,
  media: ANDROID_ONLY,
};

/** A push as APNs takes it: the payload given, else one made of the fields. */
export function apnsPayload(push: Push): Record<string, unknown> {
  if (push.payload) {
    const aps = push.payload.aps;
    if (!aps || typeof aps !== 'object' || Array.isArray(aps))
      throw new DeviceError('INVALID_ARGUMENT', 'an APNs payload has aps: an object');
    return push.payload;
  }
  const alert = { ...(push.title && { title: push.title }), ...(push.body && { body: push.body }) };
  const aps =
    push.type === 'background'
      ? { 'content-available': 1 }
      : { alert, sound: 'default', ...(push.type === 'rich' && { 'mutable-content': 1 }) };
  return { aps, ...push.data, ...(push.type === 'rich' && push.image && { image: push.image }) };
}

export const SIMULATOR_PUSHES: PushRoute[] = PUSH_TYPES.map((type) =>
  SIMULATOR[type]
    ? {
        type,
        route: SIMULATOR[type],
        fields: type === 'rich' ? ['title', 'body', 'image', 'data'] : ['title', 'body', 'data'],
        template: JSON.stringify(apnsPayload({ ...PUSH_PLACEHOLDERS, type })),
      }
    : { type, why: CANNOT[type]! },
);

/** What the answer says reached the app's code, by type. */
const REACHED: Record<string, (app: string) => string> = {
  alert: (app) => `pushed to ${app} by simctl: its code gets it as a remote notification`,
  rich: (app) =>
    `pushed to ${app} by simctl with mutable-content: its Notification Service Extension, if it has one, changes it before it shows`,
};

/** A push to a simulator's app, which its code receives as from APNs. */
export async function simulatorPush(simctl: Simctl, udid: string, app: string, push: Push) {
  const reached = REACHED[push.type];
  if (!reached) throw new DeviceError('UNSUPPORTED', CANNOT[push.type] ?? push.type);
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-push-'));
  try {
    const file = join(dir, 'push.apns');
    writeFileSync(file, JSON.stringify(apnsPayload(push)));
    await simctl.exec(['push', udid, assertBundle(app), file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return reached(app);
}
