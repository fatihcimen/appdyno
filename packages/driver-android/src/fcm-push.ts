import { PushRate, type Push, type PushField, type PushRoute, type PushType } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { fcmKey, type FcmKey } from './fcm-key.js';
import {
  checkMessage,
  FCM_HINTS,
  fcmRequest,
  fcmToken,
  sendFcm,
  type FcmAnswer,
  type FcmRequest,
} from './fcm.js';

/** What a device lets FCM know of an app there, and where the app's own lines are read. */
export type FcmTarget = {
  installed(app: string): Promise<boolean>;
  /** The app's own lines in its device's log, in this session. */
  lines(app: string): Promise<string[]>;
};

/** A registration token as an app prints it: its instance, a colon, and the rest. */
const TOKEN = /\b[\w-]{20,}:[\w-]{100,}\b/g;

export const fcmTokensIn = (lines: string[]) =>
  lines.flatMap((l) => [...l.matchAll(TOKEN)].map((m) => m[0]));

/** What each type is to FCM: a notification, or data alone for the app's own code to make of it; its fields. */
export const BY_TYPE: Partial<Record<PushType, { notification: boolean; fields: PushField[] }>> = {
  alert: { notification: true, fields: ['title', 'body', 'data'] },
  rich: { notification: true, fields: ['title', 'body', 'image', 'data'] },
  background: { notification: false, fields: ['data'] },
  // a Live Update is the app's own notification, built from a data message
  live_activity: { notification: false, fields: ['data'] },
};

const HOW_A_TOKEN_IS_FOUND =
  "the app prints its registration token in its own log (FirebaseMessaging's getToken, or onNewToken), or a person types it in the window";

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

/** The message of a push of these fields: high priority and a TTL of 0, delivered now or never. */
export function messageOf(push: Push): Record<string, unknown> {
  if (push.payload) return push.payload;
  const t = BY_TYPE[push.type]!;
  const notification = {
    ...(push.title && { title: push.title }),
    ...(push.body && { body: push.body }),
    ...(push.image && { image: push.image }),
  };
  return {
    ...(t.notification && { notification }),
    ...(push.data && { data: push.data }),
    android: { priority: 'HIGH', ttl: '0s' },
  };
}

/** A type's message of placeholders, for a person or an AI to put their own in. */
export const templateOf = (type: PushType) =>
  JSON.stringify(messageOf({ type, title: 'Title', body: 'Body', data: { key: 'value' } }));

/**
 * Pushes by FCM to an app on one device, behind what a person set up: Google's FCM host alone, a registration token this
 * tool read from the app's own log in this session or a person typed, the app installed there, FCM's 4 KB, and 10 a
 * minute.
 */
export class FcmPush {
  private readonly kept = new Map<
    string,
    { token: string; from: 'log' | 'person'; at: number }[]
  >();
  private readonly rate = new PushRate();

  constructor(
    private readonly target: FcmTarget,
    private readonly use: {
      key: () => FcmKey | undefined;
      send: (request: FcmRequest) => Promise<FcmAnswer>;
      now: () => number;
    } = { key: fcmKey, send: (r) => sendFcm(r), now: Date.now },
  ) {}

  /** Whether a person set FCM up on this Mac: all an MCP client may know of it. */
  get ready() {
    return this.use.key() !== undefined;
  }

  routes(): PushRoute[] {
    if (!this.ready) return [];
    return Object.entries(BY_TYPE).map(([type, t]) => ({
      type: type as PushType,
      route: `FCM, ${t.notification ? 'a notification' : "data alone, for the app's own code"}, by the registration token the app printed in this session or a person typed`,
      fields: t.fields,
      template: templateOf(type as PushType),
      tokens: ['device'],
    }));
  }

  /** A person's registration token, typed in a window: never an MCP client's. */
  typed(app: string, token: string) {
    if (!new RegExp(`^${TOKEN.source}$`).test(token))
      throw new DeviceError('INVALID_ARGUMENT', 'not a registration token');
    this.keep(app, [{ token, from: 'person', at: this.use.now() }]);
  }

  async push(app: string, push: Push): Promise<string> {
    const key = this.use.key();
    if (!key || !BY_TYPE[push.type])
      throw new DeviceError('UNSUPPORTED', `FCM takes no ${push.type} push here`);
    if (!(await this.target.installed(app)))
      throw new DeviceError('NOT_FOUND', `${app} is not installed on this device`);
    const message = checkMessage(messageOf(push));
    const now = this.use.now();
    this.rate.check(now);
    const token = await this.token(app);
    const request = fcmRequest(key.projectId, token.token, message, fcmToken(key, now));
    this.rate.went(now);
    const a = await this.use.send(request);
    const by = `by the registration token ${token.from === 'person' ? 'a person typed' : 'its log gave'} at ${clock(token.at)}`;
    if (a.status === 200)
      return `pushed to ${app} by FCM ${by}: FCM took it${a.name ? `, ${a.name}` : ''}`;
    if (a.code === 'UNREGISTERED' || a.code === 'SENDER_ID_MISMATCH')
      this.kept.set(
        app,
        (this.kept.get(app) ?? []).filter((k) => k !== token),
      );
    throw new DeviceError(
      'UNSUPPORTED',
      `FCM refused the push ${by}: ${a.code ?? 'no reason'} (${a.status})`,
      FCM_HINTS[a.code ?? ''] ?? "Firebase's ErrorCode reference says why",
    );
  }

  private async token(app: string) {
    const newest = () => this.kept.get(app)?.at(-1);
    const kept = newest();
    if (kept) return kept;
    const at = this.use.now();
    this.keep(
      app,
      fcmTokensIn(await this.target.lines(app)).map((token) => ({
        token,
        from: 'log' as const,
        at,
      })),
    );
    const found = newest();
    if (!found)
      throw new DeviceError(
        'NOT_FOUND',
        `no registration token from ${app} in this session`,
        HOW_A_TOKEN_IS_FOUND,
      );
    return found;
  }

  private keep(app: string, more: { token: string; from: 'log' | 'person'; at: number }[]) {
    if (more.length > 0) this.kept.set(app, [...(this.kept.get(app) ?? []), ...more]);
  }
}
