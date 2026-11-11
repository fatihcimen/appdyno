import {
  kindOf,
  must,
  osName,
  TURNS_FROM_OWN_SHAPE,
  type ListedDevice,
  type Screen,
} from '@appdyno/core';
import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { DeviceOut, DevicesOut, ActionOut, DoneOut } from './schemas.js';
import { deviceNamed } from './device-names.js';
import { endLocation, fixLocation, turning } from './settings.js';
import { Read } from './step-schemas.js';
import { ACT, defineOp, READ, reply, ToolError } from './tool.js';

/** In the order of the device's own rotations, a quarter turn each. */
const ROTATIONS = ['portrait', 'landscape_left', 'upside_down', 'landscape_right'] as const;

/** The app's window as a turn leaves it: wide in landscape, tall else, with something on it. */
const turnedTo = (wide: boolean) => (x: Screen) =>
  !!x.window && x.window.w > x.window.h === wide && x.list.length > 0;

export function deviceOps(ctx: ServerContext, { info, changing, afterChange }: Answers) {
  return [
    defineOp({
      name: 'list_devices',
      title: 'Devices',
      description:
        'Connected phones, simulators and emulators (serial, state, model, kind), which this server may drive, who holds each, what blocks each with its fix.',
      input: z.object({}).strict(),
      output: DevicesOut,
      annotations: READ,
      run: async () => {
        const row = async (d: ListedDevice) => {
          const h = ctx.heldBy(d.serial);
          const allowed = ctx.allowed(d.serial);
          // a block is read on the device itself, and a device this server may not drive is asked nothing
          const blocked = allowed ? await ctx.blockOf(d) : undefined;
          return {
            ...d,
            kind: kindOf(d),
            allowed,
            selected: d.serial === ctx.currentSerial,
            ...(h && { heldBy: { pid: h.pid, tool: h.tool, since: h.since } }),
            ...(blocked && { blocked }),
          };
        };
        // each driver's blocks are read once that driver has listed, not once the slowest has
        const devices = (
          await Promise.all(ctx.providers.map(async (p) => Promise.all((await p.list()).map(row))))
        ).flat();
        if (devices.length === 0)
          return reply('no device connected, and no simulator booted', { devices });
        return reply(
          devices
            .map(
              (d) =>
                `${d.serial} ${d.state} ${d.model ?? ''} (${d.kind})${d.allowed ? '' : ' (not allowed on this server)'}${d.selected ? ' ← selected' : ''}${d.heldBy ? ` (held by pid ${d.heldBy.pid}, ${d.heldBy.tool}, since ${d.heldBy.since})` : ''}${d.blocked ? `: ${d.blocked.title}. ${d.blocked.fix}` : ''}`,
            )
            .join('\n'),
          { devices },
        );
      },
    }),
    defineOp({
      name: 'use_device',
      title: 'Use device',
      description:
        'Drive this device; app: the id under test. One another process holds refuses, naming it; share: true uses it anyway.',
      input: z
        .object({
          device: z.string().max(64),
          app: z.string().max(200).optional(),
          share: z.boolean().optional(),
        })
        .strict(),
      output: DeviceOut,
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async ({ device, app, share }) => {
        const serial = await deviceNamed(ctx, device);
        const s = await ctx.use(serial, app, share);
        const left = ctx.leftovers.get(serial);
        const note = left
          ? [
              ...(left.restored.length > 0
                ? [`; restored what an ended session left changed: ${left.restored.join(', ')}`]
                : []),
              ...left.failed.map((f) => `; could not restore ${f}`),
            ].join('')
          : '';
        const h = must(s.device.hello, "the agent's hello");
        return reply(
          `selected ${serial === device ? device : `${device} (${serial})`}: ${h.model}, ${osName(s.device.platform, h.osVersion)}, screen ${h.screen.w}x${h.screen.h}` +
            `${s.device.lastStartWasCold ? ' (agent started)' : ''}${s.appId ? `; app ${s.appId}` : ''}${note}`,
          {
            ...info(s),
            agentStarted: s.device.lastStartWasCold,
            ...(s.appId && { app: s.appId }),
          },
        );
      },
    }),
    defineOp({
      name: 'device_info',
      title: 'Device info',
      description: 'Model, OS version, screen, agent version and the app in front.',
      input: z.object({}).strict(),
      output: DeviceOut,
      annotations: READ,
      run: async () => {
        const s = await ctx.session();
        const h = must(s.device.hello, "the agent's hello");
        const fg = await s.device.foreground();
        return reply(
          [
            `${s.device.serial}: ${h.model}, ${osName(s.device.platform, h.osVersion)}${h.sdk !== undefined ? ` (SDK ${h.sdk})` : ''}`,
            `screen ${h.screen.w}x${h.screen.h}, density ${h.screen.density}, rotation ${h.screen.rotation}`,
            `agent ${h.agentVersion}, protocol ${h.protocol.major}`,
            `foreground: ${fg ?? 'unknown'}`,
          ].join('\n'),
          { ...info(s), ...(fg && { foreground: fg }) },
        );
      },
    }),
    defineOp({
      name: 'set_orientation',
      title: 'Orientation',
      description: 'Rotate to portrait or landscape. It stays: go back to portrait after.',
      input: z.object({ orientation: z.enum(ROTATIONS), read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ orientation, read }) => {
        const s = await ctx.session();
        const rotation = ROTATIONS.indexOf(orientation) as 0 | 1 | 2 | 3;
        const own = s.device.hello?.screen;
        const wideAsItStands =
          TURNS_FROM_OWN_SHAPE[s.device.platform] &&
          !!own &&
          own.w > own.h !== (own.rotation % 2 === 1);
        const wide = (rotation % 2 === 1) !== wideAsItStands;
        // a window of that shape already, as upside down, has no turn to wait for
        const was = (
          s.fresh ??
          (await s.device.tree().then(
            (t) => s.screenOf(t),
            () => undefined,
          ))
        )?.window;
        const turned = await changing(s, () =>
          turning(s, (kept) => s.device.setOrientation(rotation, kept)),
        );
        const otherwise = `the window stayed ${wide ? 'tall' : 'wide'}: the app may keep to one orientation`;
        return afterChange(
          s,
          turned.was,
          `orientation: ${orientation}`,
          read,
          undefined,
          was && was.w > was.h === wide ? undefined : { met: turnedTo(wide), otherwise },
        );
      },
    }),
    defineOp({
      name: 'set_location',
      title: 'Set location',
      description: 'Set a fake GPS location; clear: true ends it.',
      input: z
        .object({
          lat: z.number().min(-90).max(90).optional(),
          lon: z.number().min(-180).max(180).optional(),
          clear: z.boolean().optional(),
        })
        .strict(),
      output: DoneOut,
      annotations: ACT,
      run: async ({ lat, lon, clear }) => {
        const s = await ctx.session();
        if (clear) {
          await endLocation(s);
          return reply('the location is the real one', { done: 'the location is the real one' });
        }
        if (lat === undefined || lon === undefined)
          throw new ToolError('give lat and lon, or clear: true', 'INVALID_ARGUMENT');
        // written down as a condition: it ends with the session, and at restore
        await fixLocation(s, lat, lon);
        const done = `location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        return reply(done, { done });
      },
    }),
  ];
}
