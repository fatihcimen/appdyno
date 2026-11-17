import { asName, onLine } from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { DoneOut } from './schemas.js';
import { ACT, definePart, reply, ToolError } from './tool.js';

const InspectorOut = DoneOut.extend({
  elements: z
    .array(z.object({ caption: z.string(), identifier: z.string().optional() }))
    .optional(),
});

export function inspectorOps(ctx: ServerContext) {
  return [
    definePart({
      name: 'inspector',
      input: z
        .object({ action: z.enum(['list', 'press']), name: z.string().max(200).optional() })
        .strict(),
      output: InspectorOut,
      annotations: ACT,
      run: async ({ action, name }) => {
        const s = await ctx.session();
        const inspector = s.device.inspector;
        if (!inspector)
          throw new ToolError(
            'only an iPhone has this: read_screen reads this device',
            'UNSUPPORTED',
          );
        if (action === 'list') {
          const elements = await inspector.elements();
          const lines = elements.map(
            (e) => `${onLine(e.caption)}${e.identifier ? ` #${asName(e.identifier)}` : ''}`,
          );
          return reply(lines.join('\n') || 'nothing on the screen', {
            done: `${elements.length} elements`,
            elements,
          });
        }
        if (!name) throw new ToolError('press needs name', 'INVALID_ARGUMENT');
        const pressed = await inspector.press(name);
        s.acted();
        const t = `pressed ${onLine(pressed.caption)}`;
        return reply(t, { done: t });
      },
    }),
  ];
}
