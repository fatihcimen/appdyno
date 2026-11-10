import { DeviceError } from '@appdyno/protocol';
import type { Simctl } from './simctl.js';

/** A simulator's pasteboard, read from the Mac. */
export const pasteOnMac = (simctl: Simctl, udid: string) => simctl.exec(['pbpaste', udid]);

/**
 * From the Mac: at times the runner's own pasteboard call held it up for its 15 s. Where the Mac's call writes
 * nothing, as `simctl pbcopy` on a new iOS 26.5 simulator with Xcode 27.1, only the runner's is left, and a stall
 * of that is refused as what it is: it was restarted for it, and a second wait saw the same at load 138.
 */
export async function setSimClipboard(
  simctl: Simctl,
  udid: string,
  text: string,
  byRunner: (text: string) => Promise<void>,
) {
  await simctl.pbcopy(udid, text);
  if ((await pasteOnMac(simctl, udid)) === text) return;
  await byRunner(text).catch((e: unknown) => {
    if (!(e instanceof DeviceError && e.code === 'TIMEOUT')) throw e;
    throw new DeviceError(
      'UNSUPPORTED',
      `this simulator's clipboard did not take the text: simctl pbcopy wrote nothing and the runner's call stalled`,
      'try again once the Mac is less busy, or type the text instead',
      { cause: e, retryable: true },
    );
  });
}
