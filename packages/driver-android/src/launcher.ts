import { DeviceError } from '@appdyno/protocol';
import { assertPkg, shq } from './adb.js';

const LAUNCHER = '-a android.intent.action.MAIN -c android.intent.category.LAUNCHER';

/**
 * The activity a tap on the app's icon starts. An app with two (a debug build's LeakCanary adds its own) resolves to
 * the system's chooser, which starts no app: the first of its own is taken, the one its manifest names first.
 */
export async function launcherOf(sh: (command: string) => Promise<string>, pkg: string) {
  const mine = (out: string) =>
    out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith(`${pkg}/`));
  const [resolved] = mine(
    await sh(`cmd package resolve-activity --brief ${LAUNCHER} ${assertPkg(pkg)}`),
  );
  const found =
    resolved ?? mine(await sh(`cmd package query-activities --brief ${LAUNCHER} ${pkg}`))[0];
  if (found) return found;
  // which of the two is asked only here: a start that finds its activity pays nothing for it
  if (!(await sh(`pm path ${pkg}`)).includes('package:'))
    throw new DeviceError('APP_NOT_RUNNING', `${pkg} is not installed`);
  throw new DeviceError(
    'APP_NOT_RUNNING',
    `${pkg} is installed, but the system resolves no launcher activity for it`,
    'an app that has one on its icon is installed broken: install it again',
  );
}

/**
 * `am start`'s `-n` with the app's launcher activity, quoted for the device's shell: the name is what the device said
 * of an app, and goes into a command line. With the launcher's action and category, as an icon's tap sends: Android 16
 * blocks an intent its filter does not match from an app that asks so, a bare `-n` with it ("does not exist").
 */
export const launcherArg = async (sh: (command: string) => Promise<string>, pkg: string) =>
  `${LAUNCHER} -n ${shq(await launcherOf(sh, pkg))}`;
