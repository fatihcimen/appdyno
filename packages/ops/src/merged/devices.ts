import { z } from 'zod';
import type { Pieces } from '../catalog.js';
import { mergeOp } from '../merge.js';
import { CHANGE_HINT, DESTRUCTIVE, READ, ToolError } from '../tool.js';

export const listDevices = ({
  list_devices: all,
  device_info: one,
}: Pick<Pieces, 'list_devices' | 'device_info'>) =>
  mergeOp({
    name: 'list_devices',
    title: 'List devices',
    description:
      "List connected phones, simulators and emulators. Returns each one's serial, state, model, whether this server may drive it, who holds it, what blocks it and the fix. selected: only the device in use, with OS, screen, agent version and the app in front. One not running: manage_simulator.",
    input: z.object({ selected: z.boolean().optional() }).strict(),
    annotations: READ,
    parts: [all, one],
    pick: ({ selected }) => [selected ? one : all, {}],
  });

/** A fixed place as a caller writes it: 41.01,28.98. */
const PLACE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

export const setDevice = ({
  device_setting: setting,
  set_orientation: turn,
  set_location: place,
  clipboard,
}: Pick<Pieces, 'device_setting' | 'set_orientation' | 'set_location' | 'clipboard'>) =>
  mergeOp({
    name: 'set_device',
    title: 'Device conditions',
    description:
      'Read or set a device condition: dark mode, orientation (landscape), GPS location, clipboard, Face ID, fingerprint, memory warning, shake, text size, locale, slow network, airplane mode, Wi-Fi, battery, fold, calls, SMS. No value reads it. App permissions: manage_app; photos: transfer_files. Returns the value; orientation the screen too. Put back at the session end or by restore, but for the clipboard.',
    input: z
      .object({
        name: z.enum([
          'orientation',
          'location',
          'clipboard',
          // photos into the gallery are transfer_files' to move
          ...setting.input.shape.name.exclude(['media']).options,
        ]),
        value: z
          .string()
          .max(2_000)
          .optional()
          .describe(
            `orientation: ${turn.input.shape.orientation.unwrap().options.join(', ')}; location: lat,lon, none; clipboard: its text. ${String(setting.input.shape.value.unwrap().description)}`,
          ),
        ...setting.input.omit({ name: true, value: true }).shape,
        read: turn.input.shape.read,
      })
      .strict(),
    annotations: DESTRUCTIVE,
    parts: [setting, turn, place, clipboard],
    // the screen is read after a turn alone: a condition answers with its value
    pick: ({ name, value, read, ...a }) => {
      switch (name) {
        case 'orientation':
          return [turn, { ...a, orientation: value, read }, { orientation: 'value' }];
        case 'clipboard':
          return [clipboard, { ...a, text: value }, { text: 'value' }];
        case 'location': {
          // no value reads what this tool fixed, as a device does not tell its location back
          if (value === undefined) return [place, a];
          if (value === 'none') return [place, { ...a, clear: true }];
          const at = PLACE.exec(value);
          if (!at)
            throw new ToolError(
              'location takes value lat,lon, as 41.01,28.98, or none',
              'INVALID_ARGUMENT',
              CHANGE_HINT,
              false,
            );
          return [place, { ...a, lat: Number(at[1]), lon: Number(at[2]) }];
        }
        default:
          return [setting, { ...a, name, value }];
      }
    },
  });
