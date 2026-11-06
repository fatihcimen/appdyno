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
  privacy_reminders: 'prefs:root=Privacy&path=REMINDERS',
  privacy_bluetooth: 'prefs:root=Privacy&path=BT_PERIPHERAL',
  privacy_health: 'prefs:root=Privacy&path=HEALTH',
  privacy_motion: 'prefs:root=Privacy&path=MOTION',
  privacy_speech: 'prefs:root=Privacy&path=SPEECH_RECOGNITION',
  privacy_media: 'prefs:root=Privacy&path=MEDIALIBRARY',
  privacy_tracking: 'prefs:root=Privacy&path=USER_TRACKING',
  privacy_analytics: 'prefs:root=Privacy&path=PROBLEM_REPORTING',
  privacy_advertising: 'prefs:root=Privacy&path=ADVERTISING',
  screen_time: 'prefs:root=SCREEN_TIME',
  camera: 'prefs:root=CAMERA',
  game_center: 'prefs:root=GAMECENTER',
  home_screen: 'prefs:root=HOME_SCREEN',
  developer: 'prefs:root=DEVELOPER_SETTINGS',
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
  software_update: 'prefs:root=General&path=SOFTWARE_UPDATE_LINK',
  storage: 'prefs:root=General&path=STORAGE_MGMT',
  date_time: 'prefs:root=General&path=DATE_AND_TIME',
};
