import { Adb, androidProvider, type InstallAnswers } from '@appdyno/driver-android';
import { appleProvider } from '@appdyno/driver-apple';

/** What this Mac reaches devices by: of those that take a serial, the last one opens it. */
export const deviceProviders = (
  takeover = false,
  animations?: 'on' | 'off',
  installAnswers?: InstallAnswers,
) => [
  androidProvider(new Adb(), {
    takeover,
    ...(animations && { animations }),
    ...(installAnswers && { installAnswers }),
  }),
  appleProvider(),
];
