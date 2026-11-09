import {
  heldElsewhere,
  SETTINGS,
  type Device,
  type DeviceEvent,
  type SettingName,
  type ViewerMessage,
} from '@appdyno/core';
import { conditions, readCondition, type Session } from '@appdyno/ops';

/** What a phone's way to this Mac may go through: its Wi-Fi, adb over Wi-Fi, a proxy between. */
const CUTS: readonly string[] = ['wifi', 'airplane', 'mobile_data', 'proxy'];
export const CUTS_WHY = 'on a phone, this can cut the link to it: change it on the phone';
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

/** What an op answered, and its data where it gave any. */
type Called = { answer: { ok: boolean; text: string; hint?: string }; data: unknown };

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

  const row = async (s: Session, name: SettingName) => {
    const also = {
      ...(changed(name) && { changed: true }),
      ...(phone && CUTS.includes(name) && { why: CUTS_WHY }),
    };
    try {
      const value = await readCondition(s, name);
      const on = SWITCHES.includes(name) ? switchOf(name, value) : undefined;
      // read, and yet not set from here: a simulator follows the Mac's proxy
      const why = await s.device.settings.cannotSet?.(name);
      return { name, value, ...(on !== undefined && { on }), ...(why && { why }), ...also };
    } catch (e) {
      return { name, why: e instanceof Error ? e.message : String(e), ...also };
    }
  };

  /** Every condition, read at once, then the events and a location, which have nothing to read. */
  const rows = async (names: readonly SettingName[] = SETTINGS) => {
    const s = await session();
    return Promise.all(names.map((name) => row(s, name)));
  };
  const events = () =>
    EVENTS.map((name) => {
      const why = device.events.cannot?.(name);
      return { name, ...(why && { why }) };
    });

  const given = (m: ViewerMessage) =>
    m.args && typeof m.args === 'object' ? (m.args as Record<string, unknown>) : {};

  return {
    deviceList: async () =>
      tell('device', {
        platform: device.platform,
        conditions: [...(await rows()), ...events(), { name: 'location' }],
      }),

    /** One condition or event, by the op's own arguments; a condition comes back as the device then reads it. */
    deviceSet: async (m: ViewerMessage) => {
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
        ...(setting && { moved, conditions: await rows([setting]) }),
      });
    },

    deviceLocation: async (m: ViewerMessage) =>
      tell('device', (await call('device', 'set_location', given(m))).answer),

    /** Put Back All: what `device_setting restore` puts back, and what it leaves to a process still running. */
    deviceRestore: async () => {
      const { answer } = await call('device', 'device_setting', { name: 'restore' }, '');
      tell('device', { ...answer, conditions: await rows() });
    },
  };
}
