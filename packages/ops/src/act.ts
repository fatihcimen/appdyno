import { alertButton } from '@appdyno/core';
import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { ActionOut } from './schemas.js';
import { refused } from './session.js';
import {
  Coord,
  Device,
  Keys,
  LongPressStep,
  pinchPaths,
  Read,
  STALE,
  Step,
  SwipeStep,
  Target,
  TypeStep,
  type Steps,
} from './steps.js';
import { ACT, defineOp, reply, ToolError, type Op } from './tool.js';

const MAX_STEPS = 12;

export function actOps(
  ctx: ServerContext,
  { act, summary }: Answers,
  { one, step, windowSize }: Steps,
): Op[] {
  return [
    defineOp({
      name: 'tap',
      title: 'Tap',
      description: 'Tap an element (by ref, or at x,y) and return the settled screen after it.',
      input: z.object({ device: Device, ...Target, read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ device, read, ...a }) =>
        one(await ctx.session(device), { action: 'tap', ...a }, read),
    }),
    defineOp({
      name: 'long_press',
      title: 'Long press',
      description: 'Long-press an element (ref or x,y; durationMs default 800).',
      input: z
        .object({
          device: Device,
          ...Target,
          durationMs: LongPressStep.shape.durationMs,
          read: Read,
        })
        .strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ device, read, ...a }) =>
        one(await ctx.session(device), { action: 'long_press', ...a }, read),
    }),
    defineOp({
      name: 'swipe',
      title: 'Swipe',
      description:
        'Swipe. direction: up (content moves up, a list scrolls on), down, left, right; optional start x,y and distance.',
      input: z
        .object({ device: Device, ...SwipeStep.omit({ action: true }).shape, read: Read })
        .strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ device, read, ...a }) =>
        one(await ctx.session(device), { action: 'swipe', ...a }, read),
    }),
    defineOp({
      name: 'pinch',
      title: 'Pinch',
      description:
        'Pinch with two fingers: scale > 1 zooms in, < 1 zooms out; centre x,y (default: the middle of the screen).',
      input: z
        .object({
          device: Device,
          x: Coord.optional(),
          y: Coord.optional(),
          scale: z.number().min(0.2).max(5),
          durationMs: z.number().int().min(100).max(3_000).default(400),
          read: Read,
        })
        .strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ device, x, y, scale, durationMs, read }) => {
        const s = await ctx.session(device);
        const size = await windowSize(s);
        const c = { x: x ?? size.w / 2, y: y ?? size.h / 2 };
        return act(
          s,
          read,
          (o) =>
            s.device.act({ kind: 'gesture', pointers: pinchPaths(c, scale, durationMs, size) }, o),
          `pinched (×${scale})`,
        );
      },
    }),
    defineOp({
      name: 'type_text',
      title: 'Type text',
      description:
        "Type into the focused field. With a ref the field is tapped first and its focus waited for; replace: replaces the field's text; submit: enter afterwards. Any Unicode text.",
      input: z
        .object({ device: Device, ...TypeStep.omit({ action: true }).shape, read: Read })
        .strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ device, read, ...a }) =>
        one(await ctx.session(device), { action: 'type_text', ...a }, read),
    }),
    defineOp({
      name: 'press_key',
      title: 'Press key',
      description:
        'Press a key: back, enter, home (off when the server turned it off), delete, tab.',
      input: z.object({ device: Device, key: Keys, read: Read }).strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ device, key, read }) =>
        one(await ctx.session(device), { action: 'press_key', key }, read),
    }),
    defineOp({
      name: 'steps',
      title: 'Steps',
      description: `Run a known sequence (a login, a form) in one call, at most ${MAX_STEPS} steps; each step is { action: tap | long_press | swipe | type_text | press_key, ... }. The screen is read again before a ref step; stops at the first failure. One read at the end.`,
      input: z
        .object({ device: Device, steps: z.array(Step).min(1).max(MAX_STEPS), read: Read })
        .strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ device, steps, read }) => {
        const s = await ctx.session(device);
        const refs = steps.flatMap((st) => ('ref' in st && st.ref ? [st.ref] : []));
        if (refs.length > 0) {
          const screen = await s.current();
          const unknown = refs.filter((r) => !screen.list.some((e) => e.ref === r));
          if (unknown.length > 0)
            throw new ToolError(`${STALE}: ${[...new Set(unknown)].join(', ')} not on this screen`);
        }
        const done: string[] = [];
        for (const [i, st] of steps.entries()) {
          const last = i === steps.length - 1;
          try {
            if (!last) {
              const x = await step(s, st, { settle: false, read: 'none' }).catch(refused);
              s.acted();
              done.push(`${i + 1}. ${x.done}`);
              continue;
            }
            let lastDone = '';
            return await act(
              s,
              read,
              async (o) => {
                const x = await step(s, st, o);
                lastDone = x.done;
                return x.r;
              },
              () => [...done, `${i + 1}. ${lastDone}`].join('\n'),
            );
          } catch (e) {
            if (!(e instanceof ToolError)) throw e;
            if (done.length === 0) throw e;
            const t = `${done.join('\n')}\n${i + 1}. step failed, the rest were not run: ${e.message}`;
            return reply(t, { ...summary(t), warnings: [e.message] });
          }
        }
        return reply(done.join('\n'), summary(done.join('\n')));
      },
    }),
    defineOp({
      name: 'dismiss_alert',
      title: 'Answer permission prompt',
      description:
        "Answer an open system permission prompt (location, notifications, camera…): allow (default) or deny. Never touches the app's own dialogs.",
      input: z
        .object({ device: Device, action: z.enum(['allow', 'deny']).default('allow'), read: Read })
        .strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ device, action, read }) => {
        const s = await ctx.session(device);
        const screen = await s.read();
        const button = alertButton(screen.elements, s.device.platform, action);
        if (!button)
          return reply(
            "no system permission prompt is open (the app's own dialogs are not touched)",
            summary('no system permission prompt is open'),
          );
        return act(
          s,
          read,
          (o) => s.device.tap(button, o),
          `answered the system prompt: ${JSON.stringify(button.label)}`,
        );
      },
    }),
  ];
}
