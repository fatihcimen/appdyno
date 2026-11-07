import { deviceState, type DeviceProvider, type Need } from '@appdyno/core';
import { z } from 'zod';
import { Devicectl } from './devicectl.js';
import { iphoneGuide } from './guide.js';
import { IosPhoneDevice } from './phone.js';
import { listPhones, sameUdid, type UsbAttach } from './usbmux.js';
import { pairedPhones } from './wifi-paired.js';

/** The runner's deployment target. */
const RUNNER_MIN_IOS = 17;

/** An iPhone's UDID. */
const PHONE_ID = /^[0-9A-F]{8}-[0-9A-F]{16}$|^[0-9a-f]{40}$/;

/**
 * What keeps a phone from being driven: what the Mac knows of it, then its lock, which asks the phone. `trusted`: it
 * has been seen to trust this Mac on this cable, so its lock is asked alongside; the answer is the fresh list's either way.
 */
export async function phoneNeed(
  ctl: Pick<Devicectl, 'listed' | 'lockState'>,
  trusted = false,
): Promise<Need | undefined> {
  const lock = trusted ? ctl.lockState() : undefined;
  // its failure counts only once the list has passed
  lock?.catch(() => undefined);
  const phone = await ctl.listed();
  if (!phone) return 'not-connected';
  if (phone.connectionProperties?.pairingState !== 'paired') return 'not-trusted';
  if (phone.deviceProperties?.developerModeStatus !== 'enabled') return 'developer-mode-off';
  if (parseInt(phone.deviceProperties.osVersionNumber ?? '', 10) < RUNNER_MIN_IOS)
    return 'os-too-old';
  return (await (lock ?? ctl.lockState())).passcodeRequired ? 'locked' : undefined;
}

/**
 * The plug-in on which each phone's list last passed, by the multiplexer's number: on it, the phone trusts this Mac.
 * On disk, as a session's first list is a process of its own. Any other answer, or a failed read, takes it away.
 * shortcut: usbmux numbers plug-ins anew when it restarts, so a kept number may come back; that changes when the lock
 * is asked, never the answer. Upgrade if usbmux gives a plug-in an identity that outlives it.
 */
const trustedOn = deviceState('iphone-trusted-on', z.number().int());

/** What is kept says only when to ask the lock: a file that cannot be written changes no answer. */
function keepTrusted(serial: string, plugIn: number | undefined) {
  try {
    if (plugIn === undefined) trustedOn.remove(serial);
    else if (trustedOn.read(serial) !== plugIn) trustedOn.write(serial, plugIn);
  } catch {
    // the next list asks the lock after the list, as with nothing kept
  }
}

/** A phone's need, its lock asked alongside the list on a plug-in where it has been seen to trust this Mac. */
async function usbPhoneNeed(
  serial: string,
  plugIn: number | undefined,
  ctl: Pick<Devicectl, 'listed' | 'lockState'>,
) {
  let trusts = false;
  try {
    const need = await phoneNeed(ctl, plugIn !== undefined && trustedOn.read(serial) === plugIn);
    trusts = need === undefined || need === 'locked';
    return need;
  } finally {
    keepTrusted(serial, trusts ? plugIn : undefined);
  }
}

/** iPhones on a cable, and those paired for Wi-Fi with none. */
export function iphoneProvider(
  connected: {
    phones: () => Promise<UsbAttach[]>;
    /** Paired for Wi-Fi: what is on disk, as a list comes often and a look on the network takes seconds. */
    paired?: () => string[];
    devicectl?: (udid: string) => Pick<Devicectl, 'listed' | 'lockState'>;
  } = {
    phones: () => listPhones().catch(() => []),
    paired: pairedPhones,
  },
): DeviceProvider {
  const devicectl = connected.devicectl ?? ((udid) => new Devicectl(udid));
  return {
    list: async () => {
      const phones = (await connected.phones()).map((p) => p.udid);
      return [
        ...phones.map((udid) => ({
          serial: udid,
          state: 'usb',
          ready: true,
          model: 'iPhone',
          link: 'USB' as const,
        })),
        // with no cable a window is all it can do, and whether the phone is there is that window's to say
        ...(connected.paired?.() ?? [])
          .filter((udid) => !phones.some((phone) => sameUdid(phone, udid)))
          .map((udid) => ({
            serial: udid,
            state: 'network',
            ready: false,
            model: 'iPhone',
            link: 'Wi-Fi' as const,
          })),
      ];
    },
    handles: (serial) => PHONE_ID.test(serial),
    need: async ({ serial, state }) => {
      if (state === 'network') return undefined;
      const plugIn = (await connected.phones()).find((p) => sameUdid(p.udid, serial));
      return usbPhoneNeed(serial, plugIn?.deviceId, devicectl(serial));
    },
    guide: iphoneGuide,
    open: (serial) => new IosPhoneDevice(serial),
  };
}
