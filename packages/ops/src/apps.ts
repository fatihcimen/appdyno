import { reportProgress } from '@appdyno/core';
import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { checkApp, checkUrl } from './policy.js';
import { ActionOut, DoneOut } from './schemas.js';
import { Read } from './step-schemas.js';
import { ACT, defineOp, DESTRUCTIVE, reply, ToolError, type Op } from './tool.js';

const NO_APP = 'give app (or select one with use_device)';

export function appOps(ctx: ServerContext, { afterChange }: Answers): Op[] {
  const policy = ctx.policy;
  return [
    defineOp({
      name: 'open_link',
      title: 'Open link',
      description:
        'Open a link (https:// or an app scheme) and answer its screen; with an app selected it opens there.',
      input: z.object({ url: z.string().min(3).max(2_000), read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ url, read }) => {
        const s = await ctx.session();
        const href = checkUrl(policy, url);
        await s.device.openUrl(href, s.appId);
        return afterChange(s, `opened ${href}`, read);
      },
    }),
    defineOp({
      name: 'launch_app',
      title: 'Launch app',
      description:
        'Launch the app (to the front if it runs) and answer its screen; default: the selected app.',
      input: z.object({ app: z.string().max(200).optional(), read: Read }).strict(),
      output: ActionOut,
      annotations: DESTRUCTIVE,
      run: async ({ app, read }) => {
        const s = await ctx.session();
        const pkg = checkApp(policy, app ?? s.appId ?? '');
        if (!pkg) throw new ToolError(NO_APP, 'INVALID_ARGUMENT');
        reportProgress(`launching ${pkg}`);
        await s.device.launch(pkg);
        return afterChange(s, `launched ${pkg}`, read);
      },
    }),
    defineOp({
      name: 'terminate_app',
      title: 'Terminate app',
      description: 'Stop the app (force-stop); default: the selected app.',
      input: z.object({ app: z.string().max(200).optional() }).strict(),
      output: DoneOut,
      annotations: DESTRUCTIVE,
      run: async ({ app }) => {
        const s = await ctx.session();
        const pkg = checkApp(policy, app ?? s.appId ?? '');
        if (!pkg) throw new ToolError(NO_APP, 'INVALID_ARGUMENT');
        await s.device.terminate(pkg);
        s.acted();
        s.appPid = undefined;
        return reply(`stopped ${pkg}`, { done: `stopped ${pkg}` });
      },
    }),
  ];
}
