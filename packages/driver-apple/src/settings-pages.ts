import type { SettingsPage } from '@appdyno/core';

/** The links of Settings' pages, by what iOS 27 opened. */
const EVERYWHERE = {
  general: 'prefs:root=General',
  about: 'prefs:root=General&path=About',
  keyboard: 'prefs:root=General&path=Keyboard',
  language_region: 'prefs:root=General&path=INTERNATIONAL',
  device_management: 'prefs:root=General&path=ManagedConfigurationList',
  accessibility: 'prefs:root=ACCESSIBILITY',
  siri: 'prefs:root=SIRI',
  apps: 'settings-navigation://com.apple.Settings.Apps',
  privacy: 'prefs:root=Privacy',
  privacy_location: 'prefs:root=Privacy&path=LOCATION',
  privacy_photos: 'prefs:root=Privacy&path=PHOTOS',
  privacy_camera: 'prefs:root=Privacy&path=CAMERA',
  privacy_contacts: 'prefs:root=Privacy&path=CONTACTS',
  privacy_microphone: 'prefs:root=Privacy&path=MICROPHONE',
} as const;

export type SettingsLinks = Partial<Record<SettingsPage, string>>;

/** A simulator's Settings has no radios, sounds or battery, and takes no link to its display or notifications. */
export const SIMULATOR_LINKS: SettingsLinks = EVERYWHERE;

export const PHONE_LINKS: SettingsLinks = {
  ...EVERYWHERE,
  wifi: 'prefs:root=WIFI',
  bluetooth: 'prefs:root=Bluetooth',
  cellular: 'prefs:root=MOBILE_DATA_SETTINGS_ID',
  battery: 'prefs:root=BATTERY_USAGE',
  display: 'prefs:root=DISPLAY',
  sounds: 'prefs:root=Sounds',
  notifications: 'prefs:root=NOTIFICATIONS_ID',
};
