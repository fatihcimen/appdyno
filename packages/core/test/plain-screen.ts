import type { PlatformScreen } from '../src/screen/index.js';

/** A platform with nothing of its own on the screen: what `core` holds on any. */
export const plainScreen: PlatformScreen = {
  systemAlert: () => undefined,
  personPrompt: () => undefined,
  alertButton: () => undefined,
  keyboardOpen: () => false,
  statusBand: () => 0,
  notTheApp: () => false,
  isSystemUi: () => false,
  barBesideWindow: false,
  windowByBars: () => undefined,
  listsByIdAlone: false,
};
