import { SETTINGS_PAGES, type SettingsPage } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { assertPkg } from './adb.js';

/** The intents of Settings' pages; what Android keeps apart has no one page here. */
const SETTINGS_ACTIONS: Partial<Record<SettingsPage, string>> = {
  general: 'android.settings.SETTINGS',
  about: 'android.settings.DEVICE_INFO_SETTINGS',
  keyboard: 'android.settings.INPUT_METHOD_SETTINGS',
  language_region: 'android.settings.LOCALE_SETTINGS',
  accessibility: 'android.settings.ACCESSIBILITY_SETTINGS',
  voice_input: 'android.settings.VOICE_INPUT_SETTINGS',
  apps: 'android.settings.MANAGE_APPLICATIONS_SETTINGS',
  privacy: 'android.settings.PRIVACY_SETTINGS',
  privacy_location: 'android.settings.LOCATION_SOURCE_SETTINGS',
  wifi: 'android.settings.WIFI_SETTINGS',
  bluetooth: 'android.settings.BLUETOOTH_SETTINGS',
  cellular: 'android.settings.NETWORK_OPERATOR_SETTINGS',
  battery: 'android.settings.BATTERY_SAVER_SETTINGS',
  display: 'android.settings.DISPLAY_SETTINGS',
  sounds: 'android.settings.SOUND_SETTINGS',
  notifications: 'android.settings.NOTIFICATION_SETTINGS',
  home_screen: 'android.settings.HOME_SETTINGS',
  software_update: 'android.settings.SYSTEM_UPDATE_SETTINGS',
  storage: 'android.settings.INTERNAL_STORAGE_SETTINGS',
  date_time: 'android.settings.DATE_SETTINGS',
  vpn: 'android.settings.VPN_SETTINGS',
  security: 'android.settings.SECURITY_SETTINGS',
  // with no screen lock, it asks for one first
  fingerprint: 'android.settings.FINGERPRINT_SETTINGS',
};

/** Android's own pages: iOS's, as screen_time, are none of them. */
export const ANDROID_PAGES = SETTINGS_PAGES.filter((p) => p in SETTINGS_ACTIONS);

/** What an `am start` of these words says went wrong, if anything. */
type Start = (intent: string) => Promise<string | undefined>;

export async function openSettingsAt(to: { page: SettingsPage } | { app: string }, start: Start) {
  const action = 'page' in to ? SETTINGS_ACTIONS[to.page] : undefined;
  const intent =
    'app' in to
      ? `-a android.settings.APPLICATION_DETAILS_SETTINGS -d package:${assertPkg(to.app)}`
      : action && `-a ${action}`;
  const error = intent ? await start(intent) : 'there is none';
  if (error)
    throw new DeviceError(
      'UNSUPPORTED',
      `this device has ${'page' in to ? `no ${to.page} page in Settings` : `no page for ${to.app}`}: ${error}`,
      'open general or apps, and tap your way from there',
    );
}

/** Android's search is the app that answers the system's request for one. */
export async function openSearch(start: Start) {
  const error = await start('-a android.search.action.GLOBAL_SEARCH');
  if (error)
    throw new DeviceError(
      'UNSUPPORTED',
      `this device has no app for a global search: ${error}`,
      "press home and tap the launcher's own search",
    );
}
