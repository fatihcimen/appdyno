import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { DeviceOut, DevicesOut, ActionOut, DoneOut } from './schemas.js';
import { refused } from './session.js';
import { Read } from './steps.js';
import { ACT, defineOp, READ, reply, type Op } from './tool.js';

export function deviceOps(ctx: ServerContext, { info, osName, afterChange }: Answers): Op[] {
  return [
    defineOp({
      name: 'list_devices',
      title: 'Devices',
      description:
        'Connected devices (serial, state, model), which of them this server may drive and who holds each. To start one, see simulator.',
      input: z.object({}).strict(),
      output: DevicesOut,
      annotations: READ,
      run: async () => {
        const devices = (await ctx.devices().catch(refused)).map((d) => {
          const h = ctx.heldBy(d.serial);
          return {
            ...d,
            allowed: ctx.allowed(d.serial),
            selected: d.serial === ctx.currentSerial,
            ...(h && { heldBy: { pid: h.pid, tool: h.tool, since: h.since } }),
          };
        });
        if (devices.length === 0)
          return reply('no device connected (adb lists none, no simulator is booted)', { devices });
        return reply(
          devices
            .map(
              (d) =>
                `${d.serial} ${d.state} ${d.model ?? ''}${d.allowed ? '' : ' (not allowed on this server)'}${d.selected ? ' ← selected' : ''}${d.heldBy ? ` (held by pid ${d.heldBy.pid}, ${d.heldBy.tool}, since ${d.heldBy.since})` : ''}`,
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
        'Drive this device (starts its agent or connects to it); app: the package or bundle id of the app under test. A device another process holds refuses, naming it; share: true uses it anyway.',
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
          `selected ${device}: ${h.model}, ${osName(s)}, screen ${h.screen.w}x${h.screen.h}` +
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
      description:
        "The selected device's model, OS version, screen, agent capabilities and the app in the foreground.",
      input: z.object({}).strict(),
      output: DeviceOut,
      annotations: READ,
      run: async () => {
        const s = await ctx.session();
        const h = s.device.hello!;
        const fg = await s.device.foreground().catch(refused);
        return reply(
          [
            `${s.device.serial}: ${h.model}, ${osName(s)}${h.sdk !== undefined ? ` (SDK ${h.sdk})` : ''}`,
            `screen ${h.screen.w}x${h.screen.h}, density ${h.screen.density}, rotation ${h.screen.rotation}`,
            `agent ${h.agentVersion}, protocol ${h.protocol.major}.${h.protocol.minor}, capabilities: ${h.capabilities.join(', ')}`,
            `foreground: ${fg ?? 'unknown'}`,
          ].join('\n'),
          { ...info(s), capabilities: h.capabilities, ...(fg && { foreground: fg }) },
        );
      },
    }),
    defineOp({
      name: 'set_orientation',
      title: 'Orientation',
      description:
        'Screen orientation: portrait or landscape (the rotation stays fixed; go back to portrait afterwards).',
      input: z.object({ orientation: z.enum(['portrait', 'landscape']), read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ orientation, read }) => {
        const s = await ctx.session();
        await s.device.setOrientation(orientation === 'portrait' ? 0 : 1).catch(refused);
        return afterChange(s, `orientation: ${orientation}`, read);
      },
    }),
    defineOp({
      name: 'set_location',
      title: 'Set location',
      description: "Fix the device's GPS position (latitude, longitude).",
      input: z
        .object({
          lat: z.number().min(-90).max(90),
          lon: z.number().min(-180).max(180),
        })
        .strict(),
      output: DoneOut,
      annotations: ACT,
      run: async ({ lat, lon }) => {
        const s = await ctx.session();
        await s.device.setLocation(lat, lon).catch(refused);
        const done = `location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        return reply(done, { done });
      },
    }),
  ];
}
