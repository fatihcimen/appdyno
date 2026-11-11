import {
  heldElsewhere,
  SETTINGS,
  type Device,
  type DeviceEvent,
  type SettingName,
  type ViewerControl,
} from '@appdyno/core';
import { conditions, readCondition, type Session } from '@appdyno/ops';

/** What a phone's way to this Mac may go through: its Wi-Fi, adb over Wi-Fi, a proxy between. */
const CUTS: readonly string[] = ['wifi', 'airplane', 'mobile_data', 'proxy'];
export const CUTS_WHY =
  'On a phone, this could cut its connection to this Mac. Change it on the phone.';
const EVENTS: readonly DeviceEvent[] = ['biometric', 'call', 'sms'];
const SWITCHES: readonly string[] = [
  'dark_mode',
  'reduce_motion',
  'increase_contrast',
  'reduce_transparency',
  'animations',
  'airplane',
  'wifi',
  'mobile_data',
];

/**
 * A switch as it stands, where it reads as one: `default (now on)` is on, and Android's animations read as three scales,
 * reduce motion being all three still. None where it reads otherwise.
 */
export function switchOf(name: string, value: string) {
  const now = /\(now (\w+)\)$/.exec(value)?.[1] ?? value;
  if (now === 'on' || now === 'off') return now === 'on';
  const scales = now.split(',');
  if (scales.length !== 3) return undefined;
  // a scale never set is `null`, the system's own 1
  const still = scales.every((x) => Number(x) === 0);
  return name === 'reduce_motion' ? still : !still;
}

/**
 * Why a device cannot change a condition, in a person's words: a driver says it to whoever calls its tool, and here that
 * is a person at a window. What none of these takes is said in the op's own words; an MCP answer is never changed.
 */
