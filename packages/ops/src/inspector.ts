import { z } from 'zod';
import type { ServerContext } from './context.js';
import { DoneOut } from './schemas.js';
import { ACT, defineOp, reply, ToolError } from './tool.js';

const InspectorOut = DoneOut.extend({
  elements: z
    .array(z.object({ caption: z.string(), identifier: z.string().optional() }))
    .optional(),
});

export function inspectorOps(ctx: ServerContext) {
  return [
    defineOp({
      name: 'inspector',
      title: 'Accessibility inspector',
      description:
        'With no runner on an iPhone: list (its screen by its own accessibility service: words and ids, no places), press (name: an id or words listed).',
      input: z
        .object({ action: z.enum(['list', 'press']), name: z.string().max(200).optional() })
        .strict(),
      output: InspectorOut,
      annotations: ACT,
      run: async ({ action, name }) => {
        const s = await ctx.session();
        const inspector = s.device.inspector;
        if (!inspector) throw new ToolError('only an iPhone has this', 'UNSUPPORTED');
        if (action === 'list') {
          const elements = await inspector.elements();
          const lines = elements.map(
            (e) => `${e.caption}${e.identifier ? ` #${e.identifier}` : ''}`,
          );
          return reply(lines.join('\n') || 'nothing on the screen', {
            done: `${elements.length} elements`,
            elements,
          });
        }
        if (!name) throw new ToolError('press needs name', 'INVALID_ARGUMENT');
        const pressed = await inspector.press(name);
        s.acted();
        return reply(`pressed ${pressed.caption}`, { done: `pressed ${pressed.caption}` });
      },
    }),
  ];
}
