import { must, type SettingName } from '@appdyno/core';
import { approve } from './approval.js';
import { mediaFiles } from './media.js';
import { checkApp, noApp, type Policy } from './policy.js';
import type { Session } from './session.js';
import { reply, ToolError } from './tool.js';

const PHONE_NUMBER = /^\+?\d{3,20}$/;
const DEFAULT_SENDER = '5551234';
const BIOMETRIC = ['match', 'nomatch', 'enroll'] as const;

/**
 * device_setting's one-shot names: each is over once it is said, and nothing of it is put back but the photos and
 * videos a device can take out of its library again, which restore and the session's end take (`addedMedia`).
 */
export const ONE_SHOT = [
  'biometric',
  'call',
  'sms',
  'keychain',
  'memory_warning',
  'shake',
  'media',
] as const;
type OneShot = (typeof ONE_SHOT)[number];

export const isOneShot = (name: string): name is OneShot =>
  (ONE_SHOT as readonly string[]).includes(name);

/**
 * What a one-shot is given beside its name. `setUp` changes a condition it needs, written down first to be put back;
 * none where the app may not be left.
 */
export type Asked = {
  policy: Policy;
  s: Session;
  value: string | undefined;
  title: string | undefined;
  app: string | undefined;
  setUp: ((name: SettingName, value: string) => Promise<void>) | undefined;
};

/** A one-shot this kind of device has no way to make, refused in its own words. */
const lacks = (what: string) => new ToolError(`this device takes no ${what}`, 'UNSUPPORTED');

/** What was done, and what the device adds to it. */
const and = (done: string, said: string | undefined) => [done, said].filter(Boolean).join('; ');

/** Each one-shot, by what its answer says it did. */
const EVENTS: Record<OneShot, (a: Asked) => Promise<string>> = {
  biometric: async ({ s, value, setUp }) => {
    const answer = BIOMETRIC.find((b) => b === value);
    if (!answer)
      throw new ToolError(`biometric needs value: ${BIOMETRIC.join(', ')}`, 'INVALID_ARGUMENT');
    // setting one up may leave the app, as Settings' enrolment on an emulator does
    const also = await s.device.events.biometric(answer, setUp);
    return [`biometric: ${answer}`, also].filter(Boolean).join('; ');
  },
  keychain: async ({ policy, s, value }) => {
    if (value !== 'reset') throw new ToolError('keychain needs value: reset', 'INVALID_ARGUMENT');
    await approve(policy, s, 'device_setting keychain');
    return `the keychain is empty: it held ${await s.device.events.resetKeychain()} items`;
  },
  call: async ({ s, value }) => {
    const m = /^(end )?(\+?\d{3,20})$/.exec(value ?? '');
    if (!m)
      throw new ToolError(
        'call needs value: a phone number; end and the number hangs up',
        'INVALID_ARGUMENT',
      );
    const number = must(m[2], 'the number');
    await s.device.events.call(number, !!m[1]);
    s.acted();
    return m[1] ? `the call from ${number} ended` : `a call from ${number} is coming in`;
  },
  sms: async ({ s, value, title }) => {
    const from = title ?? DEFAULT_SENDER;
    if (!value) throw new ToolError('sms needs value: the text', 'INVALID_ARGUMENT');
    if (!PHONE_NUMBER.test(from))
      throw new ToolError('sms needs title: the phone number it comes from', 'INVALID_ARGUMENT');
    await s.device.events.sms(from, value);
    s.acted();
    return `an SMS came from ${from}`;
  },
  memory_warning: async ({ policy, s, value, app }) => {
    if (!s.device.memoryWarning) throw lacks('memory warning');
    const pkg = checkApp(policy, app ?? s.appId ?? '');
    if (!pkg) throw noApp();
    const said = await s.device.memoryWarning(pkg, value);
    s.acted();
    return and(`sent ${pkg} a memory warning${value ? ` (${value})` : ''}`, said);
  },
  shake: async ({ s }) => {
    if (!s.device.shake) throw lacks('shake');
    const said = await s.device.shake();
    s.acted();
    return and('the device was shaken', said);
  },
  media: async ({ s, value }) => {
    if (!s.device.addMedia) throw lacks('photos or videos into its library');
    const files = mediaFiles(value);
    const said = await s.device.addMedia(files);
    s.acted();
    const n = files.length;
    // a command line's stays, as each command is a process of its own
    const out = s.owner
      ? 'taken out when this session ends, or by restore'
      : 'restore takes them out';
    return and(
      `added ${n} ${n === 1 ? 'file' : 'files'} to the device's photos`,
      [said, ...(s.device.addedMedia ? [out] : [])].filter(Boolean).join('; '),
    );
  },
};

/** A one-shot of device_setting, run. */
export async function oneShot(name: OneShot, asked: Asked) {
  const t = await EVENTS[name](asked);
  return reply(t, { done: t });
}
