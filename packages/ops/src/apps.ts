import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { checkApp, checkUrl } from './policy.js';
import { ActionOut, DoneOut } from './schemas.js';
import { refused } from './session.js';
import { Device, Read } from './steps.js';
import { ACT, defineOp, DESTRUCTIVE, reply, ToolError, type Op } from './tool.js';

const NO_APP = 'give app (or select one with use_device)';

export function appOps(ctx: ServerContext, { afterChange }: Answers): Op[] {
  const policy = ctx.policy;
  return [
    defineOp({
      name: 'open_link',
      title: 'Open link',
      description:
        'Open a link (https:// or an app scheme) and return the screen it opened; with an app selected the link opens in it.',
      input: z.object({ device: Device, url: z.string().min(3).max(2_000), read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ device, url, read }) => {
        const s = await ctx.session(device);
        const href = checkUrl(policy, url);
        await s.device.openUrl(href, s.appId).catch(refused);
        return afterChange(s, `opened ${href}`, read);
      },
    }),
    defineOp({
      name: 'launch_app',
      title: 'Launch app',
      description:
        'Launch the app (brings it to the front when it runs) and return its screen; default: the selected app.',
      input: z.object({ device: Device, app: z.string().max(200).optional(), read: Read }).strict(),
      output: ActionOut,
      annotations: DESTRUCTIVE,
      run: async ({ device, app, read }) => {
        const s = await ctx.session(device);
        const pkg = checkApp(policy, app ?? s.appId ?? '');
        if (!pkg) throw new ToolError(NO_APP);
        await s.device.launch(pkg).catch(refused);
        return afterChange(s, `launched ${pkg}`, read);
      },
    }),
    defineOp({
      name: 'terminate_app',
      title: 'Terminate app',
      description: 'Stop the app (force-stop); default: the selected app.',
      input: z.object({ device: Device, app: z.string().max(200).optional() }).strict(),
      output: DoneOut,
      annotations: DESTRUCTIVE,
      run: async ({ device, app }) => {
        const s = await ctx.session(device);
        const pkg = checkApp(policy, app ?? s.appId ?? '');
        if (!pkg) throw new ToolError(NO_APP);
        await s.device.terminate(pkg).catch(refused);
        s.acted();
        return reply(`stopped ${pkg}`, { done: `stopped ${pkg}` });
      },
    }),
  ];
}