export const PERSON_REASONS: readonly (readonly [RegExp, string])[] = [
  [/^iOS has no animations setting/, 'iOS has no animation speed setting. Use Reduce Motion.'],
  [
    /^a simulator uses the Mac's network/,
    "A simulator uses the Mac's network. Slow it down with Network Link Conditioner on the Mac.",
  ],
  [/^a simulator has no battery/, 'A simulator has no battery to set.'],
  [/^a simulator has no radios/, "A simulator has no radios. It uses the Mac's network."],
  [/^simctl has no fold pose/, 'A simulator does not fold.'],
  [
    /^a simulator has no thermal state/,
    'A simulator has no thermal state. Only an iPhone has one.',
  ],
  [
    /^a simulator follows the Mac's proxy/,
    "A simulator uses the Mac's proxy. Change it on the Mac.",
  ],
  [/^a simulator has no telephony: it cannot take a call/, 'A simulator cannot take calls.'],
  [
    /^a simulator has no telephony: it cannot take an SMS/,
    'A simulator cannot take text messages.',
  ],
  [/^Android has no reduce_transparency switch/, 'Android has no Reduce Transparency setting.'],
  [
    /^this tool sets no thermal state on Android/,
    'Android has no thermal state to set. Only an iPhone has one.',
  ],
  [/^this device (does not fold|has no fold states)/, 'This device does not fold.'],
  [/^this phone has Android below 13/, 'A phone needs Android 13 or later to slow its network.'],
  [/^a phone has no calls/, 'Only an emulator takes a call from here.'],
  [/^a phone has no SMS/, 'Only an emulator takes a text message from here.'],
  [
    /^an Android phone takes a fingerprint only from a person/,
    'Only an emulator takes a fingerprint from here. On a phone, use your own finger.',
  ],
  [/^an iPhone has no \w+ switch/, "This can't be changed on an iPhone from here."],
  [/^an iPhone folds only/, 'An iPhone does not fold.'],
  [/^an iPhone's language is set on the phone/, "Set an iPhone's language on the phone itself."],
  [
    /^an iPhone takes biometrics only from a person/,
    'An iPhone takes Face ID or Touch ID only from a person.',
  ],
  [/^an iPhone takes calls only/, 'An iPhone takes calls only from its carrier.'],
  [/^an iPhone takes messages only/, 'An iPhone takes text messages only from its carrier.'],
  [/^this build has no phone stream/, "This build can't set an iPhone's network or thermal state."],
  [/^this iPhone offers no \w+ condition/, 'This iPhone does not offer this condition.'],
  [
    /^a real iPhone takes a push only from Apple's servers/,
    "An iPhone takes a push only from Apple's servers, once APNs is set up with appdyno push setup apns in Terminal. Until then, open the app's link in Links, or send the push to a simulator.",
  ],
  [
    /^nothing taps a push on an iPhone but a person/,
    'Only a person taps a push on an iPhone: send an alert, then tap it on the phone.',
  ],
];

/** A reason as a person reads it, where it is one of those; else as the op said it. */
export const personal = (why: string) =>
  PERSON_REASONS.find(([said]) => said.test(why))?.[1] ?? why;

/** What an op answered, and its data where it gave any. */
type Called = { answer: { ok: boolean; text: string; hint?: string }; data: unknown };
/** What a device read, by condition. */
type Reads = Partial<Record<string, string>>;

/**
 * The Device pane: each condition as the device reads it, or why it cannot be, and a change by `device_setting`, the op
 * an agent calls, so that the one record of what to put back holds what a person changed here too.
 */
export function conditionSends(
  device: Device,
  session: () => Promise<Session>,
  call: (name: string, op: string, args: Record<string, unknown>, app?: string) => Promise<Called>,
  tell: (name: string, m: Record<string, unknown>) => void,
) {
  const phone = !device.virtual;
  /** What a restore here would put back: what this process, a command line or a process now gone changed. */
  const changed = (name: string) => {
    const held = conditions.read(device.serial)?.[name];
    return !!held && !heldElsewhere(held.owner);
  };

  /** A condition's row: as `read` says it where an op just read it back, else as the device reads it now. */
  const row = async (s: Session, name: SettingName, read?: string) => {
    const also = {
      ...(changed(name) && { changed: true }),
      ...(phone && CUTS.includes(name) && { why: CUTS_WHY }),
    };
    try {
      const value = read ?? (await readCondition(s, name));
      const on = SWITCHES.includes(name) ? switchOf(name, value) : undefined;
      // read, and yet not set from here: a simulator follows the Mac's proxy
      const why = await s.device.settings.cannotSet?.(name);
      return {
        name,
        value,
        ...(on !== undefined && { on }),
        ...(why && { why: personal(why) }),
        ...also,
      };
    } catch (e) {
      return { name, why: personal(e instanceof Error ? e.message : String(e)), ...also };
    }
  };

  /** Every condition, read at once, then the events and a location, which have nothing to read. */
  const rows = async (names: readonly SettingName[] = SETTINGS, reads: Reads = {}) => {
    const s = await session();
    return Promise.all(names.map((name) => row(s, name, reads[name])));
  };
  /** What an op's answer read back, by condition: the rows it changed, which need no read of their own. */
  const readBack = (data: unknown): Reads => (data as { reads?: Reads } | undefined)?.reads ?? {};
  const events = () =>
    EVENTS.map((name) => {
      const why = device.events.cannot?.(name);
      return { name, ...(why && { why: personal(why) }) };
    });

  const given = (m: ViewerControl<'deviceSet' | 'deviceLocation'>) => m.args;
  /** A location has nothing to read: only whether one fixed here is written down to go back. */
  const location = () => ({ name: 'location', ...(changed('location') && { changed: true }) });

  return {
    deviceList: async () =>
      tell('device', {
        platform: device.platform,
        conditions: [...(await rows()), ...events(), location()],
      }),

    /** One condition or event, by the op's own arguments; a condition comes back as the device then reads it. */
    deviceSet: async (m: ViewerControl<'deviceSet'>) => {
      const args = given(m);
      const name = String(args.name);
      if (phone && CUTS.includes(name)) {
        tell('device', { ok: false, text: CUTS_WHY });
        return;
      }
      // the whole device's: the app another pane named is no app of this one
      const { answer, data } = await call('device', 'device_setting', args, '');
      const setting = SETTINGS.find((n) => n === name);
      // what reads as it did is no change, and the answer says so
      const moved = answer.ok && !!(data as { changed?: unknown } | undefined)?.changed;
      tell('device', {
        ...answer,
        // a refusal the pane has words for is said in them
        text: personal(answer.text),
        ...(setting && { moved, conditions: await rows([setting], readBack(data)) }),
      });
    },

    deviceLocation: async (m: ViewerControl<'deviceLocation'>) =>
      tell('device', {
        ...(await call('device', 'set_location', given(m))).answer,
        conditions: [location()],
      }),

    /** Put Back All: what `device_setting restore` puts back, a location among them, and what it leaves to a process still running. */
    deviceRestore: async () => {
      const { answer, data } = await call('device', 'device_setting', { name: 'restore' }, '');
      // what went back is as the restore read it back, and nothing else moved: a refusal reads every row again
      const reads = readBack(data);
      const back = answer.ok ? SETTINGS.filter((n) => n in reads) : SETTINGS;
      tell('device', { ...answer, conditions: [...(await rows(back, reads)), location()] });
    },
  };
}
