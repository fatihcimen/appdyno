import { z } from 'zod';
import type { Pieces } from '../catalog.js';
import { mergeOp } from '../merge.js';
import { READ } from '../tool.js';

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
