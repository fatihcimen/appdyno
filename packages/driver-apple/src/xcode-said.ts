import { DeviceError } from '@appdyno/protocol';

/** Run once by a person: it installs what Xcode's tools need, and asks for an administrator's password. */
export const FIRST_LAUNCH_FIX =
  'run `sudo xcodebuild -runFirstLaunch` in a terminal, or open Xcode once';

/** Why Xcode's tools cannot answer at all, by what they say, in a person's words with what to do. */
export const NOT_READY: [RegExp, string, string][] = [
  [
    /unable to find utility "simctl"|is a command line tools instance|requires Xcode/,
    'Xcode is not selected: the Command Line Tools in use have no simulators',
    'install Xcode from the App Store, or, where it is, run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`',
  ],
  [
    /agreed to the Xcode (and Apple SDKs )?license/i,
    "Xcode's license is not agreed to",
    'run `sudo xcodebuild -license accept` in a terminal, or open Xcode once and agree',
  ],
  [
    /CoreSimulator is out of date|runFirstLaunch|additional (required )?components/i,
    "Xcode's first-launch setup is not done",
    FIRST_LAUNCH_FIX,
  ],
];

/**
 * Each of these fails every simulator alike, so a list that met one is no empty list: said as that. Undefined for
 * anything else.
 */
export function xcodeNotReady(said: string): DeviceError | undefined {
  const known = NOT_READY.find(([shape]) => shape.test(said));
  return known && new DeviceError('UNSUPPORTED', known[1], known[2]);
}
