import {
  diffScreens,
  diffText,
  fold,
  pause,
  throwIfCancelled,
  renderScreen,
  screenStructure,
  UNCHANGED,
  type Screen,
} from '@appdyno/core';
import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { FindOut, ScreenOut, ScreenshotOut, WaitOut } from './schemas.js';
import { refused } from './session.js';
import { Read, Ref } from './steps.js';
import { defineOp, READ, reply, ToolError, type Op } from './tool.js';

const WAIT_MS = 5_000;
const MAX_WAIT_MS = 15_000;
const WAIT_GAP_MS = 300;
const SHOT_PX = 1024;

export function readOps(ctx: ServerContext, { clean, foreground, header, show }: Answers): Op[] {
  return [
    defineOp({
      name: 'screen',
      title: 'Read screen',
      description:
        'The elements on the screen (ref role "label" x,y flags). Use refs with tap/type_text; a ref keeps naming the same element when the screen changes.',
      input: z.object({}).strict(),
      output: ScreenOut,
      annotations: READ,
      run: async () => {
        const s = await ctx.session();
        const screen = await s.read();
        s.shown = screen.list;
        const fg = foreground(s, screen);
        return reply(`${header(s, screen)}${fg}`, {
          elements: screen.list.length,
          ...(screen.foreground && { foreground: screen.foreground }),
          warnings: fg ? [fg.trim()] : [],
        });
      },
    }),
    defineOp({
      name: 'find',
      title: 'Find',
      description:
        'The elements whose text contains `text` or whose id is `id`, without sending the whole screen.',
      input: z
        .object({
          text: z.string().min(1).max(200).optional(),
          id: z.string().min(1).max(200).optional(),
        })
        .strict(),
      output: FindOut,
      annotations: READ,
      run: async ({ text: want, id }) => {
        if (!want && !id) throw new ToolError('give text or id');
        const s = await ctx.session();
        const screen = await s.read();
        const w = want && fold(want);
        const hits = screen.list.filter(
          (e) => (!w || fold(e.label).includes(w)) && (!id || e.id === id),
        );
        const matches = hits.map((e) => ({
          ref: e.ref,
          role: e.role,
          label: clean(e.label),
          ...(e.id && { id: e.id }),
          x: e.x,
          y: e.y,
        }));
        if (hits.length === 0)
          return reply(`not found (${screen.list.length} elements)`, { matches });
        return reply(renderScreen(hits, clean), { matches });
      },
    }),
    defineOp({
      name: 'wait_for',
      title: 'Wait for',
      description: `Wait until an element shows (gone: until it is gone): text, id or ref; timeoutMs default ${WAIT_MS}, at most ${MAX_WAIT_MS}. Use this instead of fixed sleeps.`,
      input: z
        .object({
          text: z.string().min(1).max(200).optional(),
          id: z.string().min(1).max(200).optional(),
          ref: Ref.optional(),
          gone: z.boolean().default(false),
          timeoutMs: z.number().int().min(300).max(MAX_WAIT_MS).default(WAIT_MS),
          read: Read,
        })
        .strict(),
      output: WaitOut,
      annotations: READ,
      run: async ({ text: want, id, ref, gone, timeoutMs, read }) => {
        if (!want && !id && !ref) throw new ToolError('give text, id or ref');
        const s = await ctx.session();
        const w = want && fold(want);
        const match = (e: Screen['list'][number]) =>
          (!w || fold(e.label).includes(w)) && (!id || e.id === id) && (!ref || e.ref === ref);
        const before = s.shown;
        const end = Date.now() + timeoutMs;
        let last: Screen | undefined;
        let met = false;
        for (;;) {
          throwIfCancelled('wait_for');
          const now = await s.read().catch(() => undefined);
          // a failed read is no answer: never "gone"
          if (now) {
            last = now;
            met = now.list.some(match) !== gone;
          }
          if (met || Date.now() >= end) break;
          await pause(WAIT_GAP_MS).catch(refused);
        }
        if (!last) throw new ToolError('the screen could not be read: nothing to look in');
        show(s, last);
        const found = last.list.find(match);
        const head = met
          ? gone
            ? 'gone'
            : `found: ${found!.ref} ${JSON.stringify(clean(found!.label))}`
          : `${gone ? 'still there' : 'not shown'} after ${timeoutMs} ms`;
        const out = {
          met,
          gone,
          ...(found && !gone && { found: { ref: found.ref, label: clean(found.label) } }),
        };
        if (read === 'none') return reply(head, { ...out, screen: 'none' });
        const diff =
          read === 'diff' && before
            ? diffText(diffScreens(before, last.list), last.list.length, clean)
            : undefined;
        return reply(`${head}\n${diff ?? header(s, last)}`, {
          ...out,
          screen: diff === undefined ? 'full' : diff.startsWith(UNCHANGED) ? 'unchanged' : 'diff',
        });
      },
    }),
    defineOp({
      name: 'screenshot',
      title: 'Screenshot',
      description: `An image of the screen (at most ${SHOT_PX} px) and the scale from image pixels to tap units. Only for a visual judgement; read the screen with screen first. A second image of an unchanged screen is refused.`,
      input: z.object({}).strict(),
      output: ScreenshotOut,
      annotations: READ,
      run: async () => {
        const s = await ctx.session();
        const layout = s.fresh ? screenStructure(s.fresh.list) : undefined;
        if (s.shot && s.shot.at === s.version && layout !== undefined && s.shot.hash === layout)
          throw new ToolError(
            'the screen has not changed since the last image: that image still holds',
          );
        const { meta, data } = await s.device
          .screenshot({ format: 'jpeg', quality: 80, maxPx: SHOT_PX })
          .catch(refused);
        const w = s.device.hello?.screen.w;
        s.shot = { at: s.version, hash: layout ?? '' };
        const scale = w ? Math.round((w / meta.w) * 1000) / 1000 : undefined;
        return reply(
          `image ${meta.w}x${meta.h} px${scale ? `; tap unit = pixel × ${scale.toFixed(3)}` : ''}`,
          { width: meta.w, height: meta.h, ...(scale && { scale }) },
          [{ type: 'image', data: data.toString('base64'), mimeType: 'image/jpeg' }],
        );
      },
    }),
  ];
}
