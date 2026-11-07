import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUSH_PLACEHOLDERS, PUSH_TYPES, type Push, type PushRoute } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertBundle, type Simctl } from './simctl.js';

const ANDROID_ONLY = 'an Android style: an iOS push shows as an alert';
/**
 * Why a simulator takes no push of these types by simctl, which hands the notification center a request of its own
 * making: apsd, where an extension is run and a Live Activity's push arrives, never sees it.
 */
const CANNOT: Record<string, string> = {
  // seen on iOS 27.2: "Notification has no user visible content" (UNErrorDomain 1401)
  background: 'simctl takes no push with nothing to see: it says it has no user visible content',
  // Xcode 11.4's notes: "The mutable-content key is not honored"; Xcode 14's: remote notifications only
  rich: "simctl push runs no Notification Service Extension, as Xcode's notes say: an alert reaches the app's code with the same keys",
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
  type === 'alert'
    ? {
        type,
        route:
          "simctl push: the app's code gets it as a remote notification while the app is in front, else when its banner is tapped",
        fields: ['title', 'body', 'data'],
        template: JSON.stringify(apnsPayload({ ...PUSH_PLACEHOLDERS, type })),
      }
    : { type, why: CANNOT[type]! },
);

/**
 * What reached the app's code, by where it was at the push. In the background even `content-available` woke nothing:
 * seen on iOS 27.2, the code got neither until the banner was tapped.
 */
const REACHED = {
  front: 'it is in front, and its code gets it as a remote notification',
  back: 'it is in the background, so the push is only shown: its code gets it when the banner is tapped',
  off: 'it is not running, so the push is only shown: a tap on the banner launches it with the push',
  unknown:
    'its code gets it now if it is in front, else when the banner is tapped (what is in front could not be read)',
};

/** An alert to a simulator's app, as from APNs; `front` is the app in front, if it can be read. */
export async function simulatorPush(
  simctl: Simctl,
  udid: string,
  app: string,
  push: Push,
  front: () => Promise<string | undefined>,
) {
  if (push.type !== 'alert') throw new DeviceError('UNSUPPORTED', CANNOT[push.type] ?? push.type);
  const payload = JSON.stringify(apnsPayload(push));
  const shown = await front();
  const at: keyof typeof REACHED =
    shown === app
      ? 'front'
      : await simctl.pid(udid, app).then(
          () => (shown ? 'back' : 'unknown'),
          () => 'off',
        );
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-push-'));
  try {
    const file = join(dir, 'push.apns');
    writeFileSync(file, payload);
    await simctl.exec(['push', udid, assertBundle(app), file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return `pushed to ${app} by simctl: ${REACHED[at]}`;
}
