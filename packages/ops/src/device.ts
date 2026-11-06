import { osName } from '@appdyno/core';
import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { DeviceOut, DevicesOut, ActionOut, DoneOut } from './schemas.js';
import { Read } from './step-schemas.js';
import { ACT, defineOp, READ, reply, ToolError } from './tool.js';

/** In the order of the device's own rotations, a quarter turn each. */
const ROTATIONS = ['portrait', 'landscape_left', 'upside_down', 'landscape_right'] as const;

export function deviceOps(ctx: ServerContext, { info, afterChange }: Answers) {
  return [
    defineOp({
      name: 'list_devices',
      title: 'Devices',
      description:
        'Connected phones, simulators and emulators (serial, state, model), which this server may drive, who holds each, what blocks each with its fix. To start one: simulator.',
      input: z.object({}).strict(),
      output: DevicesOut,
      annotations: READ,
      run: async () => {
        const devices = await Promise.all(
          (await ctx.devices()).map(async (d) => {
            const h = ctx.heldBy(d.serial);
            const blocked = await ctx.blockOf(d);
            return {
              ...d,
              allowed: ctx.allowed(d.serial),
              selected: d.serial === ctx.currentSerial,
              ...(h && { heldBy: { pid: h.pid, tool: h.tool, since: h.since } }),
              ...(blocked && { blocked }),
            };
          }),
        );
        if (devices.length === 0)
          return reply('no device connected, and no simulator booted', { devices });
        return reply(
          devices
            .map(
              (d) =>
                `${d.serial} ${d.state} ${d.model ?? ''}${d.allowed ? '' : ' (not allowed on this server)'}${d.selected ? ' ← selected' : ''}${d.heldBy ? ` (held by pid ${d.heldBy.pid}, ${d.heldBy.tool}, since ${d.heldBy.since})` : ''}${d.blocked ? `: ${d.blocked.title}. ${d.blocked.fix}` : ''}`,
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
        'Drive this device, starting its agent if needed; app: the id under test. One another process holds refuses, naming it; share: true uses it anyway.',
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
        const s = await ctx.use(device, app, share);
        const left = ctx.leftovers.get(device);
        const note = left
          ? [
              ...(left.restored.length > 0
                ? [`; restored what an ended session left changed: ${left.restored.join(', ')}`]
                : []),
              ...left.failed.map((f) => `; could not restore ${f}`),
            ].join('')
          : '';
        const h = s.device.hello!;
        return reply(
          `selected ${device}: ${h.model}, ${osName(s.device.platform, h.osVersion)}, screen ${h.screen.w}x${h.screen.h}` +
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
        const h = s.device.hello!;
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
      description:
        'Rotate to portrait or landscape. It stays fixed: go back to portrait afterwards.',
      input: z.object({ orientation: z.enum(ROTATIONS), read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ orientation, read }) => {
        const s = await ctx.session();
        await s.device.setOrientation(ROTATIONS.indexOf(orientation) as 0 | 1 | 2 | 3);
        return afterChange(s, `orientation: ${orientation}`, read);
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
          await s.device.clearLocation();
          return reply('the location is the real one', { done: 'the location is the real one' });
        }
        if (lat === undefined || lon === undefined)
          throw new ToolError('give lat and lon, or clear: true', 'INVALID_ARGUMENT');
        await s.device.setLocation(lat, lon);
        const done = `location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        return reply(done, { done });
      },
    }),
  ];
}
