import type { Platform } from '@appdyno/protocol';
import type { ListedDevice } from './device.js';
import type { Need } from './mirror/need.js';
import { run } from './run.js';

/** Who made a phone on this Mac's USB, where it changes what a person is told. */
export type Maker = 'apple' | 'samsung' | 'xiaomi' | 'google' | 'other';

export type UsbPhone = { maker: Maker; name: string };

/** USB vendor ids of those who make Android phones: any other device on a USB bus, a keyboard or a hub, is no phone. */
const ANDROID_MAKERS: Record<number, Maker> = {
  0x04e8: 'samsung',
  0x2717: 'xiaomi',
  0x18d1: 'google',
  0x0bb4: 'other', // HTC
  0x0fce: 'other', // Sony
  0x1004: 'other', // LG
  0x12d1: 'other', // Huawei
  0x19d2: 'other', // ZTE
  0x22b8: 'other', // Motorola
  0x22d9: 'other', // Oppo and realme
  0x2a70: 'other', // OnePlus
  0x2d95: 'other', // vivo
  0x339b: 'other', // Honor
};

const APPLE = 0x05ac;

/** What a person does for a phone, in the order they do it. The hub's table has the words of each. */
export const STEP_IDS = [
  'get-adb',
  'developer-options',
  'usb-debugging',
  'allow',
  'xiaomi-security',
  'xiaomi-install',
  'get-xcode',
  'trust',
  'developer-mode',
] as const;
export type StepId = (typeof STEP_IDS)[number];

/** `sees`: this Mac can tell when it is done, and ticks it. Where it cannot, a person moves on by a word, and nothing waits. */
export type Step = { id: StepId; done: boolean; sees: boolean };

export const step = (id: StepId, done: boolean, sees = true): Step => ({ id, done, sees });

/** A phone as a driver lists it, with what it reads of itself. */
export type ListedPhone = ListedDevice & {
  need?: Need;
  switches?: { input: string; install: string };
  /** It is also there by the network. */
  onWifi?: boolean;
  /** This server may not drive it, by its allow list: nothing is asked of it. */
  allowed?: false;
};

/** What a driver asks of a person for a phone of its kind, and what is said in place of a step. */
export type PhoneSteps = {
  steps: Step[];
  need?: Need;
  maker: Maker;
  /** The kind of phone in a person's hand: nothing else is asked of them. */
  hand: Platform;
  /** How this phone goes without a cable, for a phone on one: on it, or by a code it shows. */
  wifi?: { way: 'cable' | 'code'; paired: boolean };
};

export type PhoneLook = {
  phone?: ListedPhone;
  usb: UsbPhone[];
  /** Whether `doctor` found a tool on this Mac. */
  has: (tool: string) => boolean;
};

/** A need, unless a step stands for it. */
export const needBeside = (need: Need | undefined, covered: Need[]) =>
  need && !covered.includes(need) ? { need } : {};

const field = (block: string, name: string) =>
  new RegExp(`"${name}" = "?([^"\\n]*)"?`).exec(block)?.[1];

/** What the registry prints, by the place on the bus: a device stands under its hub and again by itself. */
export function phonesIn(registry: string): UsbPhone[] {
  const found = new Map<string, UsbPhone>();
  for (const block of registry.split('+-o ')) {
    const vendor = Number(field(block, 'idVendor'));
    const name = field(block, 'USB Product Name') ?? '';
    const maker = vendor === APPLE && /^i(Phone|Pad)/.test(name) ? 'apple' : ANDROID_MAKERS[vendor];
    if (maker) found.set(field(block, 'locationID') ?? name, { maker, name });
  }
  return [...found.values()];
}

/**
 * Phones on this Mac's USB, whatever they allow: an Android with USB debugging off is here though adb has not heard of
 * it, and so is an iPhone that trusts nobody. Nothing is asked of the phone. Nothing at all here, with a phone on the
 * cable, means the cable carries no data.
 */
export const usbPhones = (): Promise<UsbPhone[]> =>
  run('ioreg', ['-r', '-c', 'IOUSBHostDevice', '-l', '-w0'], { timeout: 5_000 }).then(
    ({ stdout }) => phonesIn(stdout),
    () => [],
  );
