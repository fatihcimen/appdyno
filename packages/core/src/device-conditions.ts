import { DeviceError } from '@appdyno/protocol';
export const SETTINGS = [
  'dark_mode',
  'text_size',
  'reduce_motion',
  'increase_contrast',
  'reduce_transparency',
  'animations',
  'locale',
  'network',
  'proxy',
  'battery',
  'airplane',
  'wifi',
  'mobile_data',
  'fold',
  'thermal',
] as const;

/**
 * What the tool changes only on its way to something asked, written down and put back as the rest: an emulator's PIN,
 * which a fingerprint needs, and the rotation lock a turn of the screen sets.
 */
export const HELD = ['screen_lock', 'orientation'] as const;

export type SettingName = (typeof SETTINGS)[number] | (typeof HELD)[number];

/** The pages of the system's Settings a call opens by name: each device has its own of them, as `settingsPages` says. */
export const SETTINGS_PAGES = [
  'general',
  'about',
  'keyboard',
  'language_region',
  'device_management',
  'accessibility',
  'siri',
  'apps',
  'privacy',
  'privacy_location',
  'privacy_photos',
  'privacy_camera',
  'privacy_contacts',
  'privacy_microphone',
  'privacy_reminders',
  'privacy_bluetooth',
  'privacy_health',
  'privacy_motion',
  'privacy_speech',
  'privacy_media',
  'privacy_tracking',
  'privacy_analytics',
  'privacy_advertising',
  'screen_time',
  'camera',
  'game_center',
  'home_screen',
  'developer',
  'software_update',
  'storage',
  'date_time',
  'vpn',
  'wifi',
  'bluetooth',
  'cellular',
  'battery',
  'display',
  'sounds',
  'notifications',
  'voice_input',
  'security',
  'fingerprint',
] as const;

export type SettingsPage = (typeof SETTINGS_PAGES)[number];

/**
 * The device's conditions. `get` answers what `set` takes, so a change can be put back; `app` is the app
 * a per-app setting (Android's locale) is about.
 */
export type DeviceSettings = {
  /** Before a condition is written down and changed: whatever else holds it lets go, so that the old value read is the user's. */
  willChange?(name: SettingName): Promise<void>;
  get(name: SettingName, app?: string): Promise<string>;
  /** What the answer should add, where the change is less than its name says. */
  set(name: SettingName, value: string, app?: string): Promise<string | undefined>;
};

/**
 * A push by what it does: `alert` is seen, `background` wakes the app's code alone, `rich` carries an image, `tapped`
 * opens the app as a person's tap on one does, and `voip` (PushKit's) and `widgets` (WidgetKit's) are iOS's. A style
 * such as Android's inbox is no push of its own: the app draws it from what a `background` push hands its code.
 */
export const PUSH_TYPES = [
  'alert',
  'background',
  'rich',
  'live_activity',
  'tapped',
  'voip',
  'widgets',
] as const;
export type PushType = (typeof PUSH_TYPES)[number];

/** A push by its fields, or by `payload`, the platform's own: APNs' on iOS, FCM's message on Android. */
export type Push = {
  type: PushType;
  title?: string;
  body?: string;
  /** An image, by a link or a file on this Mac. */
  image?: string;
  data?: Record<string, string>;
  payload?: Record<string, unknown>;
};

/** What a push is given beside its type. */
export type PushField = 'title' | 'body' | 'image' | 'data';

/**
 * How a device takes a push of this type, the fields it takes there, and the payload it would send, made of
 * placeholders; or why it cannot. `tokens`: the kinds of token it goes by, where a person may type one in a window.
 */
export type PushRoute = { type: PushType } & (
  | { route: string; fields: PushField[]; template: string; tokens?: PushTokenKind[] }
  | { why: string }
);

/** The fields a template is made of, for a person or an AI to put their own in. */
export const PUSH_PLACEHOLDERS: Push = {
  type: 'alert',
  title: 'Title',
  body: 'Body',
  image: 'https://example.com/image.png',
  data: { key: 'value' },
};

/** At most 10 pushes a minute to a device by Apple or Google, one a call: a push that went is counted, not one asked. */
export class PushRate {
  private readonly sent: number[] = [];

  /** Refuses while 10 went in the last minute. */
  check(now: number) {
    for (
      let first = this.sent[0];
      first !== undefined && now - first >= 60_000;
      first = this.sent[0]
    )
      this.sent.shift();
    if (this.sent.length >= 10)
      throw new DeviceError('UNSUPPORTED', '10 pushes a minute to a device at most: wait a little');
  }

  went(now: number) {
    this.sent.push(now);
  }
}

/** Which of an app's tokens a push goes by: its device's, a Live Activity's, push to start's, PushKit's, a widget's. */
export const PUSH_TOKEN_KINDS = ['device', 'activity', 'start', 'voip', 'widget'] as const;
export type PushTokenKind = (typeof PUSH_TOKEN_KINDS)[number];

/** `enroll`: a fingerprint or a face is known to the device; the others answer a request for one. */
export type BiometricAnswer = 'match' | 'nomatch' | 'enroll';

/** What happens to a device once: a condition holds and is put back, an event is over when it is said. */
export type DeviceEvents = {
  /** Each type, by how this device takes it, for `app` where it is named: an app's build may take another route. */
  pushRoutes(app?: string): Promise<PushRoute[]>;
  /** Sends one to the app, by its type's route; what reached the app's code, for the answer. */
  push(app: string, push: Push): Promise<string>;
  /** A token a person typed in a window, for pushes to the app by Apple or Google: never an MCP client's. */
  pushToken?(app: string, token: string, kind?: PushTokenKind): void;
  /**
   * `setUp` changes a condition the answer needs, written down first to be put back; without it nothing is set up.
   * What else was done, for the answer.
   */
  biometric(
    answer: BiometricAnswer,
    setUp?: (name: SettingName, value: string) => Promise<void>,
  ): Promise<string | undefined>;
  /** Empties a simulator's keychain, and answers how many items it held. */
  resetKeychain(): Promise<number>;
  /** A call coming in from `number`, or that call ended. */
  call(number: string, end: boolean): Promise<void>;
  sms(from: string, text: string): Promise<void>;
};
