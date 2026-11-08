import {
  PUSH_PLACEHOLDERS,
  PUSH_TYPES,
  type Push,
  type PushRoute,
  type PushType,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg, shq } from './adb.js';

/** What gives an app's code a push on Android: FCM's own message, to the app's own Firebase SDK. */
const BY_FCM =
  "the app's own Firebase SDK takes it, as FCM's own message: name an app with Firebase Messaging on a debuggable build, or set FCM up with `appdyno push setup fcm`";
/** An Android style is the app's own notification, drawn by its code from what it was handed. */
const style = (name: string) =>
  `an Android app draws its ${name} style itself, from the data its code is handed: background, with that data, is the push for it`;
const WHY: Partial<Record<PushType, string>> = {
  inbox: style('inbox'),
  messaging: style('messaging'),
  media: style('media'),
  voip: "PushKit's, an iOS push: a call reaches an Android app as a data message",
  widgets: "WidgetKit's, an iOS push: an Android widget updates from the app's own code",
};
const DATA_KEY = /^[\w.-]{1,100}$/;
/** `Intent.FLAG_ACTIVITY_CLEAR_TOP`. */
const CLEAR_TOP = '0x04000000';

type Fcm = {
  notification?: { click_action?: string };
  android?: { notification?: { click_action?: string } };
  data?: Record<string, unknown>;
};

/**
 * Each type on Android, where a push is always the app's own: what its code is handed as FCM's own message, by the
 * routes beside this, or the tap on one. `tapped` is what Firebase documents for a push tapped while the app is in the
 * background: the launcher activity, or the one `click_action` names, opened with the data in its intent's extras.
 * https://firebase.google.com/docs/cloud-messaging/android/receive
 */
export const ANDROID_PUSHES: PushRoute[] = PUSH_TYPES.map((type) =>
  type === 'tapped'
    ? {
        type,
        route: "the launcher activity, or click_action's, opened with the data as extras",
        fields: ['data'],
        template: JSON.stringify({ data: PUSH_PLACEHOLDERS.data }),
      }
    : { type, why: WHY[type] ?? BY_FCM },
);

/** A tapped push: it draws nothing, and opens the app as a person's tap on its push does. */
export class AndroidPush {
  constructor(private readonly sh: (command: string) => Promise<string>) {}

  async send(app: string, push: Push): Promise<string> {
    const route = ANDROID_PUSHES.find((r) => r.type === push.type);
    if (!route || 'why' in route) throw new DeviceError('UNSUPPORTED', route?.why ?? push.type);
    const pkg = assertPkg(app);
    const fcm = (push.payload ?? {}) as Fcm;
    const action = { ...fcm.notification, ...fcm.android?.notification }.click_action;
    const data = Object.entries(fcm.data ?? push.data ?? {}).map(
      ([k, v]) => [k, String(v)] as const,
    );
    const bad = data.find(([k]) => !DATA_KEY.test(k));
    if (bad)
      throw new DeviceError(
        'INVALID_ARGUMENT',
        `a data key is letters, digits, _ . -: not ${bad[0]}`,
      );
    let target = `-a ${shq(action ?? '')} -p ${pkg}`;
    if (!action) {
      const out = await this.sh(
        `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER -a android.intent.action.MAIN ${pkg}`,
      );
      const component = out.trim().split('\n').at(-1)!;
      if (!component.startsWith(`${pkg}/`))
        throw new DeviceError('NOT_FOUND', `${pkg} has no launcher activity: ${component}`);
      target = `-n ${component}`;
    }
    const extras = data.flatMap(([k, v]) => ['--es', k, shq(v)]).join(' ');
    // as Firebase's own tap opens it: the activity on top of the app's task anew, with this intent
    const out = await this.sh(`am start -W -f ${CLEAR_TOP} ${target} ${extras}`);
    if (/Error|Exception/.test(out))
      throw new DeviceError('NOT_FOUND', `the app did not open: ${out.trim().split('\n').at(-1)}`);
    return `opened ${pkg} as a tapped push, with ${data.length} data keys as extras`;
  }
}
