import type { Push, PushRoute } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg, shq } from './adb.js';
import { checkMessage } from './fcm.js';
import { BY_TYPE, messageOf, templateOf } from './fcm-push.js';
import { FCM_ONLY } from './push.js';

/**
 * The broadcast Google Play services hands an app an FCM message by, and the receiver the Firebase Messaging SDK
 * declares for it: its permission lets in the system, root and the app itself alone.
 */
const RECEIVE = 'com.google.android.c2dm.intent.RECEIVE';
const RECEIVER = 'com.google.firebase.iid.FirebaseInstanceIdReceiver';
/** FCM's own names, which the SDK reads as what a message is: no data key takes one. */
const RESERVED = /^(from|notification|message_type|collapse_key)$|^(google|gcm)/;
/** Where the SDK reads each field of a notification. */
const SHOWN: Record<string, string> = {
  title: 'gcm.n.title',
  body: 'gcm.n.body',
  image: 'gcm.n.image',
  channel_id: 'gcm.n.android_channel_id',
  click_action: 'gcm.n.click_action',
};

/** Who hands the message over: the app's own uid by run-as, or root where adbd runs as root; or why neither can. */
export type LocalSender = { by: 'run-as' | 'root' } | { why: string };
const BY = { 'run-as': 'run-as on its debuggable build', root: 'root, as adbd runs here' };

type Message = {
  notification?: Record<string, unknown>;
  data?: Record<string, string>;
  android?: { priority?: string; collapse_key?: string; notification?: Record<string, unknown> };
};
type Extra = [string, string];

const shownOf = (m: Message) =>
  m.notification || m.android?.notification
    ? { ...m.notification, ...m.android?.notification }
    : undefined;

/**
 * The broadcast's extras for an FCM message, as the SDK reads Play services' own: the data as given, a notification
 * under `gcm.n.`, which `gcm.n.e` makes one, and the message's id, priority and collapse key.
 */
export function extrasOf(message: Message, id: string): Extra[] {
  const data = Object.entries(message.data ?? {});
  const reserved = data.find(([k]) => RESERVED.test(k));
  if (reserved)
    throw new DeviceError(
      'INVALID_ARGUMENT',
      `${reserved[0]} is FCM's own name: a data key takes another`,
    );
  const android = message.android ?? {};
  const priority = (android.priority ?? 'high').toLowerCase();
  if (priority !== 'high' && priority !== 'normal')
    throw new DeviceError(
      'INVALID_ARGUMENT',
      `an FCM priority is HIGH or NORMAL, not ${android.priority}`,
    );
  const shown = shownOf(message);
  if (typeof shown?.image === 'string' && !/^https?:\/\//.test(shown.image))
    throw new DeviceError(
      'INVALID_ARGUMENT',
      "the app's Firebase SDK fetches the image itself: give a link",
    );
  const fields = Object.entries(shown ?? {}).flatMap(([k, v]): Extra[] =>
    SHOWN[k] && typeof v === 'string' ? [[SHOWN[k], v]] : [],
  );
  return [
    ['from', 'appdyno'],
    ['google.message_id', id],
    ['google.delivered_priority', priority],
    ['google.original_priority', priority],
    ...(android.collapse_key ? [['collapse_key', android.collapse_key] as Extra] : []),
    ...(shown ? [['gcm.n.e', '1'] as Extra, ...fields] : []),
    ...data,
  ];
}

/**
 * FCM's own message, handed to the app's Firebase SDK on this device as Play services hands it, so its code gets it with
 * no project and no key: by run-as on a debuggable build, or by root where adbd runs as root. Google's servers carry
 * nothing, so their delivery, Doze and a token's validity go untried.
 */
export class LocalFcm {
  private sent = 0;

  constructor(
    private readonly sh: (command: string) => Promise<string>,
    private readonly now: () => number = Date.now,
  ) {}

  async sender(app: string): Promise<LocalSender> {
    const pkg = assertPkg(app);
    const receivers = await this.sh(`cmd package query-receivers --brief -a ${RECEIVE} ${pkg}`);
    if (!receivers.includes(`${pkg}/${RECEIVER}`))
      return (await this.sh(`pm path ${pkg}`)).startsWith('package:')
        ? { why: `${pkg} has no Firebase Messaging to take FCM's own message` }
        : { why: `${pkg} is not installed on this device` };
    if (/^\d+$/.test((await this.sh(`run-as ${pkg} id -u`)).trim())) return { by: 'run-as' };
    if ((await this.sh('id -u')).trim() === '0') return { by: 'root' };
    return {
      why: `${pkg} is not a debuggable build and adbd does not run as root here: only FCM set up with \`appdyno push setup fcm\` reaches its code`,
    };
  }

  /** The route of each type FCM takes, by this sender; any other stays as it was. */
  static route(r: PushRoute, sender: LocalSender): PushRoute {
    const t = BY_TYPE[r.type];
    if (!t) return r;
    if ('why' in sender)
      return FCM_ONLY[r.type]
        ? { type: r.type, why: `${FCM_ONLY[r.type]}, and ${sender.why}` }
        : { ...r, ...('route' in r && { route: `${r.route}, as ${sender.why}` }) };
    const what = t.notification
      ? 'in front onMessageReceived gets it, else the SDK draws it'
      : `onMessageReceived gets it wherever the app is${r.type === 'live_activity' ? ', for the app to make its own Live Update' : ''}`;
    return {
      type: r.type,
      route: `FCM's own message to the app's Firebase SDK, as Google Play services hands it, by ${BY[sender.by]}: ${what}; Google's servers carry nothing`,
      fields: t.fields,
      template: templateOf(r.type),
    };
  }

  async send(app: string, push: Push, by: 'run-as' | 'root'): Promise<string> {
    const pkg = assertPkg(app);
    const message = checkMessage(messageOf(push)) as Message;
    const extras = extrasOf(message, `appdyno-${this.now()}-${++this.sent}`)
      .map(([k, v]) => `--es ${shq(k)} ${shq(v)}`)
      .join(' ');
    const out = await this.sh(
      `${by === 'run-as' ? `run-as ${pkg} ` : ''}am broadcast --user 0 -a ${RECEIVE} -n ${pkg}/${RECEIVER} ${extras}`,
    );
    // the receiver sets the result once it has the message; one skipped leaves it at 0
    const result = /Broadcast completed: result=(-?\d+)/.exec(out)?.[1];
    if (result !== '-1') {
      const said = out.trim().split('\n');
      throw new DeviceError(
        'UNSUPPORTED',
        `${pkg}'s Firebase receiver did not take the message: ${result === undefined ? (said.find((l) => /Exception|Error/.test(l)) ?? said[0]) : `result ${result}`}`,
        'a force-stopped app takes none, as from FCM: launch it once',
      );
    }
    const said = `pushed to ${pkg} as FCM's own message, by ${BY[by]}: its receiver took it`;
    if (!shownOf(message))
      return `${said}, and onMessageReceived gets it wherever the app is, started if it was not running`;
    const allowed = !/: (ignore|deny|errored)/.test(
      await this.sh(`cmd appops get ${pkg} POST_NOTIFICATION`),
    );
    return `${said}: in front, onMessageReceived gets it; else its Firebase SDK draws it${allowed ? '' : ', or would: the app is not allowed notifications'}, and a tap opens the app with the data`;
  }
}
