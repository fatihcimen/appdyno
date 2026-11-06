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
] as const;

export type SettingName = (typeof SETTINGS)[number];

/** The pages of the system's Settings a call opens by name, where the device has them. */
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
] as const;

export type SettingsPage = (typeof SETTINGS_PAGES)[number];

/**
 * The device's conditions. `get` answers what `set` takes, so a change can be put back; `app` is the app
 * a per-app setting (Android's locale) is about.
 */
export interface DeviceSettings {
  /** Before a condition is written down and changed: whatever else holds it lets go, so that the old value read is the user's. */
  willChange?(name: SettingName): Promise<void>;
  get(name: SettingName, app?: string): Promise<string>;
  set(name: SettingName, value: string, app?: string): Promise<void>;
}

/** `enroll`: a fingerprint or a face is known to the device; the others answer a request for one. */
export type BiometricAnswer = 'match' | 'nomatch' | 'enroll';

/** What happens to a device once: a condition holds and is put back, an event is over when it is said. */
export interface DeviceEvents {
  push(app: string | undefined, title: string, body: string): Promise<void>;
  biometric(answer: BiometricAnswer): Promise<void>;
  /** Empties a simulator's keychain, and answers how many items it held. */
  resetKeychain(): Promise<number>;
  /** A foldable's pose. */
  fold(closed: boolean): Promise<void>;
  /** A call coming in from `number`, or that call ended. */
  call(number: string, end: boolean): Promise<void>;
  sms(from: string, text: string): Promise<void>;
}
