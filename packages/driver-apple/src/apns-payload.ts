import type { Push } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const refused = (why: string) => new DeviceError('INVALID_ARGUMENT', why);

/** The payload of a push of these fields: an alert's, a rich one's with `mutable-content`, or one with nothing to see. */
function made(push: Push): Record<string, unknown> {
  const alert = { ...(push.title && { title: push.title }), ...(push.body && { body: push.body }) };
  switch (push.type) {
    case 'background':
      return { aps: { 'content-available': 1 }, ...push.data };
    case 'voip':
      return { aps: {}, ...push.data };
    case 'widgets':
      return { aps: { 'content-changed': true } };
    case 'live_activity':
      throw refused(
        "a Live Activity's push is its payload: aps with event (start, update or end) and content-state, as the app's ContentState",
      );
    default:
      return {
        aps: { alert, sound: 'default', ...(push.type === 'rich' && { 'mutable-content': 1 }) },
        ...push.data,
        ...(push.type === 'rich' && push.image && { image: push.image }),
      };
  }
}

/**
 * What ActivityKit's guide asks of a Live Activity's payload: an event, the content state, and to start one its
 * attributes and an alert. The time it was sent is filled in when it is not given, as an older one is dropped.
 */
function liveActivity(payload: Record<string, unknown>, aps: Record<string, unknown>, now: number) {
  const { event } = aps;
  if (event !== 'start' && event !== 'update' && event !== 'end')
    throw refused("a Live Activity's aps.event is start, update or end");
  if (event !== 'end' && !isObject(aps['content-state']))
    throw refused("a Live Activity's aps.content-state is an object, as the app's ContentState");
  if (
    event === 'start' &&
    (typeof aps['attributes-type'] !== 'string' || !isObject(aps.attributes) || !aps.alert)
  )
    throw refused('to start a Live Activity, aps has attributes-type, attributes and an alert');
  return { ...payload, aps: { timestamp: Math.floor(now / 1000), ...aps } };
}

/** A push as APNs takes it: the payload given, else one made of the fields. */
export function apnsPayload(push: Push, now = Date.now()): Record<string, unknown> {
  const payload = push.payload ?? made(push);
  const { aps } = payload;
  if (!isObject(aps)) throw refused('an APNs payload has aps: an object');
  return push.type === 'live_activity' ? liveActivity(payload, aps, now) : payload;
}

/** A Live Activity's update, of placeholders, for a person or an AI to put their own in: the time is filled in. */
export const LIVE_ACTIVITY_TEMPLATE = {
  aps: { event: 'update', 'content-state': { key: 'value' } },
};
