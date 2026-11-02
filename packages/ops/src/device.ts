import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { DeviceOut, DevicesOut, ActionOut, DoneOut } from './schemas.js';
import { refused } from './session.js';
import { Device, Read } from './steps.js';
import { ACT, defineOp, READ, reply, ToolError, type Op } from './tool.js';

export function deviceOps(ctx: ServerContext, { info, osName, afterChange }: Answers): Op[] {
  const policy = ctx.policy;
  return [
    defineOp({
      name: 'list_devices',
      title: 'Devices',
      description:
        'Connected devices (serial, state, model) and which of them this server may drive.',
      input: z.object({}).strict(),
      output: DevicesOut,
      annotations: READ,
      run: async () => {
        const devices = (await ctx.devices().catch(refused)).map((d) => ({
          ...d,
          allowed: ctx.allowed(d.serial),
          selected: d.serial === ctx.currentSerial,
        }));
        if (devices.length === 0)
          return reply('no device connected (adb lists none, no simulator is booted)', { devices });
        return reply(
          devices
            .map(
              (d) =>
                `${d.serial} ${d.state} ${d.model ?? ''}${d.allowed ? '' : ' (not allowed on this server)'}${d.selected ? ' ← selected' : ''}`,
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
        'Drive this device (starts its agent or connects to it); app: the package or bundle id of the app under test.',
      input: z.object({ device: z.string().max(64), app: z.string().max(200).optional() }).strict(),
      output: DeviceOut,
      annotations: { ...READ, idempotentHint: true, readOnlyHint: false },
      run: async ({ device, app }) => {
        const s = await ctx.use(device, app);
        const h = s.device.hello!;
        return reply(
          `selected ${device}: ${h.model}, ${osName(s)}, screen ${h.screen.w}x${h.screen.h}` +
            `${s.device.lastStartWasCold ? ' (agent started)' : ''}${s.appId ? `; app ${s.appId}` : ''}`,
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
      input: z.object({ device: Device }).strict(),
      output: DeviceOut,
      annotations: READ,
      run: async ({ device }) => {
        const s = await ctx.session(device);
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
      input: z
        .object({ device: Device, orientation: z.enum(['portrait', 'landscape']), read: Read })
        .strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ device, orientation, read }) => {
        const s = await ctx.session(device);
        await s.device.setOrientation(orientation === 'portrait' ? 0 : 1).catch(refused);
        return afterChange(s, `orientation: ${orientation}`, read);
      },
    }),
    defineOp({
      name: 'set_clipboard',
      title: 'Set clipboard',
      description: 'Put a text on the clipboard (for paste tests).',
      input: z.object({ device: Device, text: z.string().min(1).max(2_000) }).strict(),
      output: DoneOut,
      annotations: ACT,
      run: async ({ device, text: value }) => {
        if (policy.secrets.some((x) => x && value.includes(x)))
          throw new ToolError('a secret is never put on the clipboard');
        const s = await ctx.session(device);
        await s.device.setClipboard(value).catch(refused);
        const done = `on the clipboard (${Array.from(value).length} characters)`;
        return reply(done, { done });
      },
    }),
    defineOp({
      name: 'set_location',
      title: 'Set location',
      description: "Fix the device's GPS position (latitude, longitude).",
      input: z
        .object({
          device: Device,
          lat: z.number().min(-90).max(90),
          lon: z.number().min(-180).max(180),
        })
        .strict(),
      output: DoneOut,
      annotations: ACT,
      run: async ({ device, lat, lon }) => {
        const s = await ctx.session(device);
        await s.device.setLocation(lat, lon).catch(refused);
        const done = `location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        return reply(done, { done });
      },
    }),
  ];
}
